import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import {effectContext,executePreparation,optionAction,validateEffect} from './helpers/preparation-effects-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {types} from './helpers/modifier-model.mjs';
import {parse,status} from './helpers/original-model.mjs';
import {projectPreparation,restorePreparation} from './helpers/preparation-model.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c));
function reward(c,id){const type=types.modifierTypes[id]();type.id=id;c.decision.players[0].rewards=[{id:'fixture-reward',type:types.captureModifierTypeState(type),cost:0}];}
function setup(c,id){const pk=c.roster.entries[0].pokemon;
  if(id==='REVIVE'){pk.hp=0;pk.status=new status.Status(status.StatusEffect.FAINT);}
  else if(id==='POTION'||id==='FULL_HEAL'){pk.hp=1;pk.status=new status.Status(status.StatusEffect.POISON);}
  if(id==='ETHER'||id==='PP_UP'){pk.getMoveset()[0].ppUsed=5;pk.getMoveset()[0].ppUp=0;}
  reward(c,id);return optionAction(c,0,'reward',id,['POTION','REVIVE','FULL_HEAL','ETHER','PP_UP'].includes(id)?pk.id:null,['ETHER','PP_UP'].includes(id)?0:null);
}
for(const id of ['POKEBALL','NUGGET','POTION','REVIVE','FULL_HEAL','ETHER','PP_UP'])
test(`restored original ${id} reward callback equals frozen continuous callback and applies only once`,async()=>{
  const c=await effectContext(),a=setup(c,id),before=saved(c),ref=await executePreparation(codec.restore(before),0,a,{reference:true});
  const r=await executePreparation(codec.restore(before),0,a);assert.deepEqual(saved(r.context),saved(ref.context));
  assert.deepEqual(saved(c),before);assert.equal(r.context.decision.players[0].rewardResolved,true);assert.equal(r.grants.length,0);
  assert.deepEqual(saved(r.context).players[1],before.players[1]);assert.deepEqual(saved(r.context).battle,before.battle);
  const restored=codec.restore(saved(r.context));await assert.rejects(executePreparation(restored,0,a),/INVALID_PREPARATION_OPTION/);
  assert.deepEqual(saved(restored),saved(r.context));
});
for(const seat of [0,1])test(`original personal shop seat ${seat} charges once, keeps reward available and clears ready`,async()=>{
  const c=await effectContext(),pk=c.roster.entries.find(e=>e.owner===seat).pokemon;pk.hp=1;
  const a=optionAction(c,seat,'buy','POTION',pk.id),before=saved(c),cost=c.decision.players[seat].shop[0].cost;
  const ref=await executePreparation(codec.restore(before),seat,a,{reference:true}),r=await executePreparation(codec.restore(before),seat,a);
  assert.deepEqual(saved(r.context),saved(ref.context));assert.equal(r.context.players[seat].money,c.players[seat].money-cost);
  assert.equal(r.context.roster.entries.find(e=>e.pokemon.id===pk.id).pokemon.hp,21);assert.equal(r.context.decision.players[seat].rewardResolved,false);
  assert.deepEqual(r.context.decision.players[1-seat],c.decision.players[1-seat]);
});
test('original repeated reroll callback and newly queued original start preserve price, options, room RNG and lure exclusion',async()=>{
  let c=await effectContext(),reference=codec.restore(saved(c));const a={kind:'preparation',operation:'reroll'};let total=0;
  for(let i=1;i<=3;i++){
    total+=c.decision.players[0].rerollCost;const ref=await executePreparation(reference,0,a,{reference:true});reference=ref.context;
    c=(await executePreparation(codec.restore(saved(c)),0,a)).context;assert.deepEqual(saved(c),saved(reference));
    assert.equal(c.players[0].money,3000-total);assert.equal(c.decision.players[0].rerollCount,i);
    assert.equal(c.decision.players[0].rerollCost,250*2**i);assert.equal(saved(c).pendingEffects[0].phase.fields.rerollCount.value,i);
    assert.ok(c.decision.players[0].rewards.every(o=>!['LURE','SUPER_LURE','MAX_LURE'].includes(o.type.catalogId)));
  }
});
test('own healing modifiers use original effects without using the partner boosters',async()=>{
  const c=await effectContext(),type=types.modifierTypes.HEALING_CHARM();type.id='HEALING_CHARM';c.players[0].modifiers.push(type.newModifier());
  c.roster.entries[0].pokemon.stats[0]=100;
  const a=setup(c,'POTION'),before=saved(c),r=await executePreparation(c,0,a),ref=await executePreparation(codec.restore(before),0,a,{reference:true});
  assert.deepEqual(saved(r.context),saved(ref.context));assert.equal(r.context.roster.entries[0].pokemon.hp,23);
  assert.deepEqual(saved(r.context).players[1],before.players[1]);
});
test('pure validation rejects foreign/no-effect targets, stale prices, bad move, vouchers and complex effects without RNG draws',async()=>{
  const c=await effectContext();c.roster.entries[0].pokemon.hp=1;
  for(const id of ['VOUCHER','RARE_CANDY']){reward(c,id);const a=optionAction(c,0,'reward',id);const before=saved(c);
    assert.throws(()=>validateEffect(c,0,a),id==='VOUCHER'?/COOP_VOUCHER_RULE_UNCONFIRMED/:/PREPARATION_EFFECT_UNAVAILABLE/);assert.deepEqual(saved(c),before);}
  for(const mutate of [c=>{c.decision.players[0].shop[0].cost=1;},c=>{c.roster.entries[0].pokemon.hp=c.roster.entries[0].pokemon.getMaxHp();}]){
    const x=codec.restore(saved(c));mutate(x);const before=saved(x);assert.throws(()=>validateEffect(x,0,optionAction(x,0,'buy','POTION',100)));assert.deepEqual(saved(x),before);
  }
  const before=saved(c);assert.throws(()=>validateEffect(c,0,optionAction(c,0,'buy','POTION',101)),/INVALID_PREPARATION_OWNER/);assert.deepEqual(saved(c),before);
  const ether=optionAction(c,0,'buy','ETHER',100,3);assert.throws(()=>validateEffect(c,0,ether),/INVALID_PREPARATION_MOVE/);
});
test('async update failure, inventory tampering and failed reroll menu leave the old charge, effect, RNG and options intact',async()=>{
  const c=await effectContext();c.roster.entries[0].pokemon.hp=1;const a=optionAction(c,0,'buy','POTION',100),before=saved(c);
  for(const options of [{updateInfo:()=>Promise.reject(Error('update'))},{onEffectBind:c=>{c.players[1].money++;}}]){
    await assert.rejects(executePreparation(c,0,a,options));assert.deepEqual(saved(c),before);
  }
  await assert.rejects(executePreparation(c,0,{kind:'preparation',operation:'reroll'},{onMenuBind:(_c,_p,_b,t)=>t.add(Promise.reject(Error('menu')))}));
  assert.deepEqual(saved(c),before);
});
test('private applied preparation view survives item effects and new original reroll phase',async()=>{
  let c=await effectContext();c=(await executePreparation(c,1,{kind:'preparation',operation:'reroll'})).context;
  for(const seat of [0,1]){const view=projectPreparation(c,seat),model=restorePreparation({...copy(view),seat});
    assert.deepEqual(copy(projectPreparation(model,seat)),copy(view));assert.equal(view.shared.battle.decision.players[1-seat].rewards.length,0);}
});
test('named original callback extraction preserves the frozen callback body',()=>{
  const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/early-preparation-effects-reference.json',import.meta.url),'utf8'));
  const old=ts.createSourceFile('old.ts',`class C{${frozen.start}}`,ts.ScriptTarget.Latest,true).statements[0].members[0].body.statements
    .find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText()==='modifierSelectCallback')).declarationList.declarations[0].initializer.body;
  const current=parse('phases.ts').statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='SelectModifierPhase').members
    .find(n=>n.name?.getText()==='createModifierSelectCallback').body.statements.find(n=>ts.isVariableStatement(n)
      &&n.declarationList.declarations.some(d=>d.name.getText()==='modifierSelectCallback')).declarationList.declarations[0].initializer.body;
  assert.equal(current.getText().replaceAll('\r\n','\n'),old.getText().replaceAll('\r\n','\n'));
});
