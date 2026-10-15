import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {status,battler,moves} from './helpers/original-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {faintContext,faintDriver,advanceFaint,referenceFaint} from './helpers/faint-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {advanceQueuedRulePhase} from '../src/battle-core/rule-phase-runner.mjs';
import {resolveForcedSwitchIntent} from '../src/battle-core/switch-command.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

for(const seat of [0,1])test(`original player Faint ${seat} reaches only its own switch after TurnEnd`,async()=>{
  const initial=faintContext({seat,reserves:2}),saved=codec.capture(initial);let c=initial,r=codec.restore(saved),steps=0;
  const target=c.battle.turnCommands[2].move.targets,trace=[];
  while(c.decision.kind==='continuing'){
    assert.ok(++steps<25);trace.push(nextPostPhase(c).constructor.name);
    const expected=await referenceFaint(r);r=expected.context;
    const actual=await advanceFaint(codec.restore(JSON.parse(JSON.stringify(codec.capture(c)))));c=actual.context;
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(codec.capture(c),codec.capture(r));
    assert.deepEqual(c.battle.turnCommands[2]?.move.targets??[seat],target);
    if(steps===1){assert.equal(c.roster.entries[seat].pokemon.status.effect,status.StatusEffect.FAINT);
      assert.equal(c.roster.entries[seat].pokemon.friendship,initial.roster.entries[seat].pokemon.friendship-10);
      assert.equal(c.battle.playerParticipantIds.has(100+seat),false);assert.equal(c.battle.playerParticipantIds.has(101-seat),true);
      assert.equal(c.decision.kind,'continuing');}
  }
  assert.equal(c.decision.kind,'wait-switch');assert.deepEqual(c.decision.requiredSeats,[seat]);
  assert.equal(c.battle.turn,initial.battle.turn+1);assert.equal(c.continuation.currentPhase.remaining,'wait-switch');
  assert.ok(trace.indexOf('TurnEndPhase')<trace.indexOf('SwitchPhase'));
  assert.equal(c.roster.entries[2].pokemon.moveset[0].ppUsed,initial.roster.entries[2].pokemon.moveset[0].ppUsed);
  assert.equal(c.roster.entries[1-seat].pokemon.hp,200);assert.equal(c.roster.field[1-seat],101-seat);
  assert.equal(c.decision.options[seat].length,2);assert.deepEqual(codec.capture(initial),saved);
});

for(const seat of [0,1])test(`one wiped player ${seat} leaves the original next input to the surviving partner`,async()=>{
  let c=faintContext({seat,reserves:0}),r=codec.restore(codec.capture(c)),steps=0;
  while(c.decision.kind==='continuing'){assert.ok(++steps<25);const e=await referenceFaint(r);r=e.context;
    const a=await advanceFaint(c);c=a.context;assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(a.events,e.events);}
  assert.equal(c.decision.kind,'wait-actions');assert.deepEqual(c.decision.requiredSeats,[1-seat]);
  assert.equal(c.continuation.currentPhase.phase.constructor,originalPhases.CommandPhase);
  assert.equal(c.continuation.currentPhase.phase.fieldIndex,1-seat);assert.equal(c.roster.field[1-seat],101-seat);
  assert.equal(c.battle.turnCommands[seat],null);
});

test('actual TurnStart/move/apply/Damage/Faint/cleanup chain reaches the turn-end switch',async()=>{
  let c=faintContext({lethalRound:true}),r=codec.restore(codec.capture(c)),n=0;const names=[];
  while(c.decision.kind==='continuing'){assert.ok(++n<35);names.push(nextPostPhase(c).constructor.name);
    const e=await referenceFaint(r);r=e.context;const a=await advanceFaint(c);c=a.context;
    assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(a.events,e.events);}
  for(const name of ['TurnStartPhase','MoveEffectPhase','DamagePhase','FaintPhase','MoveEndPhase','TurnEndPhase','SwitchPhase'])assert.ok(names.includes(name),name);
  assert.equal(c.decision.kind,'wait-switch');assert.equal(c.roster.entries[0].pokemon.hp,0);
});

