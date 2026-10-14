import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {cleanupContext,advanceCleanup,runCleanupReference} from './helpers/turn-end-model.mjs';
import {advanceQueuedRulePhase} from '../src/battle-core/rule-phase-runner.mjs';

for(const seat of [0,1])for(const disabledTurns of [1,2,3])test(`original MoveEnd/TurnEnd differential resumes owner=${seat}, disabled=${disabledTurns}`,async()=>{
  const initial=cleanupContext(seat,{disabledTurns,fieldEffects:true}),before=codec.capture(initial);
  let native=initial,ref=codec.restore(before);
  for(let step=0;step<2;step++){
    const expected=await runCleanupReference(ref);ref=expected.context;
    const actual=await advanceCleanup(codec.restore(codec.capture(native)));native=actual.context;
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(codec.capture(native),codec.capture(ref));
    assert.equal(native.roster.entries[seat].pokemon.summonData.tags.length,1-step);
  }
  assert.deepEqual(codec.capture(initial),before);
  assert.equal(native.arena.ignoreAbilities,false);assert.equal(native.battle.turn,2);
  assert.equal(native.battle.battleSeedState,null);assert.ok(Object.values(native.battle.turnCommands).every(v=>v===null));
  assert.equal(native.roster.entries[seat].pokemon.summonData.disabledTurns,disabledTurns-1);
  assert.equal(native.arena.weather.turnsLeft,1);
  for(let i=0;i<3;i++)assert.equal(native.roster.entries[i].pokemon.battleSummonData.turnCount,initial.roster.entries[i].pokemon.battleSummonData.turnCount+1);
  if(disabledTurns===1){assert.equal(native.roster.entries[seat].pokemon.summonData.disabledMove,0);
    assert.equal(native.continuation.phaseQueue[0].phase.constructor.name,'MessagePhase');
    await assert.rejects(advanceCleanup(native),{code:'UNSUPPORTED_RULE_PHASE'});}
});

test('incomplete or invalid original cleanup result cannot publish mutated candidate',async()=>{
  const c=cleanupContext(),before=codec.capture(c);
  for(const mode of ['pending','codec']){
    const driver={supports:()=>true,execute(candidate){candidate.battle.turn++;
      if(mode==='codec')candidate.roster.entries[0].pokemon.hp=-1;
      return {completed:true,pendingTasks:mode==='pending'?1:0,events:[],grants:[]};}};
    await assert.rejects(advanceQueuedRulePhase(c,codec,driver,{decisionId:'cleanup-1'}));
    assert.deepEqual(codec.capture(c),before);
  }
});

test('late cleanup failure after native TurnEnd and rejected tasks leaves original checkpoint intact',async()=>{
  const c=(await advanceCleanup(cleanupContext())).context,before=codec.capture(c);
  await assert.rejects(advanceCleanup(c,{onBind:(_c,_p,_b,tasks)=>tasks.add(Promise.reject(Error('post turn failed')))}),/post turn failed/);
  assert.deepEqual(codec.capture(c),before);
  await assert.rejects(advanceQueuedRulePhase(c,codec,{}, {decisionId:c.decision.id}),{code:'INVALID_RULE_DECISION_ID'});
  assert.deepEqual(codec.capture(c),before);
});
