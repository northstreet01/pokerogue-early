import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {moves} from './helpers/original-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {mixedContext,advanceMixed,referenceMixed,chooseMixedInputs} from './helpers/mixed-command-model.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import {advanceQueuedRulePhase} from '../src/battle-core/rule-phase-runner.mjs';
import {cycleDriver} from './helpers/command-cycle-model.mjs';

for(const mode of ['queued','encore'])for(const move of [moves.Moves.GROWL,moves.Moves.TACKLE])
test(`original manual-first/forced-second pauses and resumes without reordering, ${mode}, move=${move}`,async()=>{
  const initial=await mixedContext({mode,move,invalidHead:mode==='queued'}),before=codec.capture(initial),trace=[];
  let c=initial,ref=codec.restore(before),steps=0,targetStops=0;
  do{
    assert.ok(++steps<50);const inputs=chooseMixedInputs(c),expected=await referenceMixed(ref,inputs);ref=expected.context;
    const actual=await advanceMixed(codec.restore(JSON.parse(JSON.stringify(codec.capture(c)))),inputs,
      {onBind:(_c,p,_b,_t,{resume}={})=>{if(p.constructor===originalPhases.CommandPhase)trace.push([p.fieldIndex,!!resume]);}});
    c=actual.context;assert.deepEqual(actual.events,expected.events);assert.deepEqual(codec.capture(c),codec.capture(ref));
    if(steps===1){assert.equal(c.decision.kind,'wait-actions');assert.deepEqual(c.decision.requiredSeats,[0]);
      assert.equal(c.continuation.currentPhase.remaining,'wait-actions');assert.equal(c.battle.turnCommands[1],null);
      assert.deepEqual(c.roster.entries[1].pokemon.summonData.moveQueue,initial.roster.entries[1].pokemon.summonData.moveQueue);}
    if(c.decision.kind==='wait-target'){targetStops++;assert.deepEqual(c.decision.requiredSeats,[1]);
      assert.equal(c.continuation.currentPhase.phase.constructor,originalPhases.SelectTargetPhase);
      assert.equal(c.battle.turnCommands[1].move.targets.length,0);}
  }while(!(c.battle.turn===initial.battle.turn+1&&c.decision.kind==='wait-actions'));
  assert.equal(targetStops,move===moves.Moves.TACKLE?1:0);
  assert.deepEqual(trace.slice(0,3),[[0,false],[0,true],[1,false]]);
  assert.equal(trace.filter(([seat,resume])=>seat===1&&resume).length,0);
  assert.ok(c.roster.entries.every(e=>e.pokemon.hp>0));assert.equal(c.roster.entries[1].pokemon.moveset[0].ppUsed,1);
  assert.deepEqual(codec.capture(initial),before);
});

test('both manual seats and both forced seats keep original queue order',async()=>{
  for(const forcedSeats of [[],[0,1]]){
    const initial=await mixedContext({forcedSeats,move:moves.Moves.GROWL});let c=initial,ref=codec.restore(codec.capture(c)),steps=0;
    const manual=[];
    do{assert.ok(++steps<50);if(c.decision.kind==='wait-actions')manual.push(c.decision.requiredSeats[0]);
      const inputs=chooseMixedInputs(c),expected=await referenceMixed(ref,inputs);ref=expected.context;
      const actual=await advanceMixed(c,inputs);c=actual.context;assert.deepEqual(codec.capture(c),codec.capture(ref));
    }while(!(c.battle.turn===initial.battle.turn+1&&c.decision.kind==='wait-actions'));
    assert.deepEqual(manual,forcedSeats.length?[]:[0,1]);
  }
});

test('forced target cancel returns to original Command and reopens only its target',async()=>{
  let c=await mixedContext();
  while(c.decision.kind!=='wait-target')c=(await advanceMixed(c,chooseMixedInputs(c))).context;
  const before=codec.capture(c),ref=codec.restore(before),cancel={1:c.decision.options[1].find(a=>a.target===-1)};
  const expected=await referenceMixed(ref,cancel),actual=await advanceMixed(c,cancel);
  c=actual.context;assert.deepEqual(codec.capture(c),codec.capture(expected.context));assert.deepEqual(actual.events,expected.events);
  assert.equal(c.decision.kind,'wait-target');assert.deepEqual(c.decision.requiredSeats,[1]);
  assert.equal(c.roster.entries[1].pokemon.moveset[0].ppUsed,0);assert.equal(c.battle.turn,2);
  assert.deepEqual(codec.capture(codec.restore(before)),before);
});

test('serial command and target decisions reject wrong owners and corrupted remaining stages',async()=>{
  let c=(await advanceMixed(await mixedContext())).context;
  const saved=codec.capture(c),action=chooseMixedInputs(c)[0];
  await assert.rejects(advanceMixed(c,{1:action}));assert.deepEqual(codec.capture(c),saved);
  for(const mutate of [s=>{s.decision.requiredSeats=[1];s.decision.options={1:[{...action,pokemonId:101}]};},
    s=>{s.continuation.currentPhase.remaining='start';},s=>{s.continuation.currentPhase.phase.fields.fieldIndex.value=1;}]){
    const bad=copy(saved);mutate(bad);assert.throws(()=>codec.restore(bad));
  }
  while(c.decision.kind!=='wait-target')c=(await advanceMixed(c,chooseMixedInputs(c))).context;
  const target=codec.capture(c);
  const bad=copy(target);bad.decision.target.fieldIndex=0;assert.throws(()=>codec.restore(bad));
  await assert.rejects(advanceMixed(c,{1:{...chooseMixedInputs(c)[1],target:3}}));assert.deepEqual(codec.capture(c),target);
});

test('suspension adapters cannot publish malformed decisions or unfinished work',async()=>{
  const c=await mixedContext(),saved=codec.capture(c);
  for(const mode of ['missing','async','bad-stage','bad-owner','pending']){
    const driver=cycleDriver({allowSuspend:true}),stop=driver.suspendBoundary;
    if(mode==='missing')delete driver.suspendBoundary;
    if(mode==='async')driver.suspendBoundary=async()=>{throw Error('must not run');};
    if(mode==='bad-stage')driver.suspendBoundary=(...args)=>({...stop(...args),remaining:'start'});
    if(mode==='bad-owner')driver.suspendBoundary=(...args)=>{const result=stop(...args);result.decision.requiredSeats=[1];return result;};
    if(mode==='pending'){const execute=driver.execute;driver.execute=async(...args)=>({...await execute(...args),pendingTasks:1});}
    await assert.rejects(advanceQueuedRulePhase(c,codec,driver,{decisionId:'mixed-stop'}));assert.deepEqual(codec.capture(c),saved);
  }
});

test('failed command and target resumes retain their exact original remaining stage',async()=>{
  let c=(await advanceMixed(await mixedContext())).context;
  for(const kind of ['wait-actions','wait-target']){
    while(c.decision.kind!==kind)c=(await advanceMixed(c,chooseMixedInputs(c))).context;
    const before=codec.capture(c);
    await assert.rejects(advanceMixed(c,chooseMixedInputs(c),{onBind:(_c,_p,_b,tasks,{resume}={})=>{
      if(resume)tasks.add(Promise.reject(Error('resume rule failed')));
    }}),/resume rule failed/);
    assert.deepEqual(codec.capture(c),before);
    const next=await advanceMixed(c,chooseMixedInputs(c));c=next.context;
  }
});
