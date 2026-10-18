import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { canonical } from '../src/battle-core/coop-contract.mjs';

let api;
const seed = 'vs02b01-starter-diff', identity = { trainerId: 11, secretId: 22 };
const base = (speciesId = 1, dexAttr = 149n, overrides = {}) => ({ version: 2, speciesId,
  dexAttr: String(dexAttr), nature: 0, moveset: null, pokerus: false,
  ivs: [31, 0, 15, 20, 25, 31], eggMoves: 0, ...overrides });
const originalStarter = dto => ({ species: api.getPokemonSpecies(dto.speciesId), dexAttr: BigInt(dto.dexAttr),
  nature: dto.nature, moveset: dto.moveset === null ? undefined : [...dto.moveset], pokerus: dto.pokerus });

// Independent oracle: RAW fixture -> original getters -> original constructor.
// Never call capture/restore/validate/construct helpers from the bridge here.
function expected(dto) {
  const species = api.getPokemonSpecies(dto.speciesId), dexAttr = BigInt(dto.dexAttr);
  const runtime = api.createOriginalRuntime(seed, identity);
  runtime.scene.gameData.starterEggMoveData = { [species.getRootSpeciesId()]: dto.eggMoves };
  const pokemon = api.withStarterRandomContext(runtime.context, () => {
    const props = Object.create(api.GameData.prototype).getSpeciesDexAttrProps(species, dexAttr);
    const formIndex = Math.min(props.formIndex, Math.max(species.forms.length - 1, 0));
    const gender = species.malePercent !== null
      ? (props.female ? api.Gender.FEMALE : api.Gender.MALE) : api.Gender.GENDERLESS;
    const mon = new api.PlayerPokemon(runtime.scene, species, runtime.scene.gameMode.getStartingLevel(),
      props.abilityIndex, formIndex, gender, props.shiny, dto.ivs.slice(), dto.nature, undefined);
    if (dto.moveset !== null) assert.equal(mon.tryPopulateMoveset(dto.moveset.slice()), true);
    if (dto.pokerus) mon.pokerus = true;
    return api.capturePokemonState(mon);
  });
  return { pokemon, random: runtime.context.sceneRandom.capture() };
}
async function host(t) {
  const h = await createOriginalRuleHost({ seed, identity }); t.after(() => h.close()); return h;
}
before(async () => {
  await buildCoopRuntime();
  api = createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
  api.describeOriginalCatalogs();
});

test('capture/restore copies actual Starter and explicit owner IV/egg-move records through JSON', () => {
  const dto = base(1, 149n, { nature: 12, moveset: [33], pokerus: true, eggMoves: 1 });
  const starter = originalStarter(dto), ivs = [...dto.ivs];
  const captured = api.captureStarterSelection(starter, ivs, 1);
  assert.deepEqual(captured, dto);
  const restored = api.restoreStarterSelection(JSON.parse(JSON.stringify(captured)));
  assert.equal(restored.species, starter.species); assert.equal(restored.dexAttr, 149n);
  assert.equal(restored.eggMoves, 1); assert.equal(restored.pokerus, true);
  assert.deepEqual(restored.ivs, ivs); assert.deepEqual(restored.moveset, [33]);
  assert.notEqual(captured.ivs, ivs); assert.notEqual(captured.moveset, starter.moveset);
  captured.ivs[0] = 0; captured.moveset[0] = 45;
  restored.ivs[1] = 31; restored.moveset[0] = 45;
  assert.deepEqual(ivs, dto.ivs); assert.deepEqual(starter.moveset, [33]);
  assert.equal(api.captureStarterSelection({ ...starter, moveset: undefined }, ivs, 0).moveset, null);
  const omitted = { ...starter }; delete omitted.moveset;
  assert.equal(api.captureStarterSelection(omitted, ivs, 0).moveset, null);
});

