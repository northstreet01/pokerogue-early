import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from './helpers/original-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {modifiers,modifierCodec} from './helpers/modifier-model.mjs';
import {addBattleItem,advanceBattleItems,bindBattleItems,itemRoundContext} from './helpers/battle-items-model.mjs';
import {bindAction} from './helpers/move-execution-model.mjs';
import {createRuleTaskTracker} from '../src/battle-core/rule-task-tracker.mjs';
import {withOriginalRules} from '../server/original-random-context.mjs';
import {transferContext,reviveContext,advanceItems,referenceItems,inventory,queue,clone,save,chooseBattleItems} from './helpers/transfer-revive-model.mjs';

const next=c=>nextPostPhase(c)?.constructor.name;
async function diff(initial,{stop=c=>c.decision.kind==='wait-actions',options={}}={}){
  let c=clone(initial),ref=clone(initial);const phases=[],events=[];
  for(let i=0;!stop(c);i++){
    assert.ok(i<100);phases.push(next(c));const inputs=chooseBattleItems(c),before=save(c);
    const expected=await referenceItems(ref,inputs,options),actual=await advanceItems(c,inputs,options);
    assert.deepEqual(save(c),before);assert.deepEqual(actual.events,expected.events);assert.deepEqual(save(actual.context),save(expected.context));
    c=clone(actual.context);ref=expected.context;events.push(...actual.events);
  }
  return {context:c,phases,events};
}
const berry=(c,seat)=>inventory(c,seat).find(m=>m instanceof modifiers.BerryModifier);
const resource=(c,seat)=>({...c.players[seat],modifiers:c.players[seat].modifiers.map(modifierCodec.capture)});
test('transfer rules retain the exact original body with one localized display call and the observed final Promise',()=>{
  const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/early-transfer-revive-reference.json',import.meta.url),'utf8'));
  const scene=parse('battle-scene.ts').statements.find(n=>n.name?.text==='BattleScene');
  const norm=s=>s.replace(/\r\n/g,'\n').trim();
  for(const [name,body]of Object.entries(frozen.scene)){
    let expected=body;
    if(name==='addModifier'){
      // This one display call is localized; every other original statement
      // and every other transfer method remains an exact source comparison.
      const originalMessage="this.queueMessage(`The stack for this item is full.\\n You will receive ${defaultModifierType.name} instead.`, null, true);";
      const localizedMessage="this.queueMessage((i18next.resolvedLanguage??i18next.language)==='zh-Hans'?i18next.t('battle:itemStackFull',\n            {fullItemName:modifier.type.getDisplayName(),itemName:defaultModifierType.getDisplayName()})\n            :`The stack for this item is full.\\n You will receive ${defaultModifierType.name} instead.`, null, true);";
      assert.equal(body.split(originalMessage).length,2);
      expected=body.replace(originalMessage,localizedMessage);
    }
    assert.equal(norm(scene.members.find(n=>n.name?.getText()===name).getText()),norm(expected));
  }
  const source=parse('modifier/modifier.ts').statements.find(n=>n.name?.text==='HeldItemTransferModifier').members.find(n=>n.name?.getText()==='apply').getText();
  assert.equal(norm(source).replace('observeRulePromise(pokemon.scene, Promise.all(heldItemTransferPromises).then','Promise.all(heldItemTransferPromises).then')
    .replace(/    \}\)\);(?=\s+return !!transferredModifierTypes)/,'    });'),norm(frozen.transferApply));
});
for(const seat of [0,1,null])for(const stack of [1,2])test(`original Mini Black Hole owner ${seat} transfers one real stack from ${stack} and restores aliases`,async()=>{
  const initial=await transferContext({seat,stack}),before=save(initial),expected=await referenceItems(clone(initial)),actual=await advanceItems(initial);
  assert.deepEqual(actual.events,expected.events);assert.deepEqual(save(actual.context),save(expected.context));assert.deepEqual(save(initial),before);
  const c=clone(actual.context),stolen=berry(c,seat);assert.equal(stolen.stackCount,1);
  assert.equal(stolen.pokemonId,c.roster.field[seat??2]);
  const sourceSeat=seat===null?[0,1].find(s=>(berry(c,s)?.stackCount??0)===stack-1):null;
  assert.equal(berry(c,sourceSeat)?.stackCount??0,stack-1);
  if(seat!==null)assert.deepEqual(resource(c,1-seat),resource(initial,1-seat));
  else assert.equal(berry(c,1-sourceSeat).stackCount,stack);
  if(stack===2)assert.equal(stolen.type,berry(c,sourceSeat).type);
  assert.equal(actual.events.filter(e=>e.kind==='message').length,1);
});
for(const seat of [0,1,null])for(const seed of ['contact-0','contact-3'])test(`original Grip Claw owner ${seat}, natural seed ${seed}, retains exact chance and random order`,async()=>{
  const result=await diff(await transferContext({seat,id:'GRIP_CLAW',seed}),{stop:c=>next(c)==='MoveEndPhase'});
  assert.ok(result.phases.includes('MoveEffectPhase'));assert.ok(result.phases.includes('DamagePhase'));
  assert.equal(!!berry(result.context,seat),seed==='contact-3');
});
test('original transfer merges matching target stacks and refuses a full target before decrementing source',async()=>{
  for(const full of [false,true]){
    const c=await transferContext();const target=c.roster.entries[0].pokemon,m=addBattleItem(c,0,'BERRY',{stack:1});
    m.stackCount=full?m.getMaxHeldItemCount(target):1;const before=m.stackCount;
    const r=await diff(c,{stop:x=>x.battle.turn>c.battle.turn});
    assert.equal(berry(r.context,0).stackCount,full?before:before+1);assert.equal(berry(r.context,null).stackCount,full?2:1);
  }
});
test('original transfer respects non-transferrable items and leaves an empty opponent inventory unchanged',async()=>{
  for(const blocked of [false,true]){
    const c=await transferContext();c.enemyModifiers=[];if(blocked)addBattleItem(c,null,'MINI_BLACK_HOLE');
    const result=await diff(c,{stop:x=>x.battle.turn>c.battle.turn});
    assert.equal(inventory(result.context,0).length,1);
  }
});
for(const seat of [0,1,null])for(const realAction of [false,true])test(`original held revive owner ${seat}, lethal action=${realAction}, consumes once before queued original heal`,async()=>{
  const initial=await reviveContext({seat,realAction}),slot=seat??2,field=initial.roster.field[slot];
  const result=await diff(initial,{stop:c=>next(c)===(realAction?'MoveEndPhase':'TurnInitPhase')});
  assert.ok(result.phases.includes('FaintPhase'));assert.ok(result.phases.includes('PokemonHealPhase'));
  assert.ok(!result.phases.includes('SwitchPhase'));assert.equal(result.context.roster.field[slot],field);
  assert.ok(result.context.roster.entries[slot].pokemon.hp>0);assert.ok(!inventory(result.context,seat).some(m=>m.type.id==='REVIVER_SEED'));
  assert.ok(inventory(result.context,seat===0?1:0).some(m=>m.type.id==='REVIVER_SEED'));
});
for(const seat of [0,1,null])test(`original complete round revives owner ${seat} then reaches actual subsequent input`,async()=>{
  const c=await itemRoundContext(),slot=seat??2;c.roster.entries[slot].pokemon.hp=1;addBattleItem(c,seat,'REVIVER_SEED');
  if(seat!==null){c.roster.entries[2].pokemon.stats[5]=1000;c.battle.turnCommands[2].move.targets=[seat];}
  const result=await diff(c);assert.ok(result.phases.includes('FaintPhase'));assert.ok(result.phases.includes('PokemonHealPhase'));
  assert.equal(result.context.battle.turn,c.battle.turn+1);assert.equal(result.context.decision.kind,'wait-actions');
  assert.ok(!inventory(result.context,seat).some(m=>m.type.id==='REVIVER_SEED'));
});
for(const seat of [0,1])test(`original preventEndure bypass retains seat ${seat} revive seed and executes real faint`,async()=>{
  const initial=await reviveContext({seat,prevent:true}),actual=await advanceItems(initial),ref=await referenceItems(clone(initial));
  assert.deepEqual(save(actual.context),save(ref.context));assert.equal(actual.context.roster.entries[seat].pokemon.hp,0);
  assert.ok(inventory(actual.context,seat).some(m=>m.type.id==='REVIVER_SEED'));assert.notEqual(next(actual.context),'PokemonHealPhase');
});
test('transfer rejects unknown source and cross-player direct transfer before mutating either inventory',async()=>{
  const c=await transferContext(),p=new originalPhases.TurnEndPhase({}),binding=bindAction(c,p),tasks=createRuleTaskTracker(binding.scene);
  const scope=bindBattleItems(c,p,binding,tasks,{transferAndRevive:true}),before=save(c);
  try{
    assert.throws(()=>binding.scene.tryTransferHeldItemModifier(berry(c,null).clone(),c.roster.entries[0].pokemon,false,false),{code:'INVALID_TRANSFER_SOURCE'});
    const own=addBattleItem(c,0,'BERRY');
    assert.throws(()=>binding.scene.tryTransferHeldItemModifier(own,c.roster.entries[1].pokemon,false,false),{code:'CROSS_PLAYER_ITEM_TRANSFER'});
    c.players[0].modifiers.pop();await scope.drain();
  }finally{scope.dispose();tasks.close();binding.dispose();}
  assert.deepEqual(save(c),before);
});
test('pending or rejected transfer tasks cannot publish partial ownership, messages or RNG',async()=>{
  const initial=await transferContext(),before=save(initial);let release,started,settled=false;
  const gate=new Promise(r=>release=r),begun=new Promise(r=>started=r);
  const pending=advanceItems(initial,{}, {beforeTransfer:()=>{started();return gate;}}).then(r=>{settled=true;return r;});
  await begun;await Promise.resolve();assert.equal(settled,false);assert.deepEqual(save(initial),before);release();await pending;
  await assert.rejects(advanceItems(initial,{}, {beforeTransfer:()=>Promise.reject(Error('transfer-fault'))}),/transfer-fault/);
  assert.deepEqual(save(initial),before);
  assert.deepEqual(save((await advanceItems(initial)).context),save((await referenceItems(clone(initial))).context));
});
for(const phase of ['transfer','faint','heal'])test(`original ${phase} update rejection preserves its exact prior checkpoint for retry`,async()=>{
  let initial=phase==='transfer'?await transferContext():await reviveContext();
  if(phase==='heal')initial=(await advanceItems(initial)).context;
  const before=save(initial);
  await assert.rejects(advanceItems(initial,{}, {updateInfo:()=>Promise.reject(Error('update-fault'))}),/update-fault/);
  assert.deepEqual(save(initial),before);
  if(phase==='heal')assert.ok(!inventory(initial,0).some(m=>m.type.id==='REVIVER_SEED'));
  assert.deepEqual(save((await advanceItems(initial)).context),save((await referenceItems(clone(initial))).context));
});
test('advanced items remain opt-in and unsupported enemy revive bypass cannot cross the gap',async()=>{
  const c=await transferContext(),before=save(c);await assert.rejects(advanceBattleItems(c),/UNSUPPORTED_BATTLE_ITEM/);assert.deepEqual(save(c),before);
  const enemy=await reviveContext({seat:null,prevent:true}),saved=save(enemy);
  await assert.rejects(advanceItems(enemy),/UNSUPPORTED_RULE_PHASE/);assert.deepEqual(save(enemy),saved);
});
test('advanced slice checks original held-item limits before starting multi-transfer or revive work',async()=>{
  for(const c of [await transferContext(),await reviveContext()]){
    c.players[0].modifiers[0].stackCount=2;const before=save(c);
    await assert.rejects(advanceItems(c),/UNSUPPORTED_ADVANCED_ITEM_STACK/);assert.deepEqual(save(c),before);
  }
});
