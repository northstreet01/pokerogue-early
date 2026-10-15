import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {arena} from './helpers/original-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {replacementContext,advanceReplacement,referenceReplacement,chooseReplacementInputs,replacementDriver,forcedSwitchDriver} from './helpers/replacement-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {advanceForcedSwitch} from '../src/battle-core/forced-switch-runner.mjs';
import {advanceQueuedRulePhase} from '../src/battle-core/rule-phase-runner.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

for(const seat of [0,1])for(const both of [false,true])test(`owned replacement ${seat}, both=${both} follows original stages through the next command`,async()=>{
  const initial=await replacementContext({seat,both}),saved=codec.capture(initial),expectedIncoming=chooseReplacementInputs(initial)[seat].pokemonId;
  let c=initial,r=codec.restore(saved),steps=0;const trace=[],switchSeats=[];
  while(c.decision.kind!=='wait-actions'){
    assert.ok(++steps<30);const stage=c.continuation.currentPhase?.remaining||nextPostPhase(c).constructor.name;
    trace.push(stage);if(c.decision.kind==='wait-switch')switchSeats.push(c.decision.requiredSeats[0]);
    const inputs=chooseReplacementInputs(c),e=await referenceReplacement(r,inputs);r=e.context;
    const a=await advanceReplacement(codec.restore(JSON.parse(JSON.stringify(codec.capture(c)))),inputs,
      {onSwitchBind:(_c,p,_b,_tasks,{stage:s})=>{
        if(s!=='post-summon')assert.notEqual(p.constructor,originalPhases.PostSummonPhase);
      }});c=a.context;
    assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(a.events,e.events);
    assert.equal(c.battle.turn,initial.battle.turn);
    if(stage==='summon-initialize'){
      const incoming=c.roster.entries.find(e=>e.pokemon.id===c.roster.field[switchSeats.at(-1)]).pokemon;
      assert.ok(incoming.summonData.battleStats.every(n=>n===0));assert.equal(c.continuation.currentPhase.remaining,'summon-finish');
    }
  }
  assert.deepEqual(switchSeats,both?[seat,1-seat]:[seat]);
  assert.equal(c.roster.field[seat],expectedIncoming);
  assert.equal(c.roster.entries.find(e=>e.pokemon.id===100+seat).index,2);
  assert.equal(c.roster.entries.find(e=>e.pokemon.id===expectedIncoming).index,0);
  assert.equal(c.roster.entries.find(e=>e.pokemon.id===expectedIncoming).pokemon.battleSummonData.turnCount,1);
  assert.ok(c.battle.playerParticipantIds.has(expectedIncoming));assert.equal(c.battle.playerParticipantIds.has(100+seat),false);
  assert.equal(c.continuation.currentPhase.phase.constructor,originalPhases.CommandPhase);
  assert.deepEqual(c.decision.requiredSeats,[0]);assert.ok(c.decision.options[0].every(a=>a.kind==='fight'));
  assert.equal(trace.filter(n=>n==='summon-initialize').length,both?2:1);
  assert.equal(trace.filter(n=>n==='summon-finish').length,both?2:1);
  assert.equal(trace.filter(n=>n==='PostSummonPhase').length,both?2:1);
  assert.deepEqual(c.players,initial.players);assert.deepEqual(codec.capture(initial),saved);
});

test('a new real FIGHT round executes after both replacements without test continuation actions',async()=>{
  const initial=await replacementContext({both:true});let c=initial,r=codec.restore(codec.capture(c)),steps=0;
  do{assert.ok(++steps<70);const inputs=chooseReplacementInputs(c),e=await referenceReplacement(r,inputs);r=e.context;
    const a=await advanceReplacement(c,inputs);c=a.context;assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(a.events,e.events);
  }while(!(c.battle.turn===initial.battle.turn+1&&c.decision.kind==='wait-actions'));
  for(const seat of [0,1]){const p=c.roster.entries.find(e=>e.pokemon.id===c.roster.field[seat]).pokemon;
    assert.ok(p.hp>0);assert.equal(p.moveset[0].ppUsed,1);}
  assert.deepEqual(c.decision.requiredSeats,[0]);
});

