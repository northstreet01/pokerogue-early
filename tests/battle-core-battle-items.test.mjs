import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {pokemon,status} from './helpers/original-model.mjs';
import {bindAction,utils} from './helpers/move-execution-model.mjs';
import {modifiers,types} from './helpers/modifier-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {itemRoundContext,itemInputContext,addBattleItem,advanceBattleItems,referenceBattleItems,chooseBattleItems,bindBattleItems,berryRules} from './helpers/battle-items-model.mjs';
import {encounterContext,createEncounter,advanceEncounterEntry,referenceEncounterEntry,choosePreBattle} from './helpers/encounter-modifiers-model.mjs';
import {createRuleTaskTracker} from '../src/battle-core/rule-task-tracker.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import {projectPreparation,restorePreparation} from './helpers/preparation-model.mjs';
import {eggs,eggCodec} from './helpers/egg-model.mjs';

const saved=context=>copy(codec.capture(context));
const clone=context=>codec.restore(saved(context));
const items=(context,seat)=>seat===null?context.enemyModifiers:context.players[seat].modifiers;
for(const seat of [0,1])for(const withEggs of [false,true])test(`battle item client projection preserves v${withEggs?7:6} semantics for seat ${seat}`,async()=>{
  const context=await itemRoundContext();addBattleItem(context,seat,'BERRY',{stack:2});addBattleItem(context,1-seat,'LEFTOVERS');
  if(withEggs)context.eggState={players:[[new eggs.Egg(28123456,0,3,1000)],[new eggs.Egg(28123567,1,7,2000)]]};
  const before=saved(context),view=projectPreparation(context,seat),snapshot={seat,...copy(view)};
  const restored=restorePreparation(snapshot),model=withEggs?restored.context:restored;
  assert.equal(saved(model).version,withEggs?7:6);assert.equal(Object.hasOwn(model,'eggState'),withEggs);
  assert.equal(Object.hasOwn(view.shared,'eggCounts'),withEggs);assert.equal(Object.hasOwn(view.personal,'eggs'),withEggs);
  assert.deepEqual(projectPreparation(restored,seat),view);assert.deepEqual(saved(context),before);
  assert.deepEqual(model.players[seat].modifiers.map(m=>[m.type.id,m.stackCount]),[['BERRY',2]]);
  assert.equal(model.players[1-seat].modifiers.length,0);
  if(withEggs){
    assert.deepEqual(eggCodec.capture(model.eggState).players[seat],eggCodec.capture(context.eggState).players[seat]);
    assert.equal(model.eggState.players[1-seat].length,0);
    assert.ok(!JSON.stringify(view).includes(String(context.eggState.players[1-seat][0].id)));
  }
});
for(const key of ['eggs','hatches'])test(`v6 client projection rejects partial v7 ${key} metadata instead of creating an inventory`,async()=>{
  const context=await itemRoundContext(),snapshot={seat:0,...projectPreparation(context,0)};
  snapshot.personal[key]=[];assert.throws(()=>restorePreparation(snapshot),{code:'INVALID_EGG_VIEW_VERSION'});
  assert.equal(Object.hasOwn(context,'eggState'),false);
});
test('an explicitly empty v7 inventory stays v7 and missing private eggs are rejected',async()=>{
  const context=await itemRoundContext();context.eggState={players:[[],[]]};
  for(const seat of [0,1]){
    const view=projectPreparation(context,seat),restored=restorePreparation({seat,...copy(view)});
    assert.deepEqual(view.shared.eggCounts,[0,0]);assert.equal(saved(restored.context).version,7);
    assert.deepEqual(projectPreparation(restored,seat),view);
    const missing={seat,...copy(view)};delete missing.personal.eggs;
    assert.throws(()=>restorePreparation(missing),{code:'INVALID_EGG_VIEW_VERSION'});
  }
});
function queue(context,phase){
  context.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase,remaining:'start'}];
  return context;
}
async function differential(initial,{stop=context=>context.decision.kind==='wait-actions',options={}}={}){
  let actual=clone(initial),expected=clone(initial);const phases=[],events=[];
  for(let step=0;!stop(actual);step++){
    assert.ok(step<160,'item chain must reach its declared boundary');
    phases.push(actual.continuation.currentPhase?.phase.constructor.name||nextPostPhase(actual)?.constructor.name);
    const inputs=chooseBattleItems(actual),before=saved(actual);
    const reference=await referenceBattleItems(expected,inputs,options),result=await advanceBattleItems(actual,inputs,options);
    assert.deepEqual(saved(actual),before);assert.deepEqual(result.events,copy(reference.events));assert.deepEqual(saved(result.context),saved(reference.context));
    actual=clone(result.context);expected=reference.context;events.push(...result.events);
  }
  return {context:actual,phases,events};
}
async function until(context,predicate){for(let step=0;!predicate(context);step++){
  assert.ok(step<100);context=(await advanceBattleItems(context,chooseBattleItems(context))).context;
}return context;}
async function damageResult(initial,seat){
  const context=clone(initial),actor=context.roster.entries.find(entry=>entry.pokemon.id===context.roster.field[seat]).pokemon;
  const target=seat<2?2:0;
  queue(context,new originalPhases.MovePhase({},actor,[target],actor.moveset[0]));
  const result=await differential(context,{stop:current=>nextPostPhase(current)?.constructor===originalPhases.DamagePhase});
  return {damage:result.context.roster.entries.find(entry=>entry.pokemon.id===context.roster.field[target]).pokemon.turnData.attacksReceived[0],context:result.context};
}

