import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {pokemon,status} from './helpers/original-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {aftermathContext,advanceAftermath,referenceAfterBattle,atEggBoundary,atBattleEnd,aftermathDriver} from './helpers/victory-aftermath-model.mjs';
import {enemyFaintContext} from './helpers/enemy-faint-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {chooseProgression} from './helpers/level-up-model.mjs';
import {bindExperience,referenceSoloVictory} from './helpers/experience-model.mjs';
import {types} from './helpers/modifier-model.mjs';
import {advanceVictoryAftermath,recoverVictoryParties} from '../src/battle-core/victory-aftermath-runner.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

for(const options of [{},{emptySeat:0},{emptySeat:1},{held:true,temporary:true},{levelUp:true}])
test(`original Victory remainder and BattleEnd recover exactly through JSON ${JSON.stringify(options)}`,async()=>{
  const initial=await aftermathContext(options),before=codec.capture(initial);let c=initial,r=codec.restore(before),steps=0;
  const events=[],trace=[];
  while(!atEggBoundary(c)){
    assert.ok(++steps<70);trace.push(nextPostPhase(c).constructor.name);const inputs=chooseProgression(c),expected=await referenceAfterBattle(r,inputs);r=expected.context;
    const actual=await advanceAftermath(codec.restore(copy(codec.capture(c))),inputs);c=actual.context;
    assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(actual.events,expected.events);assert.deepEqual(actual.grants,[]);events.push(...actual.events);
  }
  assert.equal(trace.filter(n=>n==='VictoryPhase').length,1);assert.equal(trace.filter(n=>n==='BattleEndPhase').length,1);
  assert.ok(trace.indexOf('BattleEndPhase')>trace.lastIndexOf('TurnEndPhase'));assert.ok(c.scene.score>initial.scene.score);
  assert.equal(events.filter(e=>e.kind==='defeated-stat-hook').length,1);assert.equal(events.find(e=>e.kind==='battle-stat-hook').battles,1);
  assert.equal(events.filter(e=>e.kind==='victory-recovery').length,options.emptySeat===undefined?0:1);
  if(options.emptySeat!==undefined){const members=c.roster.entries.filter(e=>e.owner===options.emptySeat).sort((a,b)=>a.index-b.index);
    assert.equal(members[0].pokemon.hp,Math.max(Math.floor(members[0].pokemon.getMaxHp()/2),1));
    assert.equal(members[0].pokemon.status,undefined);assert.equal(members[1].pokemon.hp,0);
    assert.equal(c.roster.field[options.emptySeat],initial.roster.field[options.emptySeat]);}
  if(options.temporary){assert.equal(c.players[0].modifiers.length,0);assert.equal(c.players[1].modifiers[0].battlesLeft,1);}
  if(options.held){assert.equal(c.enemyModifiers.length,0);assert.equal(c.battle.postBattleLoot.length,1);assert.equal(c.battle.postBattleLoot[0].pokemonId,null);}
  assert.deepEqual(c.players.map(p=>({money:p.money,balls:p.pokeballCounts})),initial.players.map(p=>({money:p.money,balls:p.pokeballCounts})));
  for(const e of c.roster.entries.filter(e=>c.roster.field.includes(e.pokemon.id))){assert.deepEqual({...e.pokemon.battleSummonData},{...new pokemon.PokemonBattleSummonData()});}
  assert.deepEqual(codec.capture(initial),before);const saved=codec.capture(c);
  await assert.rejects(advanceAftermath(c),/UNSUPPORTED_RULE_PHASE/);assert.deepEqual(codec.capture(c),saved);
});

test('actual lethal FIGHT completes original Faint, XP, Victory remainder, turn tail and BattleEnd',async()=>{
  const initial=enemyFaintContext({lethalRound:true}),before=codec.capture(initial);let c=initial,r=codec.restore(before),steps=0;const phases=[];
  while(!atEggBoundary(c)){
    assert.ok(++steps<85);phases.push(nextPostPhase(c).constructor.name);const inputs=chooseProgression(c);
    const expected=await referenceAfterBattle(r,inputs);r=expected.context;const actual=await advanceAftermath(c,inputs);c=actual.context;
    assert.deepEqual(codec.capture(c),codec.capture(r));assert.deepEqual(actual.events,expected.events);
  }
  for(const name of ['TurnStartPhase','MovePhase','MoveEffectPhase','FaintPhase','VictoryPhase','ExpPhase','TurnEndPhase','BattleEndPhase'])assert.ok(phases.includes(name),name);
  assert.equal(c.battle.enemyParty[0].hp,0);assert.deepEqual(codec.capture(initial),before);
});

test('Victory remainder does not end a wild battle with another living enemy',async()=>{
  const c=await aftermathContext(),enemy=pokemon.restorePokemonState(pokemon.capturePokemonState(c.battle.enemyParty[0]));
  enemy.id=103;enemy.hp=17;enemy.status=null;c.battle.enemyParty.push(enemy);c.battle.enemyLevels.push(enemy.level);
  c.roster.entries.push({owner:null,group:'enemy',index:1,pokemon:enemy});c.roster.field[3]=enemy.id;
  const expected=await referenceAfterBattle(codec.restore(codec.capture(c))),actual=await advanceAftermath(c);
  assert.deepEqual(codec.capture(actual.context),codec.capture(expected.context));
  assert.ok(!actual.context.continuation.phaseQueue.some(d=>d.phase.constructor===originalPhases.BattleEndPhase));
});

