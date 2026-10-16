import test from 'node:test';
import assert from 'node:assert/strict';
import {encounterContext,createEncounter,referenceEncounter,advanceEncounterEntry,referenceEncounterEntry,choosePreBattle,inspectPersonalStats,encounterModifierDriver} from './helpers/encounter-modifiers-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {persistentType} from './helpers/persistent-rewards-model.mjs';
import {modifiers} from './helpers/modifier-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import {advanceNextBattle} from '../src/battle-core/next-battle-runner.mjs';
const saved=c=>copy(codec.capture(c));
for(const [seed,item]of [[0,null],[3,'BASE_STAT_BOOSTER'],[36,'BERRY']])test(`natural encounter seed ${seed} original item generation and entry equal continuous frozen execution`,async()=>{
  const initial=await encounterContext({seed:`encounter-items-${seed}`,reserves:true}),before=saved(initial);
  let expected=await referenceEncounter(codec.restore(before)),actual=await createEncounter(initial);
  assert.deepEqual(actual.events,expected.events);assert.deepEqual(saved(actual.context),saved(expected.context));assert.deepEqual(saved(initial),before);
  const c=actual.context;
  assert.equal(c.enemyModifiers.length,item?1:0);
  if(item){const m=c.enemyModifiers[0];assert.equal(m.type.generatorId||m.type.id,item);assert.ok(m instanceof modifiers.PokemonHeldItemModifier);assert.ok(c.battle.enemyParty.some(p=>p.id===m.pokemonId));}
  const originalInventory=saved(c).players.map(p=>p.modifiers.length),items=copy(saved(c).enemyModifiers);
  for(let i=0;actual.context.decision.kind!=='wait-actions';i++){
    assert.ok(i<14);const inputs=choosePreBattle(actual.context,{accept:false});
    expected=await referenceEncounterEntry(expected.context,inputs);
    actual=await advanceEncounterEntry(codec.restore(saved(actual.context)),inputs);
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(saved(actual.context),saved(expected.context));
  }
  assert.deepEqual(saved(actual.context).enemyModifiers,items);assert.deepEqual(saved(actual.context).players.map(p=>p.modifiers.length),originalInventory);
  assert.deepEqual(actual.context.decision.requiredSeats,[0,1]);assert.equal(actual.context.battle.turn,1);
});

test('enemy stat updates use original held item effect and restore repeatably',async()=>{
  const r=await createEncounter(await encounterContext({seed:'encounter-items-3'})),c=r.context;
  const enemy=c.battle.enemyParty.find(p=>p.id===c.enemyModifiers[0].pokemonId),before=copy(enemy.stats);
  assert.ok(before[0]<100);assert.equal(enemy.hp,before[0]);
  // Compare the original calculator with and without the naturally drawn item.
  const snapshots=[];
  for(const include of [true,false]){
    const clone=codec.restore(saved(c));if(!include)clone.enemyModifiers=[];
    await createEncounterProbe(clone,pk=>{pk.calculateStats();snapshots.push(copy(pk.stats));},enemy.id);
  }
  assert.deepEqual(snapshots[0],before);
  // At this low level a single vitamin can round to the same final stat. Probe
  // its original apply method separately rather than inventing a stat delta.
  await createEncounterProbe(codec.restore(saved(c)),pk=>{
    const baseStats=[100,100,100,100,100,100];pk.scene.applyModifiers(modifiers.PokemonBaseStatModifier,false,pk,baseStats);
    assert.ok(baseStats.some(v=>v>100));
  },enemy.id);
});
test('enemy update tasks must finish before candidate creation returns',async()=>{
  const c=await encounterContext({seed:'encounter-items-36'}),before=saved(c);
  let release,started,settled=false;const gate=new Promise(r=>release=r),begun=new Promise(r=>started=r);
  const pending=createEncounter(c,{updateInfo:(_pk,seat)=>{if(seat===null){started();return gate;}return Promise.resolve();}})
    .then(result=>{settled=true;return result;});
  await begun;await Promise.resolve();assert.equal(settled,false);assert.deepEqual(saved(c),before);
  release();const result=await pending;assert.equal(result.context.enemyModifiers.length,1);assert.deepEqual(saved(c),before);
});
test('original enemy add stacks matching held items and rejects overflow without altering personal lists',async()=>{
  const c=(await createEncounter(await encounterContext({seed:'encounter-items-3'}))).context;
  const item=c.enemyModifiers[0],inventory=c.players.map(p=>p.modifiers.map(m=>[m.type.id,m.stackCount]));
  await createEncounterProbe(c,pk=>{
    const max=item.getMaxStackCount(pk.scene),before=item.stackCount;
    assert.equal(item.clone().add(c.enemyModifiers,false,pk.scene),before<max);
    assert.equal(item.stackCount,before<max?before+1:before);assert.equal(c.enemyModifiers.length,1);
    item.stackCount=max;assert.equal(item.clone().add(c.enemyModifiers,false,pk.scene),false);assert.equal(item.stackCount,max);
  },item.pokemonId);
  assert.deepEqual(c.players.map(p=>p.modifiers.map(m=>[m.type.id,m.stackCount])),inventory);
  assert.deepEqual(saved(codec.restore(saved(c))),saved(c));
});
async function createEncounterProbe(c,probe,id){
  const {bindAction}=await import('./helpers/move-execution-model.mjs');
  const {bindEncounterModifierScenes}=await import('./helpers/encounter-modifier-binding.mjs');
  const {createRuleTaskTracker}=await import('../src/battle-core/rule-task-tracker.mjs');
  const b=bindAction(c,new originalPhases.TurnInitPhase({})),tasks=createRuleTaskTracker(b.scene),binding=bindEncounterModifierScenes(c,b,tasks);
  try{probe(c.battle.enemyParty.find(p=>p.id===id));await binding.drain();}finally{binding.dispose();tasks.close();b.dispose();}
}

