import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {createOriginalRuleHost} from '../server/original-rule-host.mjs';
import {naturalConfig,naturalSelection,owned} from './helpers/native-natural-learning.mjs';
import {progressDefault,defaultTrainerRoute} from './helpers/native-default-trainer.mjs';
before(()=>buildCoopRuntime());

test('natural original experience and level calculation emit private exact display values',async()=>{
 const route=await defaultTrainerRoute();
 try{
  const events=route.trace.flatMap(step=>step.events),stats=events.filter(e=>e.kind==='level-stats');
  assert.ok(stats.length>=2);
  for(const e of stats){
   assert.ok([0,1].includes(e.scope));assert.equal(e.previous.length,6);assert.equal(e.stats.length,6);
   assert.ok(e.stats.every((value,index)=>value>=e.previous[index]));
   assert.ok(events.some(p=>p.kind==='pokemon-progress'&&p.pokemonId===e.pokemonId&&p.level===e.level
     &&JSON.stringify(p.stats)===JSON.stringify(e.stats)&&p.scope===e.scope));
  }
  assert.ok(events.some(e=>e.kind==='pokemon-progress'&&e.exp>0&&Number.isInteger(e.levelExp)));
 }finally{await route.h.close();}
});

test('level-five catalog starters reach original evolution naturally, restore the choice and apply/cancel once',async()=>{
 const h=await createOriginalRuleHost(naturalConfig);
 try{
  // Synthetic unlocked catalog descriptions; levels/EXP/HP/queued phases are
  // never forged, and no user collection or save is touched.
  const selection=structuredClone(naturalSelection);
  selection.starterSelections[0][0].speciesId=10;selection.starterSelections[0][0].moveset=null;
  let c=(await h.request('native-open-selected-to-input',selection)).checkpoint;
  for(let n=0;n<160&&c.decision.kind!=='evolution';n++)c=(await progressDefault(h,c)).checkpoint;
  assert.equal(c.decision.kind,'evolution');assert.equal(c.decision.pokemonId,owned(c,0)[0].pokemon.fields.id);
  const frozen=structuredClone(c),pokemonId=c.decision.pokemonId;
  const act=(checkpoint,choice)=>h.request('native-progression',{checkpoint,seat:0,action:{kind:'evolution',pokemonId,choice}});
  await assert.rejects(()=>h.request('native-validate-progression',{checkpoint:c,seat:1,action:{kind:'evolution',pokemonId,choice:'evolve'}}),/INVALID_PROGRESSION_PHASE/);
  const evolved=await act(structuredClone(c),'evolve');
  assert.equal(owned(evolved.checkpoint,0)[0].pokemon.fields.species,11);
  assert.deepEqual(owned(evolved.checkpoint,1),owned(c,1));
  const display=evolved.events.find(e=>e.kind==='evolution-display');
  assert.ok(display);assert.equal(display.scope,0);assert.equal(display.pokemonId,pokemonId);
  assert.ok(evolved.intents.some(i=>i.kind==='evolution-pending'));
  await assert.rejects(()=>act(evolved.checkpoint,'evolve'),/INVALID_PROGRESSION_PHASE/);
  c=(await act(frozen,'cancel')).checkpoint;assert.equal(c.decision.stage,'pause-confirm');
  c=(await act(structuredClone(c),'pause')).checkpoint;
  assert.equal(owned(c,0)[0].pokemon.fields.pauseEvolutions,true);
  assert.equal(owned(c,0)[0].pokemon.fields.species,10);
  assert.equal(c.decision.kind,'continuing');
 }finally{await h.close();}
});

test('naturally drawn shared Rare Candy runs original level/learning queue before automatic completion',async()=>{
 const h=await createOriginalRuleHost({...naturalConfig,seed:'growth-candy-6'});
 try {
  let c=(await h.request('native-open-selected-to-input',naturalSelection)).checkpoint;
  for(let step=0;step<60;step++){
   const front=(c.continuation.phaseQueuePrepend.at(-1)??c.continuation.phaseQueue[0])?.phase.type;
   if(c.decision.kind==='continuing'&&front==='SelectModifierPhase')break;
   c=(await progressDefault(h,c)).checkpoint;
  }
  c=(await h.request('native-preparation-shared',c)).checkpoint;
  const option=c.decision.players[0].rewards.find(o=>o.type.catalogId==='RARE_CANDY');assert.ok(option);
  const before=structuredClone(c),pokemon=owned(c,0)[0].pokemon.fields;
  const result=await h.request('native-prepare-action',{checkpoint:c,seat:0,action:{kind:'preparation',operation:'reward',
   optionId:option.id,pokemonId:pokemon.id,moveIndex:null,fusionId:null}});
  c=result.checkpoint;
  assert.equal(owned(c,0)[0].pokemon.fields.level,pokemon.level+1);
  assert.deepEqual(owned(c,1),owned(before,1));
  assert.ok(result.events.some(e=>e.kind==='level-stats'&&e.pokemonId===pokemon.id));
  assert.deepEqual(c.decision.shared.rewardClaims,[{optionId:option.id,seat:0}]);
  for(let step=0;step<8&&c.decision.players[0].subdecision;step++){
   assert.equal(c.decision.players[0].ready,false);
   const d=c.decision.players[0].subdecision;
   const action=d.kind==='learn-move'?d.options[0].find(o=>o.slot===null):{kind:'evolution',pokemonId:d.pokemonId,choice:'evolve'};
   await h.request('native-validate-preparation',{checkpoint:c,seat:0,action});
   c=(await h.request('native-prepare-action',{checkpoint:structuredClone(c),seat:0,action})).checkpoint;
  }
  assert.equal(c.decision.players[0].subdecision,null);assert.equal(c.decision.players[0].ready,true);
  assert.equal(c.decision.players[1].ready,false);
  c=(await h.request('native-prepare-action',{checkpoint:c,seat:1,action:{kind:'preparation',operation:'skip-reward'}})).checkpoint;
  assert.equal(c.decision.reason,'next-battle');assert.deepEqual(c.pendingEffects,[]);
 }finally{await h.close();}
});
