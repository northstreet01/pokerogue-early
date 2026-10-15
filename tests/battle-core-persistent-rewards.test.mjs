import test from 'node:test';
import assert from 'node:assert/strict';
import {persistentContext,persistentType,rewardIntent,executePreparation,optionAction} from './helpers/persistent-rewards-model.mjs';
import {validateEffect} from './helpers/preparation-effects-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {types,modifiers} from './helpers/modifier-model.mjs';
import {projectPreparation,restorePreparation} from './helpers/preparation-model.mjs';
import {preparationDriver} from './helpers/preparation-model.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c));
for(const id of ['EXP_CHARM','HEALING_CHARM','EXP_SHARE','GOLDEN_POKEBALL','AMULET_COIN','LUCKY_EGG',
  'BASE_STAT_BOOSTER','ATTACK_TYPE_BOOSTER','BERRY','TEMP_STAT_BOOSTER','SOUL_DEW'])
test(`original persistent ${id} acquisition, stacking and update equal frozen rules after JSON restore`,async()=>{
  const c=await persistentContext({id,existing:1,peerModifier:true}),before=saved(c),a=rewardIntent(c);
  const ref=await executePreparation(codec.restore(before),0,a,{reference:true}),r=await executePreparation(codec.restore(before),0,a);
  assert.deepEqual(saved(r.context),saved(ref.context));assert.deepEqual(saved(c),before);
  assert.equal(r.context.players[0].modifiers.length,1);assert.equal(r.context.players[0].modifiers[0].stackCount,2);
  assert.equal(r.context.decision.players[0].rewardResolved,true);assert.equal(r.grants.length,0);
  assert.equal(r.context.players[1].modifiers[0].stackCount,2);
  const restored=codec.restore(saved(r.context));assert.deepEqual(saved(restored),saved(r.context));
  await assert.rejects(executePreparation(restored,0,a),/INVALID_PREPARATION_OPTION/);
});
test('original full global stack keeps its modifier and grants the original tier fallback once',async()=>{
  const c=await persistentContext({id:'GOLDEN_POKEBALL',existing:3,peerModifier:true}),before=saved(c),a=rewardIntent(c);
  const ref=await executePreparation(codec.restore(before),0,a,{reference:true}),r=await executePreparation(c,0,a);
  assert.deepEqual(saved(r.context),saved(ref.context));assert.equal(r.context.players[0].modifiers[0].stackCount,3);
  assert.equal(r.context.players[0].pokeballCounts[2],c.players[0].pokeballCounts[2]+5);
  assert.deepEqual(r.context.players[1].pokeballCounts,c.players[1].pokeballCounts);
});
test('held-item full stacks and foreign targets reject purely without rerolling options or binding scenes to input',async()=>{
  const c=await persistentContext({id:'LUCKY_EGG',existing:99}),type=types.restoreModifierTypeState(c.decision.players[0].rewards[0].type);
  // Derive the original cap from its method, rather than duplicate a rule.
  c.players[0].modifiers[0].stackCount=c.players[0].modifiers[0].getMaxHeldItemCount(c.roster.entries[0].pokemon);
  const before=saved(c);assert.throws(()=>validateEffect(c,0,rewardIntent(c)),/INVALID_PREPARATION_TARGET/);
  assert.deepEqual(saved(c),before);assert.ok(!Object.hasOwn(c.roster.entries[0].pokemon,'scene'));
  const a=rewardIntent(c);a.pokemonId=101;assert.throws(()=>validateEffect(c,0,a),/INVALID_PREPARATION_OWNER/);assert.deepEqual(saved(c),before);
});
test('original golden pokeball improves only the owner next menu count and other menus stay unchanged',async()=>{
  const c=await persistentContext({id:'GOLDEN_POKEBALL'}),r=(await executePreparation(c,0,rewardIntent(c))).context;
  const x=codec.restore(saved(r)),peer=copy(x.decision.players[1]);
  const menu=await preparationDriver().openPersonalMenu(x,null,{seat:0});
  assert.equal(menu.rewards.length,4);assert.deepEqual(x.decision.players[1],peer);
  assert.ok(menu.rewards.every(o=>!['LURE','SUPER_LURE','MAX_LURE'].includes(o.type.catalogId)));
});
test('original vitamin updates actual max HP and healing delta through the original Array guard',async()=>{
  const c=await persistentContext({id:'BASE_STAT_BOOSTER',existing:15}),before=saved(c),oldMax=c.roster.entries[0].pokemon.getMaxHp();
  const r=await executePreparation(c,0,rewardIntent(c)),ref=await executePreparation(codec.restore(before),0,rewardIntent(c),{reference:true});
  assert.deepEqual(saved(r.context),saved(ref.context));assert.ok(r.context.roster.entries[0].pokemon.getMaxHp()>oldMax);
  assert.equal(r.context.players[0].modifiers[0].stackCount,16);
});
test('original updated modifiers affect later personal money or healing through the existing effect chain',async()=>{
  let c=await persistentContext({id:'HEALING_CHARM'});c=(await executePreparation(c,0,rewardIntent(c))).context;
  const pk=c.roster.entries[0].pokemon;pk.stats[0]=100;pk.hp=1;
  const r=await executePreparation(c,0,optionAction(c,0,'buy','POTION',pk.id));assert.equal(r.context.roster.entries[0].pokemon.hp,23);
  c=await persistentContext({id:'AMULET_COIN'});c=(await executePreparation(c,0,rewardIntent(c))).context;
  const type=types.modifierTypes.NUGGET();type.id='NUGGET';c.decision.players[0].rewards=[{id:'fixture-money',type:types.captureModifierTypeState(type),cost:0}];
  c.decision.players[0].rewardResolved=false;const ref=await executePreparation(codec.restore(saved(c)),0,rewardIntent(c),{reference:true});
  const money=await executePreparation(c,0,rewardIntent(c));assert.deepEqual(saved(money.context),saved(ref.context));assert.ok(money.context.players[0].money>c.players[0].money);
});
test('original update failure or peer modifier mutation cannot publish a newly acquired persistent reward',async()=>{
  const c=await persistentContext({peerModifier:true}),before=saved(c),a=rewardIntent(c);
  for(const options of [{updateInfo:()=>Promise.reject(Error('original update'))},
    {onEffectBind:c=>{c.players[1].modifiers[0].stackCount++;}},
    {onEffectBind:c=>{c.roster.entries.find(e=>e.owner===1).pokemon.ivs=c.roster.entries.find(e=>e.owner===0).pokemon.ivs;}},
    {onEffectBind:c=>{c.roster.entries.find(e=>e.owner===1).pokemon.hp--;}}]){
    await assert.rejects(executePreparation(c,0,a,options));assert.deepEqual(saved(c),before);
  }
});
test('personal persistent modifier projection tolerates changing component indices and restores original classes',async()=>{
  const c=await persistentContext({id:'LUCKY_EGG',peerModifier:true}),r=(await executePreparation(c,0,rewardIntent(c))).context;
  for(const seat of [0,1]){const view=projectPreparation(r,seat),model=restorePreparation({...copy(view),seat});
    assert.deepEqual(copy(projectPreparation(model,seat)),copy(view));
    for(const m of model.context.players[seat].modifiers)assert.ok(m instanceof modifiers.PersistentModifier);
    assert.equal(model.context.players[1-seat].modifiers.length,0);}
});