test('solo full Victory start retains original XP and reward queues at ordinary and milestone waves',async()=>{
  for(const wave of [1,10,20,50]){
    const c=await aftermathContext(),states=[codec.restore(codec.capture(c)),codec.restore(codec.capture(c))];
    for(const [index,state]of states.entries()){
      state.battle.waveIndex=wave;const p=state.continuation.phaseQueue[0].phase,b=bindExperience(state,p,0,index===1);
      try{b.scene.gameData={gameStats:{pokemonDefeated:0}};b.scene.gameMode.isWaveFinal=()=>false;b.scene.offsetGym=false;
        if(index===1)referenceSoloVictory.call(p);else p.start();assert.equal(b.scene.gameData.gameStats.pokemonDefeated,1);
      }finally{b.dispose();}
    }
    assert.deepEqual(codec.capture(states[0]),codec.capture(states[1]));
  }
});

test('victory and cleanup task failures retain XP, score, modifiers and old queue',async()=>{
  let c=await aftermathContext({temporary:true});
  for(const stage of ['victory','battle-end']){
    if(stage==='battle-end')while(!atBattleEnd(c))c=(await advanceAftermath(c)).context;
    const before=codec.capture(c);
    await assert.rejects(advanceAftermath(c,{}, {onAftermathBind:(_c,_p,_b,tasks,info)=>{
      if(info.stage===stage)tasks.add(Promise.reject(Error(`failed-${stage}`)));
    }}),new RegExp(`failed-${stage}`));assert.deepEqual(codec.capture(c),before);
    c=(await advanceAftermath(c)).context;
  }
});

test('recovery failure cannot publish partial healing or already-added battle score',async()=>{
  let c=await aftermathContext({emptySeat:1});while(!atBattleEnd(c))c=(await advanceAftermath(c)).context;
  const before=codec.capture(c);await assert.rejects(advanceAftermath(c,{}, {onAftermathBind:(_c,_p,_b,tasks,info)=>{
    if(info.stage==='recovery')tasks.add(Promise.reject(Error('recovery failed')));
  }}),/recovery failed/);assert.deepEqual(codec.capture(c),before);
});

test('both personal parties wiped stop before Victory or BattleEnd without granting recovery',async()=>{
  for(const stage of ['victory','battle-end']){
    let c=await aftermathContext();if(stage==='battle-end')while(!atBattleEnd(c))c=(await advanceAftermath(c)).context;
    for(const e of c.roster.entries.filter(e=>e.owner!==null))e.pokemon.hp=0;
    const before=codec.capture(c);await assert.rejects(advanceAftermath(c),/UNCONFIRMED_SIMULTANEOUS_WIPE/);assert.deepEqual(codec.capture(c),before);
  }
});

test('recovery uses the first personal party slot, original rounding and no shared healing bonus',async()=>{
  const c=await aftermathContext({emptySeat:0}),party=c.roster.entries.filter(e=>e.owner===0).sort((a,b)=>a.index-b.index);
  for(const maxHp of [1,21]){
    party[0].pokemon.stats[0]=maxHp;party[0].pokemon.hp=0;party[0].pokemon.status=new status.Status(status.StatusEffect.FAINT);
    const resources=copy(codec.capture(c).players),events=recoverVictoryParties(c,pk=>types.modifierTypes.REVIVE().newModifier(pk).apply([pk]));
    assert.equal(events.length,1);assert.equal(party[0].pokemon.hp,Math.max(Math.floor(maxHp/2),1));assert.equal(party[1].pokemon.hp,0);
    assert.deepEqual(codec.capture(c).players,resources);
  }
  party[0].pokemon.hp=0;party[1].pokemon.hp=1;
  assert.deepEqual(recoverVictoryParties(c,()=>{throw Error('living personal party must not revive');}),[]);
  assert.equal(party[0].pokemon.hp,0);
});

test('aftermath rejects premature/repeated resumes, unsettled work and replacement candidates',async()=>{
  const c=await aftermathContext(),before=codec.capture(c);
  for(const mode of ['pending','incomplete','state','invalid']){
    const driver=aftermathDriver(),run=driver.resumeVictory;driver.resumeVictory=async(candidate,p)=>{const result=await run(candidate,p);
      if(mode==='pending')result.pendingTasks=1;if(mode==='incomplete')result.completed=false;
      if(mode==='state')candidate.continuation={...candidate.continuation};if(mode==='invalid')candidate.scene.score=-1;return result;};
    await assert.rejects(advanceVictoryAftermath(c,codec,driver,{decisionId:'bad-aftermath'}));assert.deepEqual(codec.capture(c),before);
  }
  const {experienceContext}=await import('./helpers/experience-model.mjs'),early=await experienceContext(),saved=codec.capture(early);
  await assert.rejects(advanceVictoryAftermath(early,codec,aftermathDriver(),{decisionId:'premature-aftermath'}),/UNSUPPORTED_VICTORY_PHASE/);
  assert.deepEqual(codec.capture(early),saved);
  const advanced=(await advanceAftermath(c)).context,after=codec.capture(advanced);
  await assert.rejects(advanceVictoryAftermath(advanced,codec,aftermathDriver(),{decisionId:'duplicate-aftermath'}),/UNSUPPORTED_VICTORY_PHASE/);
  assert.deepEqual(codec.capture(advanced),after);
});