for(const seat of [0,1,2])test(`original attack boost follows attacker ${seat}, not target or partner, across action and damage restores`,async()=>{
  const initial=await itemRoundContext(),plain=await damageResult(initial,seat);
  addBattleItem(initial,seat===2?null:seat,'ATTACK_TYPE_BOOSTER',{stack:5});
  const boosted=await damageResult(initial,seat);assert.ok(boosted.damage.damage>plain.damage.damage);
  assert.deepEqual(boosted.context.battle.turnCommands,plain.context.battle.turnCommands);
  const other=await itemRoundContext();addBattleItem(other,seat===1?0:1,'ATTACK_TYPE_BOOSTER',{stack:5});
  assert.deepEqual((await damageResult(other,seat)).damage,plain.damage);
});

for(const seat of [0,1])for(const stat of [5,6])test(`temporary stat ${stat} holder resolves seat ${seat} without borrowing the partner's items`,async()=>{
  const context=await itemRoundContext(),actor=context.roster.entries[seat].pokemon;
  const phase=new originalPhases.MoveEffectPhase({},seat,[2],actor.moveset[0]);
  const type=new types.TempBattleStatBoosterModifierType(stat);type.id='TEMP_STAT_BOOSTER';
  context.players[seat].modifiers.push(type.newModifier());
  const binding=bindAction(context,phase),tasks=createRuleTaskTracker(binding.scene),scoped=bindBattleItems(context,phase,binding,tasks);
  try{
    const owner=new utils.IntegerHolder(0),peer=new utils.IntegerHolder(0),shared=new utils.IntegerHolder(0);
    actor.scene.applyModifiers(modifiers.TempBattleStatBoosterModifier,true,stat,owner);
    context.roster.entries[1-seat].pokemon.scene.applyModifiers(modifiers.TempBattleStatBoosterModifier,true,stat,peer);
    binding.scene.applyModifiers(modifiers.TempBattleStatBoosterModifier,true,stat,shared);
    assert.ok(owner.value>0);assert.equal(peer.value,0);assert.equal(shared.value,owner.value);await scoped.drain();
  }finally{scoped.dispose();tasks.close();binding.dispose();}
});

for(const seat of [0,1])test(`original critical roll actually uses seat ${seat} item and not the partner's`,async()=>{
  const initial=await itemRoundContext({seed:'item-critical-33'}),plain=await damageResult(initial,seat);
  const type=new types.TempBattleStatBoosterModifierType(6);type.id='TEMP_STAT_BOOSTER';
  initial.players[1-seat].modifiers.push(type.newModifier());assert.deepEqual((await damageResult(initial,seat)).damage,plain.damage);
  initial.players[seat].modifiers.push(type.newModifier());const boosted=await damageResult(initial,seat);
  assert.equal(plain.damage.critical,false);assert.equal(boosted.damage.critical,true);assert.ok(boosted.damage.damage>plain.damage.damage);
});

