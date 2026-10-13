import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { codec, initialDecision, continueDecision, Battle, Arena, trainerDecisionCodec, initialTrainer, Trainer } from './helpers/decision-model.mjs';
import { parse } from './helpers/original-model.mjs';
import { battleCheckpointFields, arenaCheckpointFields, SceneRandom } from '../src/battle-core/decision-state.mjs';
import { RandomDataGenerator, withSeedOffset } from '../src/battle-core/random.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';
import { originalModifier } from './helpers/modifier-model.mjs';

test('Battle and Arena manifests account for all declared fields', () => {
  for (const [file, name, expected] of [['battle.ts','Battle',battleCheckpointFields],['field/arena.ts','Arena',arenaCheckpointFields]]) {
    const c = parse(file).statements.find(n => ts.isClassDeclaration(n) && n.name.text === name);
    assert.deepEqual(c.members.filter(ts.isPropertyDeclaration).map(m => m.name.getText()).sort(), [...expected].sort());
  }
});
test('wait-action checkpoint restores original prototypes, resources, pools, modifiers, effects and RNG', () => {
  const original = initialDecision(); original.battle.randSeedInt(100); original.sceneRandom.integer(100);
  const saved = codec.capture(original), restored = codec.restore(copy(saved));
  assert.equal(Object.getPrototypeOf(restored.battle), Battle.prototype); assert.equal(Object.getPrototypeOf(restored.arena), Arena.prototype);
  assert.equal(restored.battle.enemyParty[0], restored.roster.entries[2].pokemon);
  assert.deepEqual(codec.capture(restored), saved);
  assert.deepEqual(continueDecision(restored), continueDecision(original)); assert.deepEqual(codec.capture(restored), codec.capture(original));
});
test('all checkpoint sections reject corruption without overwriting a committed context', () => {
  const original = initialDecision(), before = codec.capture(original);
  for (const mutate of [s => { s.sceneRandom='bad'; }, s=>{s.battle.random.turn++;}, s=>{s.players[0].money=-1;}, s=>{delete s.players[1].pokeballCounts[4];}, s=>{s.battle.enemyParty=[100];}, s=>{s.decision.options[0][0].pokemonId=101;}, s=>{s.decision.requiredSeats=[0];delete s.decision.options[1];}, s=>{s.pendingEffects=[{}];}, s=>{s.decision.kind='learn-move';}, s=>{s.battle.turnCommands[0]={command:1};}, s=>{s.components[0].state.type='unregistered';}, s=>{delete s.arena.pokemonPool;}]) {
    const invalid=copy(before); mutate(invalid); assert.throws(()=>codec.restore(invalid)); assert.deepEqual(codec.capture(original),before);
  }
  original.battle.trainer={}; assert.throws(()=>codec.capture(original),/COMPONENT_UNAVAILABLE/);
  const shared=copy(before);shared.players[1].modifiers=shared.players[0].modifiers;
  assert.throws(()=>codec.restore(shared),/SHARED_PERSONAL_MODIFIER/);
  const historical=copy(before);historical.battle.seenEnemyPartyMemberIds.push(100);
  assert.doesNotThrow(()=>codec.restore(historical));
});
test('room-owned scene RNG matches original seed scopes and interleaved rooms remain isolated', () => {
  const legacy = new RandomDataGenerator(['seed']), stream = new SceneRandom(legacy.state());
  const expected = []; withSeedOffset(legacy, 'scope', 37, () => { for(let i=0;i<50;i++) expected.push(legacy.integerInRange(0,99)); });
  assert.deepEqual(stream.scoped('scope',37,r => Array.from({length:50},()=>r.integerInRange(0,99))),expected);
  assert.equal(stream.capture(),legacy.state()); assert.throws(()=>stream.scoped('scope',1,async()=>{}),/ASYNC/);
  const a=initialDecision('a'),b=initialDecision('b'),ra=codec.restore(codec.capture(a)),rb=codec.restore(codec.capture(b));
  for(let i=0;i<20;i++) { const resultA=continueDecision(a),resultB=continueDecision(b); assert.deepEqual(continueDecision(rb),resultB); assert.deepEqual(continueDecision(ra),resultA); }
  assert.deepEqual(codec.capture(a),codec.capture(ra)); assert.deepEqual(codec.capture(b),codec.capture(rb));
});
test('registered trainer and loot restore without constructors; absent codec and unknown fields refuse capture', () => {
  const original=initialDecision();original.battle.trainer=initialTrainer();original.battle.battleType=1;
  original.battle.postBattleLoot=[original.players[0].modifiers[0]];
  const restored=trainerDecisionCodec.restore(trainerDecisionCodec.capture(original));
  assert.equal(Object.getPrototypeOf(restored.battle.trainer),Trainer.prototype);
  assert.equal(restored.battle.trainer.config,original.battle.trainer.config);
  assert.deepEqual(restored.battle.postBattleLoot[0].getArgs(),original.battle.postBattleLoot[0].getArgs());
  assert.equal(restored.battle.postBattleLoot[0],restored.players[0].modifiers[0]);
  assert.throws(()=>codec.capture(original),/COMPONENT_UNAVAILABLE/);
  original.players[0].modifiers[0].newPrivateField=123;
  assert.throws(()=>trainerDecisionCodec.capture(original),/INVALID_MODIFIER_FIELD/);
});

test('decision v3 preserves shared mutable ModifierType identity and rejects forged aliases', () => {
  const original = initialDecision(), first = original.players[0].modifiers[0], second = originalModifier();
  second.type = first.type; original.players[0].modifiers.push(second);
  const saved = codec.capture(original), restored = codec.restore(saved);
  assert.equal(restored.players[0].modifiers[0].type, restored.players[0].modifiers[1].type);
  restored.players[0].modifiers[0].type.tier = 3;
  assert.equal(restored.players[0].modifiers[1].type.tier, 3);
  const corrupt = copy(saved); corrupt.modifierTypeGroups[0].push(999);
  assert.throws(() => codec.restore(corrupt), /INVALID_TYPE_ALIAS/);
  const old = copy(saved); old.version = 2; delete old.modifierPools;
  assert.throws(() => codec.restore(old), /VERSION_MISMATCH/);
});