test('real Worker JSON construction agrees with the independent raw original chain', async () => {
  const cases = [
    ['ordinary default', base()],
    ['nature/IV/shiny/female', base(1, 128n | 2n | 8n | 32n, { nature: 24, ivs: [0, 1, 2, 3, 4, 5] })],
    ['explicit moves', base(4, 149n, { moveset: [10] })],
    ['second ability', base(16, 128n | 1n | 4n | 32n)],
    ['hidden ability', base(16, 128n | 1n | 4n | 64n)],
    ['real form', base(12, 256n | 1n | 4n | 16n, { pokerus: true })],
    ['genderless', base(81)],
    ['pokerus', base(1, 149n, { pokerus: true })],
    ['owned unlocked egg move', base(1, 149n, { moveset: [202], eggMoves: 1 })],
  ];
  for (const [name, dto] of cases) {
    const h = await createOriginalRuleHost({ seed, identity });
    try {
      const encoded = api.captureStarterSelection(originalStarter(dto), dto.ivs, dto.eggMoves);
      assert.deepEqual(encoded, dto, name + ': capture must preserve the raw fixture');
      const json = JSON.parse(JSON.stringify(encoded));
      const before = structuredClone(json);
      const result = await h.request('construct-starter', json), oracle = expected(dto);
      assert.deepEqual(result, oracle, name);
      assert.deepEqual(json, before);
      assert.equal(result.pokemon.fields.level, 5);
      assert.deepEqual(result.pokemon.fields.ivs, dto.ivs);
      assert.equal(result.pokemon.fields.nature, dto.nature);
      assert.equal(result.pokemon.fields.pokerus, dto.pokerus);
    } finally { await h.close(); }
  }
});

test('fresh Worker with the same identity/seed reproduces full selected state and RNG', async () => {
  const dto = base(1, 149n, { moveset: [202], eggMoves: 1, pokerus: true });
  let first, second;
  try {
    first = await createOriginalRuleHost({ seed, identity });
    const one = await first.request('construct-starter', dto); await first.close();
    second = await createOriginalRuleHost({ seed, identity });
    const two = await second.request('construct-starter', JSON.parse(JSON.stringify(dto)));
    assert.deepEqual(two, one); assert.deepEqual(two, expected(dto));
  } finally { await first?.close(); await second?.close(); }
});

test('malformed JSON selections fail with exact codes without consuming RNG, then legal control works', async t => {
  const h = await host(t), good = base();
  const variants = [
    ['INVALID_STARTER_SELECTION', { ...good, extra: 1 }],
    ['INVALID_STARTER_SELECTION', { ...good, version: 1 }],
    ['INVALID_STARTER_SELECTION', Object.fromEntries(Object.entries({ ...good, version: 1 }).filter(([key]) => key !== 'eggMoves'))],
    ['INVALID_STARTER_SPECIES', { ...good, speciesId: 999999 }],
    ...['0', '05', '-1', 'abc', '21', '1025', '1'.repeat(10000), '1e3'].map(dexAttr =>
      ['INVALID_STARTER_DEX_ATTR', { ...good, dexAttr }]),
    ['INVALID_STARTER_DEX_ATTR', { ...good, dexAttr: String(149n | 2n) }],
    ['INVALID_STARTER_DEX_ATTR', { ...good, dexAttr: String(149n | 256n) }],
    ['INVALID_STARTER_DEX_ATTR', { ...good, speciesId: 12, dexAttr: String(149n | 256n) }],
    ['INVALID_STARTER_NATURE', { ...good, nature: 25 }],
    ['INVALID_STARTER_IVS', { ...good, ivs: [1, 2, 3, 4, 5] }],
    ['INVALID_STARTER_IVS', { ...good, ivs: [1, 2, 3, 4, 5, 32] }],
    ['INVALID_STARTER_MOVESET', { ...good, moveset: [] }],
    ['INVALID_STARTER_MOVESET', { ...good, moveset: [33, 45, 22, 10, 9] }],
    ['INVALID_STARTER_MOVESET', { ...good, moveset: [33, 33] }],
    ['INVALID_STARTER_MOVESET', { ...good, moveset: [999999] }],
    ['INVALID_STARTER_MOVESET', { ...good, moveset: [0] }],
    ['INVALID_STARTER_POKERUS', { ...good, pokerus: 1 }],
    ['INVALID_STARTER_EGG_MOVES', { ...good, eggMoves: -1 }],
    ['INVALID_STARTER_EGG_MOVES', { ...good, eggMoves: 16 }],
    ['INVALID_STARTER_EGG_MOVES', { ...good, eggMoves: null }],
    // Known move ID but locked for this owner: rejection happens after the constructor.
    ['INVALID_STARTER_MOVESET', { ...good, moveset: [202], eggMoves: 0 }],
  ];
  const before = await h.request('state');
  for (const [code, dto] of variants) {
    const input = structuredClone(dto);
    await assert.rejects(h.request('construct-starter', dto), { code });
    assert.deepEqual(await h.request('state'), before);
    assert.deepEqual(dto, input);
  }
  const control = await h.request('construct-starter', good);
  assert.deepEqual(control, expected(good));
});