test('personal original stat and temporary battle-stat queries stay with their owner after JSON restore',async()=>{
  const c=await encounterContext(),type=persistentType('TEMP_STAT_BOOSTER');c.players[0].modifiers.push(type.newModifier());
  const before=saved(c),probe=(pk,seat)=>({id:pk.id,seat,hp:pk.stats[0],atk:pk.getBattleStat(1),items:pk.scene.modifiers.map(m=>m.type.id)});
  const baseline=await inspectPersonalStats(c,probe),r=await createEncounter(c);
  assert.deepEqual(await inspectPersonalStats(codec.restore(saved(r.context)),probe),baseline);
  assert.ok(baseline.filter(p=>p.seat===0).every(p=>p.items.includes('TEMP_STAT_BOOSTER')));
  assert.ok(baseline.filter(p=>p.seat===1).every(p=>!p.items.includes('TEMP_STAT_BOOSTER')&&!p.items.includes('BASE_STAT_BOOSTER')));
  const without=codec.restore(before);without.players[0].modifiers=without.players[0].modifiers.filter(m=>m.type.id!=='TEMP_STAT_BOOSTER');
  const plain=await inspectPersonalStats(without,probe);
  assert.ok(baseline[0].atk>plain[0].atk);assert.equal(baseline[1].atk,plain[1].atk);
  assert.deepEqual(saved(c),before);
});

for(const failure of ['stats','info'])test(`original enemy ${failure} rejection rejects candidate and preserves inventory, eggs and RNG`,async()=>{
  const c=await encounterContext({seed:'encounter-items-3'}),before=saved(c);
  const options=failure==='info'?{updateInfo:(_pk,seat)=>seat===null?Promise.reject(Error('info-fault')):Promise.resolve()}
    :{onBind:(_c,p,b)=>{if(p.constructor!==originalPhases.NextEncounterPhase)return;const add=b.scene.addEnemyPokemon;
      b.scene.addEnemyPokemon=(...args)=>{const pk=add(...args);pk.calculateStats=()=>{throw Error('stats-fault');};return pk;};}};
  await assert.rejects(createEncounter(c,options),new RegExp(`${failure}-fault`));assert.deepEqual(saved(c),before);
  const retry=await createEncounter(c),reference=await referenceEncounter(codec.restore(before));assert.deepEqual(saved(retry.context),saved(reference.context));
});

for(const change of ['stack','type','owner','alias'])test(`enemy generation cannot mutate personal ${change}`,async()=>{
  const c=await encounterContext({seed:'encounter-items-3'}),before=saved(c);
  await assert.rejects(createEncounter(c,{onBind:(ctx,p,b)=>{
    if(p.constructor!==originalPhases.NextEncounterPhase)return;
    if(change==='stack')ctx.players[1].modifiers[0].stackCount++;
    if(change==='type')ctx.players[0].modifiers[0].type.tier=3;
    if(change==='owner')ctx.players[1].modifiers[1].pokemonId=100;
    if(change==='alias'){const add=b.scene.addEnemyPokemon;b.scene.addEnemyPokemon=(...args)=>{const pk=add(...args);pk.ivs=ctx.roster.entries[0].pokemon.ivs;return pk;};}
  }}),/NEXT_BATTLE_(RESOURCE_CHANGED|ENEMY_PARTY_ALIAS)|INVALID_MODIFIER_OWNER/);assert.deepEqual(saved(c),before);
});

test('enemy modifier postcondition rejects a foreign holder without publishing generation',async()=>{
  const c=await encounterContext({seed:'encounter-items-3'}),before=saved(c),base=encounterModifierDriver();
  const driver={...base,async execute(ctx,p){const r=await base.execute(ctx,p);if(p.constructor===originalPhases.NextEncounterPhase)ctx.enemyModifiers[0].pokemonId=100;return r;}};
  await assert.rejects(advanceNextBattle(c,codec,driver,{decisionId:'bad-holder'}),/INVALID_(ENCOUNTER_MODIFIERS|MODIFIER_OWNER)/);assert.deepEqual(saved(c),before);
});
test('unsupported personal encounter phases reject before rolls and preserve v6 without inventing eggs',async()=>{
  const c=await encounterContext();delete c.eggState;
  const r=await createEncounter(c);assert.equal(saved(r.context).version,6);assert.equal(Object.hasOwn(r.context,'eggState'),false);
  const type=persistentType('IV_SCANNER');c.players[0].modifiers.push(type.newModifier());const before=saved(c);
  await assert.rejects(createEncounter(c),/UNSUPPORTED_PERSONAL_ENCOUNTER_MODIFIER/);assert.deepEqual(saved(c),before);
});
