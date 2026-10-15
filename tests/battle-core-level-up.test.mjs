import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {levelUpContext,advanceLevelUp,referenceProgression,chooseProgression,atExperienceEnd,runProgression,Mode,progressionDriver} from './helpers/level-up-model.mjs';
import {phaseCodec,originalPhases} from './helpers/phase-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import {advanceProgressionChoice} from '../src/battle-core/progression-choice-runner.mjs';
import {safeCodec} from './helpers/decision-model.mjs';

const scenarios=[{seat:0},{seat:1,full:true},{known:true},{full:true,slot:null},
  {level:16,lastLevel:5},{level:16,lastLevel:15,evolve:'cancel',pauseChoice:'pause'},
  {level:16,lastLevel:15,evolve:'cancel',pauseChoice:'continue'},{level:16,lastLevel:15,pause:true},
  {seat:0,level:16,lastLevel:5,full:true,share:true}];
for(const options of scenarios)test(`original LevelUp/learning/evolution returns to pending Victory ${JSON.stringify(options)}`,async()=>{
  const initial=await levelUpContext(options),before=codec.capture(initial);let c=initial,r=codec.restore(before),steps=0;
  const trace=[],events=[];
  while(!atExperienceEnd(c)){
    assert.ok(++steps<60);const phase=c.continuation.currentPhase?.phase??nextPostPhase(c);
    trace.push(phase.constructor.name);const inputs=chooseProgression(c,{slot:options.slot,evolve:options.evolve,pause:options.pauseChoice});
    const expected=await referenceProgression(r,inputs);r=expected.context;
    const actual=await advanceLevelUp(codec.restore(copy(codec.capture(c))),inputs);c=actual.context;
    assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(actual.events,expected.events);assert.deepEqual(actual.grants,[]);
    events.push(...actual.events);
  }
  const seat=options.seat??1,p=c.roster.entries.find(e=>e.owner===seat&&e.index===0).pokemon;
  assert.equal(trace.filter(n=>n==='LevelUpPhase').length,1);
  assert.ok(events.some(e=>e.kind==='level-stats'&&e.seat===seat));
  assert.ok(events.some(e=>e.kind==='highest-level-hook'&&e.seat===seat&&e.level===(options.level??7)));
  assert.notDeepEqual(p.stats,initial.roster.entries.find(e=>e.pokemon.id===p.id).pokemon.stats);
  assert.equal(p.species.speciesId,(options.level??7)>=16&&!options.pause&&options.evolve!=='cancel'?2:1);
  if(options.evolve==='cancel')assert.equal(p.pauseEvolutions,options.pauseChoice==='pause');
  const other=1-seat;assert.deepEqual(c.roster.entries.find(e=>e.owner===other&&e.index===0).pokemon.stats,
    initial.roster.entries.find(e=>e.owner===other&&e.index===0).pokemon.stats);
  assert.deepEqual(codec.capture(c).players,before.players);assert.deepEqual(codec.capture(c).components,before.components);
  assert.deepEqual(codec.capture(initial),before);assert.equal(c.continuation.phaseQueue[0].remaining,'victory-aftermath');
  const saved=codec.capture(c);await assert.rejects(advanceLevelUp(c),/UNSUPPORTED_RULE_PHASE/);assert.deepEqual(codec.capture(c),saved);
});
async function choiceContext(kind){let c=await levelUpContext(kind==='learn-move'?{full:true}:{level:16,lastLevel:15});
  while(c.decision.kind!==kind)c=(await advanceLevelUp(c)).context;return c;}

test('owned learning decisions reject foreign/forged/stale intents and resume without start',async()=>{
  const c=await choiceContext('learn-move'),before=codec.capture(c),seat=c.decision.requiredSeats[0];
  for(const input of [{},chooseProgression(c,{slot:4}),{[1-seat]:{kind:'learn-move',pokemonId:c.decision.learn.pokemonId,slot:0}}]){
    await assert.rejects(advanceLevelUp(c,input));assert.deepEqual(codec.capture(c),before);
  }
  const d=c.continuation.currentPhase;assert.equal(d.remaining,'learn-apply');
  assert.equal(phaseCodec.capture(d.phase,c).scope,seat);
  const result=await advanceLevelUp(c,chooseProgression(c,{slot:2}));
  assert.equal(result.context.continuation.currentPhase,null);
  const pk=result.context.roster.entries.find(e=>e.pokemon.id===c.decision.learn.pokemonId).pokemon;
  assert.equal(pk.moveset[2],null);assert.equal(nextPostPhase(result.context).constructor,originalPhases.LearnMovePhase);
  const completed=await advanceLevelUp(result.context);assert.equal(completed.context.roster.entries.find(e=>e.pokemon.id===pk.id).pokemon.moveset[2].moveId,c.decision.learn.moveId);
  await assert.rejects(advanceLevelUp(result.context,{}, {onProgressionBind:(_c,_p,_b,tasks)=>tasks.add(Promise.reject(Error('learn task')))}),/learn task/);
});