test('capture rejects non-original types instead of silently coercing them', () => {
  const good = originalStarter(base()), ivs = base().ivs;
  for (const [change, code] of [
    [{ dexAttr: '149' }, 'INVALID_STARTER_DEX_ATTR'],
    [{ dexAttr: 149 }, 'INVALID_STARTER_DEX_ATTR'],
    [{ pokerus: 'false' }, 'INVALID_STARTER_POKERUS'],
    [{ pokerus: 0 }, 'INVALID_STARTER_POKERUS'],
    [{ moveset: false }, 'INVALID_STARTER_MOVESET'],
    [{ moveset: null }, 'INVALID_STARTER_MOVESET'],
    [{ species: { speciesId: 1 } }, 'INVALID_STARTER_SPECIES'],
  ]) assert.throws(() => api.captureStarterSelection({ ...good, ...change }, ivs, 0), { code });
  assert.throws(() => api.captureStarterSelection(good, ivs), { code: 'INVALID_STARTER_EGG_MOVES' });
});

test('shared validators reject sparse/accessor arrays and objects without running getters', () => {
  const good = base(); let called = 0;
  const getter = () => { called++; return 31; };
  const ivs = [...good.ivs]; Object.defineProperty(ivs, 0, { enumerable: true, get: getter });
  const dto = { ...good }; Object.defineProperty(dto, 'version', { enumerable: true, get: getter });
  const moves = [33]; Object.defineProperty(moves, 0, { enumerable: true, get: getter });
  for (const [value, code] of [[dto, 'INVALID_STARTER_SELECTION'],
    [{ ...good, ivs }, 'INVALID_STARTER_IVS'], [{ ...good, ivs: new Array(6) }, 'INVALID_STARTER_IVS'],
    [{ ...good, moveset: new Array(1) }, 'INVALID_STARTER_MOVESET'],
    [{ ...good, moveset: moves }, 'INVALID_STARTER_MOVESET']])
    assert.throws(() => api.validateStarterSelection(value), { code });
  const starter = originalStarter(good);
  Object.defineProperty(starter, 'pokerus', { enumerable: true, get: getter });
  assert.throws(() => api.captureStarterSelection(starter, good.ivs, 0), { code: 'INVALID_STARTER_SELECTION' });
  assert.equal(called, 0);
});

test('late moveset rejection restores original profile descriptor and RNG; success also leaves profile intact', () => {
  const runtime = api.createOriginalRuntime(seed, identity), data = runtime.scene.gameData;
  const originalMap = { 1: 7, 4: 15 }; let reads = 0;
  Object.defineProperty(data, 'starterEggMoveData', { configurable: true, enumerable: false,
    get() { reads++; return originalMap; } });
  const before = Object.getOwnPropertyDescriptors(data), random = runtime.context.sceneRandom.capture();
  assert.throws(() => api.constructOriginalSelectedStarter(runtime, base(1, 149n, { moveset: [202] })),
    /INVALID_STARTER_MOVESET/);
  assert.equal(runtime.context.sceneRandom.capture(), random);
  assert.deepEqual(Object.getOwnPropertyDescriptors(data), before);
  const result = api.constructOriginalSelectedStarter(runtime, base(1, 149n, { moveset: [202], eggMoves: 1 }));
  assert.deepEqual(result, expected(base(1, 149n, { moveset: [202], eggMoves: 1 })));
  assert.deepEqual(Object.getOwnPropertyDescriptors(data), before); assert.equal(reads, 0);
  const fresh = api.createOriginalRuntime(seed, identity);
  api.constructOriginalSelectedStarter(fresh, base());
  assert.ok(!Object.hasOwn(fresh.scene.gameData, 'starterEggMoveData'));
});

test('construction refuses other game modes without changing context', () => {
  const runtime = api.createOriginalRuntime(seed, identity);
  runtime.scene.gameMode = api.gameModes[api.GameModes.ENDLESS];
  const before = runtime.context.sceneRandom.capture(), data = Object.getOwnPropertyDescriptors(runtime.scene.gameData);
  assert.throws(() => api.constructOriginalSelectedStarter(runtime, base()), /UNSUPPORTED_STARTER_GAME_MODE/);
  assert.equal(runtime.context.sceneRandom.capture(), before);
  assert.deepEqual(Object.getOwnPropertyDescriptors(runtime.scene.gameData), data);
});
