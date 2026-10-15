import test from 'node:test';
import assert from 'node:assert/strict';
import {hatchContext,advanceHatch,referenceHatch,hatchDriver} from './helpers/egg-hatch-model.mjs';
import {advanceEggHatch} from '../src/battle-core/egg-hatch-runner.mjs';
import {codec} from './helpers/decision-model.mjs';
import {pokemon} from './helpers/original-model.mjs';
import {eggHatchPhases} from './helpers/phase-model.mjs';
import {projectEggSnapshot,restoreEggView} from './helpers/egg-lapse-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c));
for(const options of [{},{seat:1,gacha:2},{id:255,gacha:0},{id:1073741824+33,gacha:0},
  {id:2147483648+33,gacha:2},{id:3221225472+3,gacha:0},{id:3221225472+7,gacha:1},
  {id:3221225472+17,gacha:1,timestamp:86400000*100}])
test(`original hatch generation equals frozen original and JSON result never regenerates ${JSON.stringify(options)}`,async()=>{
  const c=await hatchContext(options),before=saved(c),reference=await referenceHatch(codec.restore(before));let calls=0;
  const result=await advanceHatch(codec.restore(before),{onCreate:()=>calls++}),d=result.context.continuation.currentPhase;
  assert.deepEqual(saved(result.context),saved(reference.context));assert.deepEqual(result.events,reference.events);assert.equal(calls,1);
  assert.deepEqual(saved(c),before);assert.deepEqual(result.context.eggState.players.map(row=>row.length),before.eggState.players.map(row=>row.length));
  assert.equal(d.remaining,'hatch-commit');assert.equal(d.phase.constructor,eggHatchPhases.EggHatchPhase);
  assert.equal(d.phase.pokemon.constructor,pokemon.PlayerPokemon);assert.ok(!result.context.roster.entries.some(e=>e.pokemon===d.phase.pokemon));
  assert.equal(d.phase.egg,result.context.eggState.players[options.seat??0][0]);
  assert.equal(saved(result.context).sceneRandom,before.sceneRandom);assert.deepEqual(saved(result.context).battle.random,before.battle.random);
  const restored=codec.restore(saved(result.context));assert.deepEqual(saved(restored),saved(result.context));
  await assert.rejects(advanceHatch(restored,{onCreate:()=>calls++}),/HATCH_COMMIT_UNAVAILABLE/);assert.equal(calls,1);
  assert.equal(result.grants.length,0);
});
test('original featured legendary nested seed restores the enclosing room stream',async()=>{
  let nested=0;
  for(let n=1;n<=8;n++){
    const c=await hatchContext({id:3221225472+n,gacha:1});const before=saved(c);
    const result=await advanceHatch(c,{onSeed:offset=>{if(offset!==3221225472+n)nested++;}});
    assert.equal(saved(result.context).sceneRandom,before.sceneRandom);
  }
  assert.ok(nested>0);
});
test('generated original Pokemon and egg move stay personal while both clients reproduce their applied view',async()=>{
  const {context:c}=await advanceHatch(await hatchContext({seat:1}));
  for(const seat of [0,1]){
    const view=projectEggSnapshot(c,seat),client=restoreEggView({...copy(view),seat});
    assert.deepEqual(copy(projectEggSnapshot(client,seat)),copy(view));
    if(seat===0){assert.equal(view.personal.hatches.length,0);assert.ok(!JSON.stringify(view).includes('10001'));assert.equal(client.eggView.owned.size,0);}
    else{const [phase]=client.eggView.owned.values();assert.equal(phase.pokemon.constructor,pokemon.PlayerPokemon);
      assert.equal(phase.egg,client.context.eggState.players[1][0]);assert.equal(phase.eggMoveIndex,c.continuation.currentPhase.phase.eggMoveIndex);}
  }
});
test('generation faults, inventory mutation and invalid results leave the input intact',async()=>{
  const c=await hatchContext(),before=saved(c);
  for(const options of [{onCreate:()=>{throw Error('factory');}},
    {afterGenerate:c=>{c.eggState.players[0].splice(0,1);}},
    {afterGenerate:c=>{c.players[0].money++;}},
    {afterGenerate:(_c,p)=>{p.eggMoveIndex=4;}},
    {afterGenerate:(c,p)=>{p.pokemon.ivs=c.roster.entries[0].pokemon.ivs;}}]){
    await assert.rejects(advanceHatch(c,options));assert.deepEqual(saved(c),before);
  }
});
test('unfinished generation and premature permanent grants cannot publish a hatch result',async()=>{
  const c=await hatchContext(),before=saved(c);
  for(const invalid of [{completed:false},{pendingTasks:1},{grants:[{id:'not-committed',seat:0,payload:{}}]}]){
    const base=hatchDriver(),driver={...base,async generateEggHatch(...args){return {...await base.generateEggHatch(...args),...invalid};}};
    await assert.rejects(advanceEggHatch(c,codec,driver,{decisionId:'fault-hatch'}),/INCOMPLETE_HATCH_GENERATION/);
    assert.deepEqual(saved(c),before);
  }
});
test('hatch checkpoints reject missing result, wrong stage, wrong owner and invalid result without consuming a draw',async()=>{
  const {context:c}=await advanceHatch(await hatchContext()),before=saved(c);
  for(const mutate of [s=>{delete s.continuation.currentPhase.phase.fields.pokemon;},
    s=>{s.continuation.currentPhase.remaining='start';},
    s=>{s.continuation.currentPhase.phase.scope=1;},
    s=>{s.continuation.currentPhase.phase.fields.eggMoveIndex.value=4;},
    s=>{s.eggState.players[0][0].hatchWaves=5;}]){
    const bad=copy(before);mutate(bad);assert.throws(()=>codec.restore(bad));assert.deepEqual(saved(c),before);
  }
});
