import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {moves} from './helpers/original-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {roundContext,advanceRound,runRoundReference,roundFightOptions,resolveRoundFight,roundDriver} from './helpers/round-loop-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {advanceQueuedRulePhase} from '../src/battle-core/rule-phase-runner.mjs';

for(const seat of [0,1])for(const move of [moves.Moves.TACKLE,moves.Moves.GROWL,moves.Moves.DOUBLE_SLAP])
test(`original round queue reaches next player input, owner=${seat}, move=${move}`,async()=>{
  const initial=roundContext({seat,move,seed:`round-${seat}-${move}`}),before=codec.capture(initial);
  let actual=initial,reference=codec.restore(before),steps=0;const phases=[];
  while(actual.decision.kind==='continuing'){
    assert.ok(++steps<50);phases.push(nextPostPhase(actual).constructor.name);
    const expected=await runRoundReference(reference);reference=expected.context;
    const result=await advanceRound(codec.restore(JSON.parse(JSON.stringify(codec.capture(actual)))));actual=result.context;
    assert.deepEqual(result.events,expected.events);assert.deepEqual(codec.capture(actual),codec.capture(reference));
  }
  assert.deepEqual(codec.capture(initial),before);assert.equal(actual.decision.kind,'wait-actions');
  assert.equal(actual.battle.turn,2);assert.equal(actual.battle.battleSeedState,null);
  assert.ok(Object.values(actual.battle.turnCommands).every(v=>v===null));
  assert.deepEqual(actual.continuation.phaseQueue.map(d=>d.phase.constructor.name),['CommandPhase','CommandPhase','EnemyCommandPhase','TurnStartPhase']);
  assert.deepEqual(actual.continuation.phaseQueue.slice(0,2).map(d=>d.phase.fieldIndex),[0,1]);
  assert.equal(actual.continuation.currentPhase,null);
  for(const {pokemon:p}of actual.roster.entries){assert.ok(p.hp>0);assert.equal(p.moveset[0].ppUsed,1);
    assert.equal(p.turnData.hitsLeft,undefined);assert.equal(p.turnData.hitCount,undefined);
    assert.equal(p.battleSummonData.turnCount,initial.roster.entries.find(e=>e.pokemon.id===p.id).pokemon.battleSummonData.turnCount+1);}
  for(const name of ['TurnStartPhase','MovePhase','MoveEffectPhase','DamagePhase','MoveEndPhase','TurnEndPhase','TurnInitPhase']){
    // Growl still shares the round with two actual damaging attacks.
    assert.ok(phases.includes(name),name);
  }
  if(move===moves.Moves.GROWL)assert.ok(phases.includes('StatChangePhase'));
  const saved=codec.capture(actual);
  for(const owner of [0,1]){const options=roundFightOptions(actual,owner);assert.deepEqual(options,actual.decision.options[owner]);
    for(const action of options){codec.validateAction(actual,owner,action);resolveRoundFight(actual,owner,action);}
    assert.throws(()=>codec.validateAction(actual,1-owner,options[0]));}
  assert.deepEqual(codec.capture(actual),saved); // Menu/validation consume neither RNG nor PP.
  await assert.rejects(advanceRound(actual),{code:'UNSAFE_RULE_BOUNDARY'});
});

test('original disabled-end Message drains before TurnInit and next action stop',async()=>{
  let c=roundContext({disabledTurns:1}),reference=codec.restore(codec.capture(c));const phases=[];
  while(c.decision.kind==='continuing'){
    phases.push(nextPostPhase(c).constructor.name);
    const expected=await runRoundReference(reference),actual=await advanceRound(c);reference=expected.context;c=actual.context;
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(codec.capture(c),codec.capture(reference));
  }
  assert.deepEqual(phases.slice(-3),['TurnEndPhase','MessagePhase','TurnInitPhase']);
  assert.equal(c.roster.entries[0].pokemon.summonData.disabledMove,moves.Moves.NONE);
});

test('failed queue-boundary adaptation preserves whole round checkpoint',async()=>{
  let c=roundContext();while(nextPostPhase(c).constructor!==originalPhases.TurnInitPhase)c=(await advanceRound(c)).context;
  const saved=codec.capture(c);
  for(const failure of ['throw','decision','model']){
    await assert.rejects(advanceRound(c,{onFinish:(candidate,_phase,decision)=>{
      if(failure==='throw')throw Error('stop adapter failed');
      if(failure==='decision')decision.requiredSeats=[0];
      if(failure==='model')candidate.roster.entries[0].pokemon.hp=-1;
    }}));assert.deepEqual(codec.capture(c),saved);
  }
  const good=await advanceRound(c);assert.equal(good.context.decision.kind,'wait-actions');
});

test('faint and unsupported original phases cannot silently advance a round',async()=>{
  const c=roundContext();c.roster.entries[2].pokemon.hp=0;
  c.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase:new originalPhases.FaintPhase({},2,false),remaining:'start'}];
  const saved=codec.capture(c);await assert.rejects(advanceRound(c),{code:'UNSUPPORTED_RULE_PHASE'});
  assert.deepEqual(codec.capture(c),saved);
});

test('boundary adapter rejects asynchronous hooks, wrong IDs and replaced queues atomically',async()=>{
  const c=roundContext(),before=codec.capture(c);let called=false;
  const asyncDriver={...roundDriver(),async finishBoundary(){called=true;}};
  await assert.rejects(advanceQueuedRulePhase(c,codec,asyncDriver,{decisionId:'round-1'}),{code:'RULE_BOUNDARY_DRIVER_UNAVAILABLE'});
  assert.equal(called,false);
  for(const finishBoundary of [()=>Promise.resolve({id:'round-1'}),()=>({id:'wrong'}),(candidate,_p,id)=>{
    candidate.continuation={...candidate.continuation};return {...candidate.decision,id};}]){
    await assert.rejects(advanceQueuedRulePhase(c,codec,{...roundDriver(),finishBoundary},{decisionId:'round-1'}));
    assert.deepEqual(codec.capture(c),before);
  }
});
