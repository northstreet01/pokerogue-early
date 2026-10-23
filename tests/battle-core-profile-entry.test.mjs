import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { canonical } from '../src/battle-core/coop-contract.mjs';

let api;
const baseStarter = (id, dexAttr = 149n, nature = 0) => ({
  species: api.getPokemonSpecies(id), dexAttr, nature, pokerus: false,
});
const dex = (counts = {}) => {
  const values = {};
  for (const [id, { caught = 0, hatched = 0, nature = 0, ivs = [31, 30, 29, 28, 27, 26] } = {}] of Object.entries(counts))
    values[id] = { ivs, caughtAttr: 149n, natureAttr: 2 ** (nature + 1), caughtCount: caught, hatchedCount: hatched };
  return values;
};
const gameData = (ids, counts, eggs = []) => ({
  trainerId: 11, secretId: 22, dexData: dex(Object.fromEntries(ids.map(id => [id, counts[id] ?? {}]))),
  starterEggMoveData: Object.fromEntries(ids.map(id => [api.getPokemonSpecies(id).getRootSpeciesId(), 0])), eggs,
});
const independentPrice = profile => {
  const view = Object.create(api.GameData.prototype);
  view.dexData = Object.fromEntries(profile.costs.map(cost => [cost.speciesId,
    { caughtCount: cost.caughtCount, hatchedCount: cost.hatchedCount }]));
  const starters = profile.starters.map(starter => ({ speciesId: starter.speciesId,
    cost: api.GameData.prototype.getSpeciesStarterValue.call(view, starter.speciesId) }));
  return { version: api.PROFILE_VERSION, starters, total: starters.reduce((sum, entry) => sum + entry.cost, 0) };
};

before(async () => {
  await buildCoopRuntime();
  api = createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
  api.describeOriginalCatalogs();
});

test('draft alone permits empty selection; original final profile remains nonempty and uses original fractional prices', async () => {
  const gd = gameData([1, 10], { 1: { caught: 25 }, 10: { caught: 25 } });
  const empty = api.captureProfileDraft(gd, []);
  assert.deepEqual(api.priceProfileDraft(empty), { version: 2, starters: [], total: 0 });
  assert.throws(() => api.validateProfile(empty), /INVALID_PROFILE_STARTERS/);
  assert.throws(() => api.captureProfile(gd, []), /INVALID_PROFILE_STARTERS/);
  const value = api.captureProfileDraft(gd, [baseStarter(1), baseStarter(10)]);
  assert.deepEqual(api.priceProfileDraft(value), independentPrice(value));
  const host = await createOriginalRuleHost({ seed: 'draft-no-rng', identity: value.trainer });
  try {
    const before = await host.request('state');
    assert.deepEqual((await host.request('normalize-profile-draft', value)).priced, independentPrice(value));
    assert.deepEqual(await host.request('project-profile-selection', value), [
      { speciesId: 1, cost: 2, formIndex: 0 }, { speciesId: 10, cost: 0.5, formIndex: 0 },
    ]);
    const corrupt = structuredClone(value); corrupt.unlocks[0].ivs[0]--;
    await assert.rejects(host.request('normalize-profile-draft', corrupt), /PROFILE_SELECTION_MISMATCH/);
    assert.deepEqual((await host.request('state')).random, before.random);
  } finally { await host.close(); }
});

test('capture/validate/restore keeps the minimal original profile and costs independently', async t => {
  const egg = new api.Egg(28123456, 0, 3, 1000);
  const gd = gameData([1, 10], { 1: { caught: 25 }, 10: { caught: 25 } }, [egg]);
  const starters = [baseStarter(1), baseStarter(10)];
  const profile = api.captureProfile(gd, starters);
  assert.deepEqual(Object.keys(profile).sort(), ['costs', 'eggs', 'starters', 'trainer', 'unlocks', 'version']);
  assert.equal(profile.trainer.trainerId, 11);
  assert.deepEqual(profile.eggs.map(entry => entry.id), [28123456]);
  assert.deepEqual(profile.starters.map(entry => entry.ivs), [[31, 30, 29, 28, 27, 26], [31, 30, 29, 28, 27, 26]]);
  assert.equal(canonical(api.validateProfile(JSON.parse(JSON.stringify(profile)))), canonical(profile));
  const restored = api.restoreProfile(profile);
  assert.equal(restored.trainer.secretId, 22);
  assert.equal(restored.starters[0].species.speciesId, 1);
  assert.equal(restored.eggs[0].id, 28123456);
  const priced = api.priceProfile(profile);
  assert.deepEqual(priced, independentPrice(profile));
  assert.deepEqual(priced.starters.map(entry => entry.cost), [2, 0.5]);
  assert.equal(priced.total, 2.5);
  const h = await createOriginalRuleHost({ seed: 'profile-worker', identity: { trainerId: 11, secretId: 22 } });
  try {
    const state = await h.request('state');
    assert.deepEqual(await h.request('validate-profile', profile), priced);
    assert.deepEqual(await h.request('validate-profile', profile), priced);
    assert.deepEqual((await h.request('state')).random, state.random);
  } finally { await h.close(); }
});

