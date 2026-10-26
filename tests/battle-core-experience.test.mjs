import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {originalPhases,phaseCodec} from './helpers/phase-model.mjs';
import {experienceContext,advanceExperience,referenceExperience,atExperienceEnd,experienceDriver,bindExperience,referenceSoloVictory} from './helpers/experience-model.mjs';
import {modifiers,types} from './helpers/modifier-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {advanceVictoryExperience} from "./helpers/reference-rules/victory-experience-runner.mjs";
import {copy} from '../src/battle-core/coop-contract.mjs';

for(const opts of [{},{share:true},{bonuses:true},{emptySeat:true}])test(`cooperative original experience schedules/applies once with personal effects ${JSON.stringify(opts)}`,async()=>{
  const initial=await experienceContext(opts),before=codec.capture(initial);let c=initial,r=codec.restore(before),steps=0;
  const trace=[];
  while(!atExperienceEnd(c)){
    assert.ok(++steps<15);trace.push(nextPostPhase(c).constructor.name);
    const expected=await referenceExperience(r);r=expected.context;
    const actual=await advanceExperience(codec.restore(JSON.parse(JSON.stringify(codec.capture(c)))));c=actual.context;
    assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(actual.events,expected.events);assert.equal(actual.grants.length,0);
  }
  const gains=Object.fromEntries(c.roster.entries.filter(e=>e.owner!==null).map(e=>[e.pokemon.id,e.pokemon.exp-initial.roster.entries.find(i=>i.pokemon.id===e.pokemon.id).pokemon.exp]));
  assert.deepEqual(gains,opts.emptySeat?{100:0,101:65,110:0,111:0}:opts.bonuses?{100:40,101:68,110:0,111:0}
    :opts.share?{100:32,101:32,110:13,111:0}:{100:32,101:32,110:0,111:0});
  assert.equal(c.continuation.phaseQueue[0].remaining,'victory-aftermath');assert.equal(c.continuation.phaseQueue[0].phase.constructor,originalPhases.VictoryPhase);
  assert.equal(trace.filter(n=>n==='VictoryPhase').length,1);assert.equal(c.battle.turn,initial.battle.turn);
  assert.deepEqual(codec.capture(c).players,before.players);assert.deepEqual(codec.capture(c).components,before.components);
  if(opts.share){assert.ok(trace.includes('ShowPartyExpBarPhase'));assert.ok(trace.includes('HidePartyExpBarPhase'));}
  if(opts.bonuses)assert.equal(c.roster.entries[1].pokemon.friendship,73);
  const saved=codec.capture(c);await assert.rejects(advanceExperience(c),/UNSUPPORTED_RULE_PHASE/);assert.deepEqual(codec.capture(c),saved);
  assert.deepEqual(codec.capture(initial),before);
});

test('original personal Exp Balance, multi-participant bonus and Pokerus retain independent seat effects',async()=>{
  const initial=await experienceContext({share:true,balance:true,bonuses:true});
  // The actual original multi-participant EXP bonus catalogue entry.
  const entry=Object.entries(types.modifierTypes).find(([key])=>key==='OVAL_CHARM');
  assert.ok(entry);const bonusType=entry[1]();bonusType.id=entry[0];
  initial.players[1].modifiers.push(new modifiers.MultipleParticipantExpBonusModifier(bonusType,1));
  initial.roster.entries[1].pokemon.level=6;initial.roster.entries[1].pokemon.exp=216;initial.roster.entries[1].pokemon.levelExp=0;
  let c=initial,r=codec.restore(codec.capture(c)),steps=0;
  while(!atExperienceEnd(c)){assert.ok(++steps<15);const e=await referenceExperience(r);r=e.context;const a=await advanceExperience(c);c=a.context;
    assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(a.events,e.events);}
  assert.ok(c.roster.entries.find(e=>e.pokemon.id===110).pokemon.exp>27);
  assert.equal(c.roster.entries.find(e=>e.pokemon.id===111).pokemon.exp,135);
  assert.equal(c.roster.entries[1].pokemon.exp,311);
});

test('original cap/dead-party eligibility and an empty participant set do not invent experience',async()=>{
  for(const mode of ['cap','no-participants']){
    const c=await experienceContext({share:true});if(mode==='cap')for(const e of c.roster.entries.filter(e=>e.owner!==null))e.pokemon.level=10;
    else c.battle.playerParticipantIds.clear();
    const before=codec.capture(c),expected=await referenceExperience(codec.restore(before)),a=await advanceExperience(c);
    assert.deepEqual(codec.capture(a.context),codec.capture(expected.context));assert.ok(atExperienceEnd(a.context));
    assert.deepEqual(a.context.roster.entries.map(e=>e.pokemon.exp),c.roster.entries.map(e=>e.pokemon.exp));
  }
});

