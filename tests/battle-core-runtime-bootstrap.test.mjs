import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';

before(async () => { await buildCoopRuntime(); });
const options = { seed: 'mvp-runtime-original-catalogs', identity: { trainerId: 123, secretId: 456 } };
const construct = (speciesId = 1, enemy = false, level = 5) => ({ speciesId, enemy, level });
async function host(t, extra = {}) {
  const value = await createOriginalRuleHost({ ...options, ...extra });
  t.after(() => value.close());
  return value;
}

test('server loads the complete original catalogues without DOM or test fixtures', async t => {
  const h = await host(t), first = await h.request('catalogs');
  assert.equal(h.readiness.stage, 'model-bootstrap');
  assert.equal(h.readiness.gameplayReady, false);
  assert.equal(first.species.length, 1082);
  assert.equal(first.moves.length, 920);
  assert.equal(first.abilities.length, 311);
  assert.equal(new Set(first.species.map(s => s.id)).size, first.species.length);
  assert.equal(new Set(first.moves).size, first.moves.length);
  assert.equal(new Set(first.abilities).size, first.abilities.length);
  for (const id of [1, 25, 151, 201, 386, 493, 658, 772, 809, 906, 1000, 1025])
    assert.ok(first.species.some(s => s.id === id), `missing original species ${id}`);
  // A second BattleScene must not append another copy to original globals.
  assert.deepEqual(await h.request('catalogs'), first);
  assert.deepEqual(await h.request('catalogs'), first);
});

test('every original species constructs and roundtrips as a real PlayerPokemon and EnemyPokemon', async t => {
  const h = await host(t), { species } = await h.request('catalogs');
  for (const { id, obtainable } of species) for (const enemy of [false, true]) {
    if (!enemy && !obtainable) continue;
    const { pokemon } = await h.request('construct', construct(id, enemy));
    assert.equal(pokemon.type, enemy ? 'EnemyPokemon' : 'PlayerPokemon');
    assert.deepEqual(await h.request('roundtrip', pokemon), pokemon, `species ${id}, enemy ${enemy}`);
  }
});

test('original construction resumes the exact next result and stream in a new worker', async t => {
  const uninterrupted = await host(t);
  await uninterrupted.request('construct', construct(906));
  const saved = await uninterrupted.request('state');
  const resumed = await host(t, { randomState: saved.random });
  const sequence = [construct(25), construct(201, true), construct(493), construct(1000, true)];
  for (const choice of sequence) assert.deepEqual(
    await resumed.request('construct', choice), await uninterrupted.request('construct', choice));
  assert.deepEqual(await resumed.request('state'), await uninterrupted.request('state'));
});

test('two concurrent room workers keep original class catalogues and RNG independent', async t => {
  const a = await host(t), b = await host(t), baseline = await host(t);
  const untouched = await b.request('state');
  await a.request('construct', construct(1025, true));
  assert.deepEqual(await b.request('state'), untouched);
  const choices = [construct(1), construct(658, true), construct(906)];
  for (const choice of choices) {
    const [actual, expected] = await Promise.all([b.request('construct', choice), baseline.request('construct', choice)]);
    assert.deepEqual(actual, expected);
  }
  assert.deepEqual(await a.request('catalogs'), await b.request('catalogs'));
});

test('failed original checkpoint capture rolls back random consumption', async t => {
  const a = await host(t), b = await host(t), before = await a.request('state');
  // Valid integer input reaches the original constructor, but its enormous
  // resulting exp/stats are outside the existing M2 safe-integer checkpoint.
  await assert.rejects(a.request('construct', construct(1, false, Number.MAX_SAFE_INTEGER)), { code: 'ORIGINAL_RUNTIME_FAILED' });
  assert.deepEqual(await a.request('state'), before);
  assert.deepEqual(await a.request('construct', construct(1)), await b.request('construct', construct(1)));
});

test('invalid selections and unsupported operations cannot mutate worker state', async t => {
  const h = await host(t), before = await h.request('state');
  for (const value of [construct(-1), construct(999999), construct(1, false, 0),
    { ...construct(), owner: 1 }, { ...construct(), enemy: 0 }]) {
    await assert.rejects(h.request('construct', value), { code: 'INVALID_POKEMON_SELECTION' });
  }
  await assert.rejects(h.request('run-script', 'process.exit()'), { code: 'UNSUPPORTED_RUNTIME_OPERATION' });
  await assert.rejects(h.request('construct', () => {}), { code: 'INVALID_RUNTIME_PAYLOAD' });
  assert.deepEqual(await h.request('state'), before);
});

test('damaged original Pokemon payload is rejected without consuming random', async t => {
  const h = await host(t), { pokemon } = await h.request('construct', construct());
  const before = await h.request('state');
  const broken = structuredClone(pokemon); broken.fields.species = 999999;
  await assert.rejects(h.request('roundtrip', broken), { code: 'ORIGINAL_RUNTIME_FAILED' });
  assert.deepEqual(await h.request('state'), before);
  assert.deepEqual(await h.request('roundtrip', pokemon), pokemon);
});

test('worker failure or close does not stop a different room', async t => {
  const a = await host(t), b = await host(t);
  await a.close(); await a.close();
  await assert.rejects(a.request('state'), { code: 'ORIGINAL_RUNTIME_CLOSED' });
  assert.equal((await b.request('construct', construct())).pokemon.type, 'PlayerPokemon');
});

test('startup rejects missing trainer identity instead of inventing a personal profile', async () => {
  for (const identity of [undefined, {}, { trainerId: -1, secretId: 0 }, { trainerId: 0, secretId: 65536 }])
    await assert.rejects(createOriginalRuleHost({ ...options, identity }), { code: 'INVALID_TRAINER_IDENTITY' });
});

test('startup rejects corrupt saved RNG and invalid seed', async () => {
  await assert.rejects(createOriginalRuleHost({ ...options, randomState: 'damaged' }));
  await assert.rejects(createOriginalRuleHost({ ...options, seed: '' }), { code: 'INVALID_ROOM_SEED' });
  await assert.rejects(createOriginalRuleHost({ ...options, timeoutMs: 0 }), { code: 'INVALID_RUNTIME_TIMEOUT' });
});

test('worker startup watchdog releases a stalled worker', async () => {
  await assert.rejects(createOriginalRuleHost({ ...options, timeoutMs: 1 }), { code: 'ORIGINAL_RUNTIME_TIMEOUT' });
});

test('headless display and global fallback RNG fail explicitly', async () => {
  const { Phaser } = await import('../server/headless-presentation.mjs');
  assert.throws(() => new Phaser.GameObjects.Sprite(), { code: 'HEADLESS_PRESENTATION_UNAVAILABLE' });
  assert.throws(() => Phaser.Math.RND, { code: 'HEADLESS_PRESENTATION_UNAVAILABLE' });
  assert.equal(Phaser.Math.Linear(10, 20, 0.25), 12.5);
});