for(const lethal of [false,true])test(`original PostSummon spikes executes after swap, lethal=${lethal}`,async()=>{
  const initial=await replacementContext(),incoming=chooseReplacementInputs(initial)[0].pokemonId;
  initial.arena.tags=[arena.getArenaTag('SPIKES',0,191,102,undefined,1)];
  if(lethal)initial.roster.entries.find(e=>e.pokemon.id===incoming).pokemon.hp=1;
  let c=initial,r=codec.restore(codec.capture(c)),steps=0,switches=0;
  while(c.decision.kind!=='wait-actions'){
    assert.ok(++steps<40);if(c.decision.kind==='wait-switch')switches++;
    const inputs=chooseReplacementInputs(c),e=await referenceReplacement(r,inputs);r=e.context;
    const a=await advanceReplacement(c,inputs);c=a.context;assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(a.events,e.events);
  }
  assert.equal(switches,lethal?2:1);assert.equal(c.roster.entries.find(e=>e.pokemon.id===incoming).pokemon.hp,lethal?0:175);
  assert.equal(c.battle.turn,initial.battle.turn);assert.equal(c.roster.field[0],lethal?111:112);
});

test('forced-switch inputs reject wrong seat, stale or invalid instances and unsafe current phases',async()=>{
  const c=await replacementContext({seat:1}),saved=codec.capture(c),inputs=chooseReplacementInputs(c);
  for(const actions of [{}, {0:inputs[1]}, {0:inputs[1],1:inputs[1]}, {1:{kind:'forced-switch',pokemonId:100}},
    {1:{kind:'forced-switch',pokemonId:101}}, {1:{...inputs[1],partyIndex:1}}]){
    await assert.rejects(advanceReplacement(c,actions));assert.deepEqual(codec.capture(c),saved);
  }
  for(const mode of ['pending','incomplete','invalid-model','replaced-state']){
    const driver=forcedSwitchDriver(),resume=driver.resumeSwitch;
    driver.resumeSwitch=async(candidate,...args)=>{const result=await resume(candidate,...args);
      if(mode==='pending')result.pendingTasks=1;
      if(mode==='incomplete')result.completed=false;
      if(mode==='invalid-model')candidate.roster.entries[1].pokemon.hp=-1;
      if(mode==='replaced-state')candidate.continuation={...candidate.continuation};return result;};
    await assert.rejects(advanceForcedSwitch(c,inputs,codec,driver,{decisionId:'invalid-switch'}));assert.deepEqual(codec.capture(c),saved);
  }
  const bad=copy(saved);bad.continuation.currentPhase.phase.fields.isModal.value=false;
  const malformed=codec.restore(bad);await assert.rejects(advanceReplacement(malformed,inputs),/UNSAFE_SWITCH_BOUNDARY/);
});

test('resumed summon stages require explicit resume and never re-enter execute/start',async()=>{
  let c=await replacementContext({seat:1});c=(await advanceReplacement(c,chooseReplacementInputs(c))).context;
  c=(await advanceReplacement(c)).context;assert.equal(c.continuation.currentPhase.remaining,'summon-initialize');
  const before=codec.capture(c),missing=replacementDriver();delete missing.resume;
  await assert.rejects(advanceQueuedRulePhase(c,codec,missing,{decisionId:'no-resume'}),/UNSAFE_RULE_BOUNDARY/);assert.deepEqual(codec.capture(c),before);
  const driver=replacementDriver();driver.execute=()=>assert.fail('resuming Phase restarted');
  c=(await advanceQueuedRulePhase(c,codec,driver,{decisionId:'explicit-resume'})).context;
  assert.equal(c.continuation.currentPhase.remaining,'summon-finish');
  const bad=codec.capture(c);bad.continuation.currentPhase.phase.scope=0;
  const corrupted=codec.restore(bad),saved=codec.capture(corrupted);
  await assert.rejects(advanceReplacement(corrupted),/INVALID_SWITCH_PARTY/);assert.deepEqual(codec.capture(corrupted),saved);
});

test('callback, swap, initialization, finalization and entry-task failures preserve exact checkpoints',async()=>{
  let c=await replacementContext();
  for(const stage of ['wait-switch','start','summon-initialize','summon-finish','post-summon']){
    const before=codec.capture(c),inputs=chooseReplacementInputs(c);
    await assert.rejects(advanceReplacement(c,inputs,{onSwitchBind:(_c,_p,_b,tasks,info)=>{
      if(info.stage===stage)tasks.add(Promise.reject(Error('stage task failed')));
    }}),/stage task failed/);assert.deepEqual(codec.capture(c),before);
    c=(await advanceReplacement(c,inputs)).context;
  }
});