for(const seat of [0,1])test(`original hit check applies seat ${seat} X Accuracy without sharing the partner's boost`,async()=>{
  const initial=await itemRoundContext({seed:'item-accuracy-2'}),actor=initial.roster.entries[seat].pokemon;
  actor.summonData.battleStats[5]=-1;queue(initial,new originalPhases.MovePhase({},actor,[2],actor.moveset[0]));
  const type=new types.TempBattleStatBoosterModifierType(5);type.id='TEMP_STAT_BOOSTER';initial.players[1-seat].modifiers.push(type.newModifier());
  const missed=await differential(initial,{stop:current=>nextPostPhase(current)?.constructor===originalPhases.MoveEndPhase});
  assert.equal(missed.context.roster.entries[2].pokemon.turnData.attacksReceived.length,0);
  initial.players[seat].modifiers.push(type.newModifier());
  const hit=await differential(initial,{stop:current=>nextPostPhase(current)?.constructor===originalPhases.MoveEndPhase});
  assert.equal(hit.context.roster.entries[2].pokemon.turnData.attacksReceived.length,1);
});

test('unscoped personal effect fails instead of borrowing either player and bindings are removed after use',async()=>{
  const context=await itemRoundContext(),phase=new originalPhases.TurnEndPhase({});addBattleItem(context,0,'HEALING_CHARM');
  const binding=bindAction(context,phase),tasks=createRuleTaskTracker(binding.scene);let original;
  const scoped=bindBattleItems(context,phase,binding,tasks,{onModifierBind:(_context,base)=>{original=base.scene.applyModifiers;}});
  try{assert.throws(()=>binding.scene.applyModifiers(modifiers.HealingBoosterModifier,true,new utils.NumberHolder(10)),{code:'AMBIGUOUS_MODIFIER_OWNER'});await scoped.drain();}
  finally{scoped.dispose();assert.equal(binding.scene.applyModifiers,original);tasks.close();binding.dispose();}
  assert.ok(context.roster.entries.every(entry=>!Object.hasOwn(entry.pokemon,'scene')));codec.capture(context);
});

for(const seat of [0,1,null])for(const stack of [1,2])test(`original TurnEnd -> Berry -> Heal consumes owner ${seat} stack ${stack} exactly once`,async()=>{
  const initial=await itemRoundContext(),actor=initial.roster.entries[seat??2].pokemon;
  actor.hp=10;addBattleItem(initial,seat,'BERRY',{stack});
  addBattleItem(initial,seat===0?1:0,'BERRY',{stack:2});
  queue(initial,new originalPhases.TurnEndPhase({}));const result=await differential(initial);
  assert.equal(result.phases.filter(name=>name==='BerryPhase').length,1);
  assert.equal(result.phases.filter(name=>name==='PokemonHealPhase').length,1);
  assert.equal(items(result.context,seat).filter(item=>item instanceof modifiers.BerryModifier).length,stack===1?0:1);
  if(stack===2){assert.equal(items(result.context,seat)[0].stackCount,1);assert.equal(items(result.context,seat)[0].consumed,false);}
  assert.equal(items(result.context,seat===0?1:0)[0].stackCount,2);
  assert.ok(result.context.roster.entries[seat??2].pokemon.hp>10);
  const healed=result.context.roster.entries[seat??2].pokemon.hp;
  assert.equal(clone(result.context).roster.entries[seat??2].pokemon.hp,healed);
});

test('personal Healing Charm amplifies only its owner and full berry preservation does not consume the stack',async()=>{
  const initial=await itemRoundContext();for(const seat of [0,1]){initial.roster.entries[seat].pokemon.hp=10;addBattleItem(initial,seat,'BERRY');}
  addBattleItem(initial,1,'HEALING_CHARM',{stack:3});addBattleItem(initial,1,'BERRY_POUCH',{stack:3});
  queue(initial,new originalPhases.TurnEndPhase({}));const result=await differential(initial);
  assert.ok(result.context.roster.entries[1].pokemon.hp>result.context.roster.entries[0].pokemon.hp);
  assert.equal(result.context.players[0].modifiers.length,0);
  assert.equal(result.context.players[1].modifiers.find(item=>item instanceof modifiers.BerryModifier).stackCount,1);
});

for(const berry of [berryRules.BerryType.LUM,berryRules.BerryType.LEPPA])test(`original berry ${berry} heals status or restores PP and survives checkpoint comparison`,async()=>{
  const initial=await itemRoundContext(),actor=initial.roster.entries[1].pokemon;
  if(berry===berryRules.BerryType.LUM)actor.status=new status.Status(status.StatusEffect.PARALYSIS);
  else actor.moveset[0].ppUsed=actor.moveset[0].getMovePp();
  addBattleItem(initial,1,'BERRY',{berry});queue(initial,new originalPhases.TurnEndPhase({}));
  const result=await differential(initial),restored=result.context.roster.entries[1].pokemon;
  assert.equal(result.context.players[1].modifiers.length,0);
  if(berry===berryRules.BerryType.LUM)assert.equal(restored.status,undefined);else assert.ok(restored.moveset[0].ppUsed<actor.moveset[0].ppUsed);
});

