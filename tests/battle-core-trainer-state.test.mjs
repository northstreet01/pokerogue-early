import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { trainerStateFields } from '../src/battle-core/trainer-state.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';
import { parse } from './helpers/original-model.mjs';
import { trainerCodec, trainerModule, originalTrainer, bindTrainerScene, configs } from './helpers/trainer-model.mjs';

test('Trainer manifest accounts for every original declared field', () => {
  const cls = parse('field/trainer.ts').statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'Trainer');
  assert.deepEqual(cls.members.filter(ts.isPropertyDeclaration).map(m => m.name.getText()).sort(), [...trainerStateFields].sort());
});

test('production Trainer exports preserve config identity, optional names and original party level behavior', () => {
  for (const configId of [1, 2]) for (const name of ['absent', undefined, null, '', '测试']) {
    const original = bindTrainerScene(originalTrainer(configId));
    if (name !== 'absent') { original.name = name; original.partnerName = name; }
    // Rendering data is not touched, even if it has a throwing accessor.
    Object.defineProperty(original, 'sprite', { enumerable: true, get() { throw Error('render read'); } });
    const saved = trainerCodec.capture(original), restored = trainerCodec.restore(copy(saved));
    assert.equal(Object.getPrototypeOf(restored), trainerModule.default.prototype);
    assert.equal(restored.config, configs[configId]);
    assert.equal(Object.hasOwn(restored, 'scene'), false);
    assert.equal(Object.hasOwn(restored, 'name'), Object.hasOwn(original, 'name'));
    assert.equal(restored.name, original.name);
    bindTrainerScene(restored);
    for (let wave = 1; wave <= 1000; wave++) assert.deepEqual(restored.getPartyLevels(wave), original.getPartyLevels(wave));
    assert.equal(restored.isDouble(), original.isDouble());
    assert.deepEqual(trainerCodec.capture(restored), saved);
  }
});

test('Trainer rejects unknown configs, invalid template/variant, getters and malformed names without mutation', () => {
  const original = originalTrainer(), saved = trainerCodec.capture(original);
  for (const mutate of [s => {s.configId = 999;}, s => {s.configId = '1';}, s => {s.variant = 3;},
    s => {s.partyTemplateIndex = 1;}, s => {s.partyTemplateIndex = -1;}, s => {s.version = 2;},
    s => {s.name = {presence:'value',value:12};}, s => {s.partnerName = {presence:'absent',value:'extra'};},
    s => {s.scene = {};}, s => {s.type = 'Other';}]) {
    const bad = copy(saved); mutate(bad); assert.throws(() => trainerCodec.restore(bad));
    assert.deepEqual(trainerCodec.capture(original), saved);
  }
  original.config = {...configs[1]}; assert.throws(() => trainerCodec.capture(original), /UNKNOWN_TRAINER_CONFIG/);
  original.config = configs[1];
  Object.defineProperty(original, 'variant', { enumerable:true, get() { throw Error('getter executed'); } });
  assert.throws(() => trainerCodec.capture(original), /INVALID_TRAINER_FIELD/);
});