test('friendship caps use the original personal Soothe Bell and achievement hook',async()=>{
  const c=await experienceContext({bonuses:true});c.roster.entries[1].pokemon.friendship=254;
  const e=await referenceExperience(codec.restore(codec.capture(c))),a=await advanceExperience(c);
  assert.deepEqual(codec.capture(a.context),codec.capture(e.context));assert.deepEqual(a.events,e.events);
  assert.equal(a.context.roster.entries[1].pokemon.friendship,255);
  assert.deepEqual(a.events.filter(e=>e.kind==='achievement-hook'),[{kind:'achievement-hook',seat:1,id:'MAX_FRIENDSHIP'}]);
});

test('actual addExp level increase preserves the original owned LevelUp boundary for later execution',async()=>{
  const initial=await experienceContext({levelUp:true});let c=initial,r=codec.restore(codec.capture(c));
  while(nextPostPhase(c).constructor!==originalPhases.LevelUpPhase){const e=await referenceExperience(r);r=e.context;c=(await advanceExperience(c)).context;
    assert.deepEqual(codec.capture(c),codec.capture(r));}
  assert.equal(c.roster.entries[1].pokemon.level,6);assert.equal(c.roster.entries[1].pokemon.exp,242);
  assert.equal(phaseCodec.capture(nextPostPhase(c),c).scope,1);const before=codec.capture(c);
  await assert.rejects(advanceExperience(c),/UNSUPPORTED_RULE_PHASE/);assert.deepEqual(codec.capture(c),before);
});

test('queue/apply failures keep prior friendship, XP, modifiers, queues and RNG',async()=>{
  let c=await experienceContext({share:true,bonuses:true});
  for(const stage of ['queue','apply']){
    const before=codec.capture(c);
    await assert.rejects(advanceExperience(c,{onExperienceBind:(_c,_p,_b,tasks,info)=>{
      if(info.stage===stage&&(stage!=='queue'||info.seat===1))tasks.add(Promise.reject(Error('experience task failed')));
    }}),/experience task failed/);assert.deepEqual(codec.capture(c),before);
    c=(await advanceExperience(c)).context;
  }
});

test('experience candidates reject unsettled tasks, wrong phase, missing driver and simultaneous wipe',async()=>{
  const c=await experienceContext(),before=codec.capture(c);
  for(const mode of ['pending','invalid-model','state','incomplete']){
    const driver=experienceDriver(),run=driver.queueExperience;
    driver.queueExperience=async(candidate,p)=>{const result=await run(candidate,p);
      if(mode==='pending')result.pendingTasks=1;if(mode==='incomplete')result.completed=false;
      if(mode==='invalid-model')candidate.roster.entries[0].pokemon.exp=-1;
      if(mode==='state')candidate.continuation={...candidate.continuation};return result;};
    await assert.rejects(advanceVictoryExperience(c,codec,driver,{decisionId:'invalid-exp'}));assert.deepEqual(codec.capture(c),before);
  }
  const wiped=codec.restore(before);for(const e of wiped.roster.entries.filter(e=>e.owner!==null))e.pokemon.hp=0;
  const saved=codec.capture(wiped);await assert.rejects(advanceExperience(wiped),/UNCONFIRMED_SIMULTANEOUS_WIPE/);assert.deepEqual(codec.capture(wiped),saved);
  const a=(await advanceExperience(c)).context,good=codec.capture(a),bad=copy(good);
  bad.continuation.phaseQueue[0].remaining='victory-unknown';assert.throws(()=>codec.restore(bad));
  bad.continuation.phaseQueue[0].remaining='summon-finish';assert.throws(()=>codec.restore(bad));
});

test('solo original Victory start keeps stats, experience and full aftermath queues equal to the frozen implementation',async()=>{
  const initial=await experienceContext({share:true}),states=[codec.restore(codec.capture(initial)),codec.restore(codec.capture(initial))],stats=[];
  for(const [index,c]of states.entries()){
    const p=c.continuation.phaseQueuePrepend[0].phase,b=bindExperience(c,p,0,index===1);
    try{b.scene.gameData={gameStats:{pokemonDefeated:0}};b.scene.gameMode.isWaveFinal=()=>false;
      if(index===1)referenceSoloVictory.call(p);else p.start();stats.push(b.scene.gameData.gameStats.pokemonDefeated);
    }finally{b.dispose();}
  }
  assert.deepEqual(stats,[1,1]);assert.deepEqual(codec.capture(states[0]),codec.capture(states[1]));
});