test('personal discounts differ and 1/6 starter profiles keep real counts', () => {
  const low = api.captureProfile(gameData([1], { 1: { caught: 0 } }), [baseStarter(1)]);
  const high = api.captureProfile(gameData([1], { 1: { caught: 100 } }), [baseStarter(1)]);
  assert.equal(api.priceProfile(low).total, 3);
  assert.equal(api.priceProfile(high).total, 1);
  const ids = [1, 4, 7, 10, 13, 16];
  const six = api.captureProfile(gameData(ids, Object.fromEntries(ids.map(id => [id, {}]))), ids.map(id => baseStarter(id)));
  assert.equal(six.starters.length, 6);
  assert.equal(api.validateProfile(six).starters.length, 6);
  const one = api.captureProfile(gameData([25], { 25: {} }), [baseStarter(25)]);
  assert.equal(api.validateProfile(one).starters.length, 1);
});

test('invalid profile data and cross-record mismatches are rejected without mutating input', async t => {
  const profile = api.captureProfile(gameData([1, 4], { 1: {}, 4: {} }), [baseStarter(1), baseStarter(4)]);
  const before = canonical(profile);
  const rejects = (mutate, code) => {
    const value = JSON.parse(JSON.stringify(profile)); mutate(value);
    assert.throws(() => api.validateProfile(value), error => error.code === code, code);
    assert.equal(canonical(profile), before);
  };
  rejects(value => { value.extra = 1; }, 'INVALID_PROFILE');
  rejects(value => { value.version = 0; }, 'INVALID_PROFILE_VERSION');
  rejects(value => { value.trainer.trainerId = 65536; }, 'INVALID_PROFILE_IDENTITY');
  rejects(value => { value.starters.pop(); }, 'INVALID_PROFILE_COSTS');
  rejects(value => { value.costs[0].caughtCount = -1; }, 'INVALID_PROFILE_COSTS');
  rejects(value => { value.costs[0].speciesId = 4; }, 'INVALID_PROFILE_COSTS');
  rejects(value => { value.starters[1].speciesId = 1; }, 'DUPLICATE_STARTER_SPECIES');
  rejects(value => { value.starters[0].version = 1; }, 'INVALID_STARTER_SELECTION');
  rejects(value => { value.version = 1; }, 'INVALID_PROFILE_VERSION');
  rejects(value => { value.starters[0].ivs[0] = 0; }, 'PROFILE_SELECTION_MISMATCH');
  rejects(value => { value.starters[0].eggMoves = 1; }, 'PROFILE_SELECTION_MISMATCH');
  rejects(value => { value.starters[0].nature = 1; }, 'STARTER_NATURE_NOT_UNLOCKED');
  rejects(value => { value.starters[0].dexAttr = '150'; }, 'STARTER_NOT_UNLOCKED');
  rejects(value => { value.starters[0].moveset = [165]; }, 'INVALID_STARTER_MOVESET');
  rejects(value => { value.eggs = [{ id: 1 }]; }, 'INVALID_EGG_STATE');
  const gd = gameData([1], { 1: {} });
  gd.starterEggMoveData = {};
  assert.throws(() => api.captureProfile(gd, [baseStarter(1)]), error => error.code === 'MISSING_EGG_MOVE_RECORD');
  const h = await createOriginalRuleHost({ seed: 'profile-invalid', identity: { trainerId: 11, secretId: 22 } });
  try {
    const state = await h.request('state');
    await assert.rejects(h.request('validate-profile', { ...profile, version: 0 }), error => error.code === 'INVALID_PROFILE_VERSION');
    assert.deepEqual((await h.request('state')).random, state.random);
    assert.deepEqual(await h.request('validate-profile', profile), api.priceProfile(profile));
  } finally { await h.close(); }
});
