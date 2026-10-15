import test from 'node:test';
import assert from 'node:assert/strict';
import {codec,initialDecision} from './helpers/decision-model.mjs';
import {eggs,eggCodec,eggData} from './helpers/egg-model.mjs';
import {eggLapseContext,advanceEggs,referenceEggs,queuedHatches,atEggStop,eggLapseDriver} from './helpers/egg-lapse-model.mjs';
import {eggHatchPhases,phaseCodec} from './helpers/phase-model.mjs';
import {advanceEggLapse} from '../src/battle-core/egg-lapse-runner.mjs';
import {projectEggSnapshot,restoreEggView} from './helpers/egg-lapse-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

for(const options of [{rows:[[],[]]},{rows:[[3,7],[8]]},{},{rows:[[1,1],[1,1]]},{emptySeat:0},{rows:[[0],[]]},{rows:[[-1],[]]}])
test(`original EggLapse advances both private inventories once ${JSON.stringify(options)}`,async()=>{
  const c=await eggLapseContext(options),before=codec.capture(c),expected=await referenceEggs(codec.restore(before)),actual=await advanceEggs(c),after=codec.capture(actual.context);
  assert.equal(before.version,7);assert.deepEqual(after,codec.capture(expected.context));assert.deepEqual(actual.events,expected.events);assert.deepEqual(actual.grants,[]);
  for(const seat of [0,1])assert.deepEqual(actual.context.eggState.players[seat].map(e=>e.hatchWaves),c.eggState.players[seat].map(e=>e.hatchWaves-1));
  const restored=codec.restore(copy(after));
  for(const hatch of queuedHatches(restored)){assert.equal(hatch.phase.constructor,eggHatchPhases.EggHatchPhase);
    assert.ok(restored.eggState.players[hatch.scope].includes(hatch.egg));assert.ok(hatch.egg.hatchWaves<=0);}
  assert.ok(atEggStop(restored));const saved=codec.capture(restored);await assert.rejects(advanceEggs(restored),/UNSUPPORTED_RULE_PHASE/);
  assert.deepEqual(codec.capture(restored),saved);assert.deepEqual(codec.capture(c),before);
  assert.deepEqual(after.players,before.players);assert.deepEqual(after.roster,before.roster);assert.deepEqual(after.scene,before.scene);
});

test('the original EggData roundtrip, tiers and equal cross-seat IDs retain distinct owned instances',async()=>{
  const c=await eggLapseContext({rows:[[1],[1]]});c.eggState.players[1][0].id=c.eggState.players[0][0].id;
  for(const row of c.eggState.players)for(const egg of row){const back=new eggData.default(egg).toEgg();assert.deepEqual(eggCodec.capture({players:[[back],[]]}).players[0][0],eggCodec.capture({players:[[egg],[]]}).players[0][0]);}
  const result=await advanceEggs(c),restored=codec.restore(copy(codec.capture(result.context))),hatches=queuedHatches(restored);
  assert.notEqual(hatches[0].egg,hatches[1].egg);assert.equal(hatches[0].egg.id,hatches[1].egg.id);
});

test('invalid egg fields, duplicate/shared instances, unknown phase references and ownership reject atomically',async()=>{
  const c=(await advanceEggs(await eggLapseContext())).context,before=codec.capture(c);
  const mutations=[s=>s.eggState.players[0][0].hatchWaves=1.5,s=>s.eggState.players[0][0].gachaType=99,
    s=>s.eggState.players[0][0].id=eggs.EGG_SEED*4,s=>s.eggState.players[0].push(copy(s.eggState.players[0][0])),
    s=>s.continuation.phaseQueuePrepend.find(d=>d.phase.type==='EggHatchPhase').phase.scope=1,
    s=>s.continuation.phaseQueuePrepend.find(d=>d.phase.type==='EggHatchPhase').phase.fields.egg.value.id=999999];
  for(const mutate of mutations){const bad=copy(before);mutate(bad);assert.throws(()=>codec.restore(bad));assert.deepEqual(codec.capture(c),before);}
  const shared={players:[[c.eggState.players[0][0]],[c.eggState.players[0][0]]]};assert.throws(()=>eggCodec.capture(shared));
  let getters=0;const fake=new eggs.Egg(1,0,1,0);Object.defineProperty(fake,'id',{get(){getters++;return 1;},enumerable:true});
  assert.throws(()=>eggCodec.capture({players:[[fake],[]]}));assert.equal(getters,0);
});

test('legacy v6 remains v6 and v7 cannot drop egg fields or recover with a missing codec',async()=>{
  const legacy=initialDecision(),old=codec.capture(legacy);assert.equal(old.version,6);assert.deepEqual(codec.capture(codec.restore(old)),old);
  const c=await eggLapseContext(),saved=codec.capture(c),missing=copy(saved);delete missing.eggState;assert.throws(()=>codec.restore(missing));
  const downgrade=copy(saved);downgrade.version=6;assert.throws(()=>codec.restore(downgrade));
  const {trainerDecisionCodec}=await import('./helpers/decision-model.mjs');assert.throws(()=>trainerDecisionCodec.restore(saved),/EGG_CODEC_UNAVAILABLE/);
});

test('second-seat failures and incomplete candidates retain both original rows and queued EggLapse',async()=>{
  const c=await eggLapseContext(),before=codec.capture(c);
  await assert.rejects(advanceEggs(c,{}, {onEggBind:(_c,_p,_b,tasks,{seat})=>{if(seat===1)tasks.add(Promise.reject(Error('egg task')));}}),/egg task/);
  assert.deepEqual(codec.capture(c),before);
  for(const mode of ['pending','incomplete','state','invalid']){
    const driver=eggLapseDriver(),run=driver.executeEggLapse;driver.executeEggLapse=async(candidate,p)=>{const result=await run(candidate,p);
      if(mode==='pending')result.pendingTasks=1;if(mode==='incomplete')result.completed=false;
      if(mode==='state')candidate.continuation={...candidate.continuation};if(mode==='invalid')candidate.eggState.players[0][0].tier=99;return result;};
    await assert.rejects(advanceEggLapse(c,codec,driver,{decisionId:'bad-eggs'}));assert.deepEqual(codec.capture(c),before);
  }
});

test('egg views restore only the recipient original Eggs and hatch phases and conceal peer seed data',async()=>{
  const c=(await advanceEggs(await eggLapseContext())).context;
  for(const seat of [0,1]){
    const view=projectEggSnapshot(c,seat),restored=restoreEggView({...copy(view),seat});
    assert.deepEqual(copy(projectEggSnapshot(restored,seat)),copy(view));
    assert.equal(restored.context.eggState.players[1-seat].length,0);
    for(const egg of restored.context.eggState.players[seat])assert.equal(Object.getPrototypeOf(egg),eggs.Egg.prototype);
    for(const phase of restored.eggView.owned.values())assert.equal(phase.constructor,eggHatchPhases.EggHatchPhase);
    for(const egg of c.eggState.players[1-seat])assert.ok(!JSON.stringify(view).includes(String(egg.id)));
  }
});

test('from Victory through BattleEnd to original personal EggLapse preserves both ownership rows',async()=>{
  let c=await eggLapseContext({fromVictory:true}),r=codec.restore(codec.capture(c)),steps=0;
  while(!atEggStop(c)){assert.ok(++steps<25);const expected=await referenceEggs(r);r=expected.context;const actual=await advanceEggs(c);c=actual.context;
    assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(actual.events,expected.events);}
  assert.deepEqual(c.eggState.players.map(row=>row.map(e=>e.hatchWaves)),[[2,0],[0,6]]);
});