test('original Faint tag cleanup runs before the checkpoint and async failure retains the old state',async()=>{
  const c=faintContext(),tag=battler.getBattlerTag('TRAPPED',3,moves.Moves.MEAN_LOOK,100);
  c.roster.entries[1].pokemon.summonData.tags.push(tag);const before=codec.capture(c);
  await assert.rejects(advanceFaint(c,{}, {onFaintBind:(_c,_p,_b,tasks,callbacks)=>callbacks.push(()=>tasks.add(Promise.reject(Error('faint failed'))))}),/faint failed/);
  assert.deepEqual(codec.capture(c),before);
  const a=await advanceFaint(c);assert.equal(a.context.roster.entries[1].pokemon.summonData.tags.some(t=>t.sourceId===100),false);
  assert.equal(a.context.roster.entries[0].pokemon.friendship,c.roster.entries[0].pokemon.friendship-10);
});

test('both player parties wiped ends after TurnEnd while enemy faint and simultaneous wipe remain unsupported',async()=>{
  let c=faintContext({both:true,reserves:0}),r=codec.restore(codec.capture(c));
  while(c.decision.kind==='continuing'){const e=await referenceFaint(r);r=e.context;c=(await advanceFaint(c)).context;assert.deepEqual(codec.capture(c),codec.capture(r));}
  assert.deepEqual(c.decision,{id:c.decision.id,kind:'ended',requiredSeats:[],victory:false,reason:'defeat'});assert.equal(c.battle.turn,2);
  c=faintContext({both:true,reserves:0});c.roster.entries[2].pokemon.hp=0;
  while(nextPostPhase(c).constructor!==originalPhases.TurnEndPhase)c=(await advanceFaint(c)).context;
  const before=codec.capture(c);await assert.rejects(advanceFaint(c),/UNCONFIRMED_SIMULTANEOUS_WIPE/);assert.deepEqual(codec.capture(c),before);
  c=faintContext();c.continuation.phaseQueue[0].phase=new originalPhases.FaintPhase({},2,false);c.roster.entries[2].pokemon.hp=0;
  const enemy=codec.capture(c);await assert.rejects(advanceFaint(c),/UNSUPPORTED_RULE_PHASE/);assert.deepEqual(codec.capture(c),enemy);
});

test('switch suspension validates owner, remaining stage, legal reserves and settled tasks',async()=>{
  let c=faintContext({seat:1});while(nextPostPhase(c).constructor!==originalPhases.SwitchPhase)c=(await advanceFaint(c)).context;
  const before=codec.capture(c);
  for(const mode of ['pending','owner','stage','async']){
    const driver=faintDriver(),stop=driver.suspendBoundary,execute=driver.execute;
    if(mode==='pending')driver.execute=async(...args)=>({...await execute(...args),pendingTasks:1});
    if(mode==='owner')driver.suspendBoundary=(...args)=>{const s=stop(...args);s.decision.requiredSeats=[0];return s;};
    if(mode==='stage')driver.suspendBoundary=(...args)=>({...stop(...args),remaining:'start'});
    if(mode==='async')driver.suspendBoundary=async()=>{};
    await assert.rejects(advanceQueuedRulePhase(c,codec,driver,{decisionId:'bad-switch'}));assert.deepEqual(codec.capture(c),before);
  }
  c=(await advanceFaint(c)).context;const saved=codec.capture(c),action=c.decision.options[1][0];
  assert.equal(resolveForcedSwitchIntent(c,1,action).fieldIndex,1);assert.throws(()=>resolveForcedSwitchIntent(c,0,action));
  for(const mutate of [s=>s.continuation.currentPhase.phase.fields.fieldIndex.value=0,
    s=>s.decision.options[1][0].pokemonId=100,s=>s.continuation.currentPhase.remaining='start']){
    const bad=copy(saved);mutate(bad);assert.throws(()=>codec.restore(bad));}
});

test('unbound solo Faint scheduling stays equal to the frozen original, including compaction and retarget',async()=>{
  for(const reserves of [0,1,2]){
    const c=faintContext({reserves}),r=codec.restore(codec.capture(c));
    const a=await advanceQueuedRulePhase(c,codec,faintDriver({cooperative:false}),{decisionId:'solo-1'});
    const e=await advanceQueuedRulePhase(r,codec,faintDriver({reference:true,cooperative:false}),{decisionId:'solo-1'});
    assert.deepEqual(codec.capture(a.context),codec.capture(e.context));assert.deepEqual(a.events,e.events);
    assert.deepEqual(a.context.battle.turnCommands[2].move.targets,[1]);
    if(reserves<2)assert.equal(a.context.continuation.phaseQueuePrepend[0].phase.constructor,reserves?originalPhases.ToggleDoublePositionPhase:originalPhases.GameOverPhase);
  }
});