test('original full FIGHT round executes Shell Bell, MoveEnd, Leftovers and enemy berry without double damage',async()=>{
  const initial=await itemRoundContext();initial.roster.entries[0].pokemon.hp-=25;initial.roster.entries[2].pokemon.hp=50;
  addBattleItem(initial,0,'SHELL_BELL');addBattleItem(initial,0,'LEFTOVERS');addBattleItem(initial,null,'BERRY',{stack:2});
  const result=await differential(initial);
  for(const name of ['MovePhase','MoveEffectPhase','DamagePhase','MoveEndPhase','TurnEndPhase','PokemonHealPhase','BerryPhase','CommandPhase'])assert.ok(result.phases.includes(name),name);
  assert.equal(result.context.enemyModifiers[0].stackCount,1);assert.ok(result.events.filter(event=>event.kind==='heal-display').length>=3);
  assert.equal(result.context.battle.turn,initial.battle.turn+1);
});

for(const seat of [0,1])test(`real subsequent commands for both players execute owner ${seat} healing and consume one berry`,async()=>{
  const initial=await itemInputContext(seat),turn=initial.battle.turn;
  const result=await differential(initial,{stop:current=>current.battle.turn>turn&&current.decision.kind==='wait-actions'});
  assert.equal(result.context.players[seat].modifiers.find(item=>item.type.id==='BERRY').stackCount,1);
  assert.ok(result.context.roster.entries[seat].pokemon.hp>20);assert.ok(result.phases.includes('EnemyCommandPhase'));
});

for(const seat of [0,1])test(`real lethal action retains held items and replacement seat ${seat} receives only its own modifier scene`,async()=>{
  const initial=await itemRoundContext(),outgoing=initial.roster.entries[seat].pokemon;
  const reserve=pokemon.restorePokemonState(pokemon.capturePokemonState(outgoing));reserve.id=500+seat;
  initial.roster.entries.push({owner:seat,group:'party',index:1,pokemon:reserve});
  outgoing.hp=1;initial.battle.turnCommands[2].move.targets=[seat];initial.roster.entries[2].pokemon.stats[5]=1000;
  addBattleItem(initial,seat,'BERRY',{pokemonId:outgoing.id});addBattleItem(initial,seat,'LEFTOVERS',{pokemonId:reserve.id});
  addBattleItem(initial,1-seat,'HEALING_CHARM',{stack:3});const stages=new Set();
  const result=await differential(initial,{options:{onSwitchBind:(context,_phase,binding,_tasks,detail)=>{
    stages.add(detail.stage);const incoming=context.roster.entries.find(entry=>entry.pokemon.id===reserve.id).pokemon;
    assert.equal(incoming.scene.modifiers,context.players[seat].modifiers);
    assert.ok(!incoming.scene.modifiers.some(item=>item.type.id==='HEALING_CHARM'));
  }}});
  assert.equal(result.context.roster.field[seat],reserve.id);assert.ok(result.phases.includes('FaintPhase'));assert.ok(result.phases.includes('SwitchSummonPhase'));
  assert.ok(stages.has('summon-initialize')&&stages.has('summon-finish')&&stages.has('post-summon'));
  assert.equal(result.context.players[seat].modifiers.find(item=>item instanceof modifiers.BerryModifier).stackCount,1);
});

test('naturally generated encounter items remain bound through the next real input and original attack',async()=>{
  let context=(await createEncounter(await encounterContext({seed:'encounter-items-3'}))).context;
  while(context.decision.kind!=='wait-actions')context=(await advanceEncounterEntry(context,choosePreBattle(context,{accept:false}))).context;
  const inventory=saved(context).enemyModifiers;context.decision.id='battle-items-0';
  const result=await differential(context,{stop:current=>nextPostPhase(current)?.constructor===originalPhases.DamagePhase});
  assert.ok(result.phases.includes('EnemyCommandPhase'));assert.ok(result.phases.includes('MoveEffectPhase'));
  assert.deepEqual(saved(result.context).enemyModifiers,inventory);
});