test('phase task failures roll back stats, original move clearing, evolution and collection hooks',async()=>{
  for(const stage of ['level','learn','evolve','cancel']){
    const c=stage==='level'?await levelUpContext():await choiceContext(stage==='learn'?'learn-move':'evolution');
    const before=codec.capture(c);
    await assert.rejects(advanceLevelUp(c,chooseProgression(c,{evolve:stage==='cancel'?'cancel':'evolve'}),{onProgressionBind:(_c,_p,_b,tasks)=>{
      tasks.add(Promise.reject(Error(`failed-${stage}`)));
    }}),new RegExp(`failed-${stage}`));assert.deepEqual(codec.capture(c),before);
  }
});

test('progression rejects mismatched saved phase/catalog and preserves old decisions',async()=>{
  for(const kind of ['learn-move','evolution']){
    const c=await choiceContext(kind),before=codec.capture(c);
    for(const mutate of [s=>s.continuation.currentPhase.phase.scope=0,
      s=>s.continuation.currentPhase.remaining='start',
      s=>s.continuation.currentPhase.phase.fields[kind==='learn-move'?'moveId':'lastLevel'].value=kind==='learn-move'?57:1]){
      const bad=copy(before);mutate(bad);
      let restored;try{restored=codec.restore(bad);}catch{continue;}
      await assert.rejects(advanceLevelUp(restored,chooseProgression(restored)));
      assert.deepEqual(codec.capture(c),before);
    }
  }
});

test('actual EXP upgrade at level 6 executes original LevelUp and keeps pending Victory once',async()=>{
  const {experienceContext,advanceExperience}=await import('./helpers/experience-model.mjs');
  let c=await experienceContext({levelUp:true});
  while(nextPostPhase(c).constructor!==originalPhases.LevelUpPhase)c=(await advanceExperience(c)).context;
  const before=codec.capture(c),result=await advanceLevelUp(c);c=result.context;
  assert.equal(c.roster.entries[1].pokemon.level,6);assert.equal(c.roster.entries[1].pokemon.exp,242);
  assert.ok(result.events.some(e=>e.kind==='level-stats'));
  while(!atExperienceEnd(c))c=(await advanceLevelUp(c,chooseProgression(c))).context;
  assert.deepEqual(codec.capture(c).players,before.players);
});

test('full solo LearnMove start retains the frozen confirmed UI callback and queue',async()=>{
  for(const slot of [0,2,3]){
    const initial=await choiceContext('learn-move'),states=[codec.restore(codec.capture(initial)),codec.restore(codec.capture(initial))],results=[];
    for(const [index,c]of states.entries()){
      const result=await runProgression(c,c.continuation.currentPhase.phase,{reference:index===1,
        onProgressionBind:(_c,_p,b)=>{b.scene.ui.setModeWithoutClear=(mode,...args)=>{
          if(mode===Mode.CONFIRM)args[0]();else {assert.equal(mode,Mode.SUMMARY);args.at(-1)(slot);}
        };}});
      assert.equal(result.completed,true);c.continuation.currentPhase=null;
      c.decision={id:'solo-learned',kind:'continuing',requiredSeats:[],reason:'effects'};results.push(result.events);
    }
    assert.deepEqual(codec.capture(states[0]),codec.capture(states[1]));assert.deepEqual(results[0],results[1]);
  }
});

test('progression candidate callbacks cannot publish incomplete tasks or replace the continuation',async()=>{
  const c=await choiceContext('learn-move'),before=codec.capture(c);
  for(const mode of ['pending','unfinished','state','invalid-model']){
    const driver=progressionDriver(),resume=driver.resumeLearning;
    driver.resumeLearning=async(candidate,p,intent)=>{const result=await resume(candidate,p,intent);
      if(mode==='pending')result.pendingTasks=1;if(mode==='unfinished')result.completed=false;
      if(mode==='state')candidate.continuation={...candidate.continuation};
      if(mode==='invalid-model')candidate.roster.entries[1].pokemon.hp=-1;return result;};
    await assert.rejects(advanceProgressionChoice(c,chooseProgression(c),codec,safeCodec,driver,{decisionId:'rejected-progression'}));
    assert.deepEqual(codec.capture(c),before);
  }
});
