import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {modifiers,types,modifierCodec} from './helpers/modifier-model.mjs';
import {enemyFaintContext,advanceEnemyFaint,referenceEnemyFaint,atVictoryBoundary,referenceScore} from './helpers/enemy-faint-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {addFaintedEnemyScore} from '../src/battle-core/faint-score.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

for(const slot of [2,3])for(const held of [false,true])test(`original enemy Faint slot=${slot}, held=${held} preserves score, loot and unstarted Victory`,async()=>{
  const c=enemyFaintContext({slot,held}),before=codec.capture(c),r=codec.restore(before);
  const expected=await referenceEnemyFaint(r),actual=await advanceEnemyFaint(codec.restore(JSON.parse(JSON.stringify(before)))),next=actual.context;
  assert.deepEqual(codec.capture(next),codec.capture(expected.context));assert.deepEqual(actual.events,expected.events);
  assert.ok(atVictoryBoundary(next));assert.equal(nextPostPhase(next).battlerIndex,slot);
  assert.equal(next.continuation.currentPhase,null);assert.equal(next.continuation.phaseQueuePrepend[0].remaining,'start');
  assert.equal(next.battle.battleScore,held?40:33);assert.equal(next.battle.postBattleLoot.length,held?1:0);
  assert.deepEqual(next.battle.turnCommands[0].move.targets,[slot]);
  assert.equal(next.continuation.phaseQueue[0].phase.targets,next.battle.turnCommands[0].move.targets);
  assert.deepEqual(next.players,c.players);assert.equal(next.scene.score,c.scene.score);assert.deepEqual(next.battle.playerParticipantIds,c.battle.playerParticipantIds);
  assert.equal(next.roster.entries.find(e=>e.pokemon.id===100+slot).pokemon.hp,0);
  if(held){assert.equal(next.battle.postBattleLoot[0],next.enemyModifiers[0]);assert.equal(next.enemyModifiers[0].pokemonId,null);
    const restored=codec.restore(codec.capture(next));assert.equal(restored.battle.postBattleLoot[0],restored.enemyModifiers[0]);}
  assert.equal(actual.grants.length,0);assert.deepEqual(codec.capture(c),before);
});

test('actual lethal move/apply/Damage/enemy Faint reaches Victory without XP, reward or battle-end execution',async()=>{
  const c=enemyFaintContext({lethalRound:true}),before=codec.capture(c);let a=c,r=codec.restore(before),steps=0;const trace=[];
  while(!atVictoryBoundary(a)){
    assert.ok(++steps<20);trace.push(nextPostPhase(a).constructor.name);const e=await referenceEnemyFaint(r);r=e.context;
    const result=await advanceEnemyFaint(a);a=result.context;assert.deepEqual(codec.capture(a),codec.capture(r));assert.deepEqual(result.events,e.events);
  }
  for(const name of ['TurnStartPhase','MovePhase','MoveEffectPhase','DamagePhase','FaintPhase'])assert.ok(trace.includes(name),name);
  assert.ok(a.battle.battleScore>0);assert.equal(a.battle.turn,c.battle.turn);
  for(const entry of a.roster.entries.filter(e=>e.owner!==null)){
    assert.equal(entry.pokemon.exp,c.roster.entries.find(e=>e.pokemon.id===entry.pokemon.id).pokemon.exp);
    assert.equal(entry.pokemon.friendship,c.roster.entries.find(e=>e.pokemon.id===entry.pokemon.id).pokemon.friendship);}
  assert.ok(a.continuation.phaseQueue.some(d=>d.phase.constructor.name==='TurnEndPhase'));
  const boundary=codec.capture(a);await assert.rejects(advanceEnemyFaint(a),/UNSUPPORTED_RULE_PHASE/);assert.deepEqual(codec.capture(a),boundary);
  assert.deepEqual(codec.capture(c),before);
});