for(const seat of [0,1])test(`original pre-battle return, summon and entry retain seat ${seat} items before the real next action`,async()=>{
  const initial=(await createEncounter(await encounterContext({seed:'encounter-items-3',reserves:true}))).context;
  const reserve=initial.roster.entries.find(entry=>entry.owner===seat&&entry.index===1).pokemon;
  addBattleItem(initial,seat,'LEFTOVERS',{pokemonId:reserve.id});addBattleItem(initial,1-seat,'HEALING_CHARM');
  let actual=clone(initial),expected=clone(initial);const stages=new Set();
  const options=reference=>({bindModifiers:(context,phase,binding,tasks)=>bindBattleItems(context,phase,binding,tasks,{reference}),
    onSwitchBind:(context,_phase,_binding,_tasks,detail)=>{
      stages.add(detail.stage);const incoming=context.roster.entries.find(entry=>entry.pokemon.id===reserve.id).pokemon;
      assert.equal(incoming.scene.modifiers,context.players[seat].modifiers);
    }});
  for(let step=0;actual.decision.kind!=='wait-actions';step++){
    assert.ok(step<50);const inputs=choosePreBattle(actual,{accept:actual.decision.requiredSeats[0]===seat});
    const next=await advanceEncounterEntry(actual,inputs,options(false)),reference=await referenceEncounterEntry(expected,copy(inputs),options(true));
    assert.deepEqual(next.events,reference.events);assert.deepEqual(saved(next.context),saved(reference.context));actual=clone(next.context);expected=reference.context;
  }
  assert.equal(actual.roster.field[seat],reserve.id);assert.ok(stages.has('switch-swap')&&stages.has('summon-finish'));
  actual.decision.id='battle-items-0';const result=await differential(actual,{stop:current=>nextPostPhase(current)?.constructor===originalPhases.DamagePhase});
  assert.ok(result.phases.includes('MoveEffectPhase'));assert.equal(result.context.players[seat].modifiers.find(item=>item.type.id==='LEFTOVERS').pokemonId,reserve.id);
});

test('personal and enemy update rejection cannot publish consumed berries or changed RNG',async()=>{
  for(const seat of [0,1,null]){
    const initial=await itemRoundContext();initial.roster.entries[seat??2].pokemon.hp=10;addBattleItem(initial,seat,'BERRY');
    queue(initial,new originalPhases.TurnEndPhase({}));
    const pending=await until(initial,current=>nextPostPhase(current)?.constructor===originalPhases.BerryPhase),before=saved(pending);
    await assert.rejects(advanceBattleItems(pending,{}, {updateInfo:(_actor,owner)=>owner===seat?Promise.reject(Error('item-update-fault')):Promise.resolve()}),/item-update-fault/);
    assert.deepEqual(saved(pending),before);assert.deepEqual(saved((await advanceBattleItems(pending)).context),saved((await referenceBattleItems(clone(pending))).context));
  }
});

test('pending healing display blocks commit and rejection preserves the queued heal for retry',async()=>{
  const initial=await itemRoundContext();initial.roster.entries[1].pokemon.hp=10;addBattleItem(initial,1,'BERRY');
  queue(initial,new originalPhases.TurnEndPhase({}));
  const pending=await until(initial,current=>nextPostPhase(current)?.constructor===originalPhases.PokemonHealPhase),before=saved(pending);
  let release,started,settled=false;const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve);
  const running=advanceBattleItems(pending,{}, {updateInfo:(_actor,seat)=>{if(seat===1){started();return gate;}return Promise.resolve();}}).then(result=>{settled=true;return result;});
  await begun;await Promise.resolve();assert.equal(settled,false);assert.deepEqual(saved(pending),before);release();await running;
  await assert.rejects(advanceBattleItems(pending,{}, {updateInfo:()=>Promise.reject(Error('heal-display-fault'))}),/heal-display-fault/);
  assert.deepEqual(saved(pending),before);
});

test('unsupported transfer and berry branches reject atomically instead of silently dropping their effects',async()=>{
  for(const id of ['GRIP_CLAW','BERRY']){
    const context=await itemRoundContext();addBattleItem(context,0,id,{berry:berryRules.BerryType.STARF});const before=saved(context);
    await assert.rejects(advanceBattleItems(context),/UNSUPPORTED_BATTLE_(ITEM|BERRY)/);assert.deepEqual(saved(context),before);
  }
});