test('original loot filter stages only transferrable held items and preserves shared item types',async()=>{
  const c=enemyFaintContext({held:true}),enemy=c.roster.entries[2].pokemon;
  const type=new types.PokemonBaseStatBoosterModifierType('Protein',1);type.id='BASE_STAT_BOOSTER';
  c.enemyModifiers.push(new modifiers.PokemonBaseStatModifier(type,enemy.id,1,1));
  const sameType=new modifiers.AttackTypeBoosterModifier(c.enemyModifiers[0].type,enemy.id,0,20,1);c.enemyModifiers.push(sameType);
  const expected=await referenceEnemyFaint(codec.restore(codec.capture(c))),a=(await advanceEnemyFaint(c)).context;
  assert.deepEqual(codec.capture(a),codec.capture(expected.context));assert.equal(a.battle.postBattleLoot.length,2);
  assert.equal(a.enemyModifiers[1].pokemonId,enemy.id);assert.equal(a.enemyModifiers[0].type,a.enemyModifiers[2].type);
  const b=codec.restore(JSON.parse(JSON.stringify(codec.capture(a))));assert.equal(b.battle.postBattleLoot[0],b.enemyModifiers[0]);
  assert.equal(b.battle.postBattleLoot[1],b.enemyModifiers[2]);assert.equal(b.enemyModifiers[0].type,b.enemyModifiers[2].type);
});

test('extracted original faint score matches frozen formula over levels, IVs, items and boss scoring multiplier',()=>{
  for(const level of [1,5,50])for(const iv of [0,31])for(const segments of [0,3]){
    const c=enemyFaintContext({held:true}),enemy=c.roster.entries[2].pokemon;enemy.level=level;enemy.ivs.fill(iv);enemy.bossSegments=segments;
    const ignored=new modifiers.AttackTypeBoosterModifier(c.enemyModifiers[0].type,100,0,20,1),items=[...c.enemyModifiers,ignored];
    const scene=()=>({currentBattle:{battleScore:7},getMaxExpLevel:()=>20,findModifiers:(predicate,player)=>{
      assert.equal(player,false);return items.filter(predicate);}}),a=scene(),b=scene();
    addFaintedEnemyScore(a,enemy,modifiers);referenceScore.call(b,enemy);assert.equal(a.currentBattle.battleScore,b.currentBattle.battleScore);
  }
});

test('failed score and late rule tasks retain pre-faint holder, score, status and RNG',async()=>{
  const c=enemyFaintContext({held:true}),before=codec.capture(c);
  for(const mode of ['score','task']){
    await assert.rejects(advanceEnemyFaint(c,{onEnemyBind:(_c,_p,b,tasks,callbacks)=>{
      if(mode==='score'){const score=b.scene.addFaintedEnemyScore;b.scene.addFaintedEnemyScore=enemy=>{score(enemy);throw Error('enemy faint failed');};}
      else callbacks.push(()=>tasks.add(Promise.reject(Error('enemy faint failed'))));
    }}),/enemy faint failed/);assert.deepEqual(codec.capture(c),before);
  }
  const a=(await advanceEnemyFaint(c)).context;assert.equal(a.enemyModifiers[0].pokemonId,null);assert.equal(a.battle.postBattleLoot.length,1);
});

test('null holder is limited to held items and staged enemy-loot aliases, never personal inventory',async()=>{
  const initial=enemyFaintContext({held:true}),a=(await advanceEnemyFaint(initial)).context,saved=codec.capture(a);
  for(const mutate of [s=>s.battle.postBattleLoot=[],s=>{s.players[0].modifiers=[s.enemyModifiers[0]];s.enemyModifiers=[];},
    s=>{s.battle.postBattleLoot=[];s.components[s.enemyModifiers[0]].fields={};}]){
    const bad=copy(saved);mutate(bad);assert.throws(()=>codec.restore(bad));
  }
  const type=types.modifierTypes.POTION();type.id='POTION';const consumable=type.newModifier(initial.roster.entries[0].pokemon);
  consumable.pokemonId=null;assert.throws(()=>modifierCodec.capture(consumable));
  const unstaged=codec.restore(codec.capture(initial));unstaged.enemyModifiers[0].pokemonId=null;assert.throws(()=>codec.capture(unstaged),/UNSTAGED_ENEMY_LOOT/);
});

test('final-boss and living enemy Faint refuse execution; simultaneous wipe retains an undecided Victory boundary',async()=>{
  for(const mode of ['boss','living']){
    const c=enemyFaintContext();if(mode==='boss')c.battle.battleSpec=1;else c.roster.entries[2].pokemon.hp=1;
    const before=codec.capture(c);await assert.rejects(advanceEnemyFaint(c));assert.deepEqual(codec.capture(c),before);
  }
  const c=(await advanceEnemyFaint(enemyFaintContext({bothWiped:true}))).context,saved=codec.capture(c);
  assert.ok(atVictoryBoundary(c));assert.equal(c.decision.kind,'continuing');
  await assert.rejects(advanceEnemyFaint(c),/UNSUPPORTED_RULE_PHASE/);assert.deepEqual(codec.capture(c),saved);
});
