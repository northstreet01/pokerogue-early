import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { canonical } from '../src/battle-core/coop-contract.mjs';

let api;
let eggMoveId;
const seed = 'vs02b02-selected-entry';
const identities = [{ trainerId: 11, secretId: 22 }, { trainerId: 33, secretId: 44 }];
const attr = (form, { shiny = false, female = false, ability = 1 } = {}) =>
  (1n << BigInt(7 + form)) | (shiny ? 2n : 1n) | (female ? 8n : 4n)
  | (ability === 1 ? 16n : ability === 2 ? 32n : 64n);
const selection = (speciesId, dexAttr, extra = {}) => ({
  version: 2, speciesId, dexAttr: dexAttr.toString(), nature: 0, moveset: null,
  pokerus: false, ivs: [31, 30, 29, 28, 27, 26], eggMoves: 0, ...extra,
});
const selections = [
  [selection(1, attr(0)), selection(4, attr(0), { moveset: [10], nature: 12 }),
    selection(12, attr(1), { pokerus: true, nature: 24 })],
  [selection(25, attr(0)), selection(133, attr(0, { shiny: true, female: true, ability: 2 })),
    selection(81, attr(0))],
];
const eggState = {
  players: [[{ id: 28123456, gachaType: 0, hatchWaves: 3, timestamp: 1000 }], []],
};
const payload = () => ({ identities: structuredClone(identities), starterSelections: structuredClone(selections),
  eggState: structuredClone(eggState) });
const hostFor = () => createOriginalRuleHost({ seed, identity: identities[0] });

// Independent expected chain: original species/GameData getters and the
// original PlayerPokemon constructor, not the bridge restore/construct helper.
function expectedParty() {
  const runtime = api.createOriginalRuntime(seed, identities[0]);
  return api.withStarterRandomContext(runtime.context, () => {
    const out = [];
    for (let owner = 0; owner < 2; owner++) for (let index = 0; index < 3; index++) {
      const dto = selections[owner][index];
      const species = api.getPokemonSpecies(dto.speciesId);
      const helper = Object.create(api.GameData.prototype);
      const props = helper.getSpeciesDexAttrProps(species, BigInt(dto.dexAttr));
      const formIndex = Math.min(props.formIndex, Math.max(species.forms.length - 1, 0));
      const gender = species.malePercent !== null
        ? (props.female ? api.Gender.FEMALE : api.Gender.MALE) : api.Gender.GENDERLESS;
      runtime.scene.gameData.trainerId = identities[owner].trainerId;
      runtime.scene.gameData.secretId = identities[owner].secretId;
      const pokemon = new api.PlayerPokemon(runtime.scene, species, runtime.scene.gameMode.getStartingLevel(),
        props.abilityIndex, formIndex, gender, props.shiny, dto.ivs.slice(), dto.nature, undefined);
      if (dto.moveset !== null) {
        runtime.scene.gameData.starterEggMoveData = { [species.getRootSpeciesId()]: dto.eggMoves };
        assert.equal(pokemon.tryPopulateMoveset(dto.moveset), true);
        delete runtime.scene.gameData.starterEggMoveData;
      }
      if (dto.pokerus) pokemon.pokerus = true;
      out.push(api.capturePokemonState(pokemon));
    }
    return out;
  });
}

before(async () => {
  await buildCoopRuntime();
  api = createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
  api.describeOriginalCatalogs();
  // Exercise a real unlocked egg move, not just an empty mask.
  const eggMove = api.speciesEggMoves[api.getPokemonSpecies(4).getRootSpeciesId()][0];
  eggMoveId = eggMove;
  selections[0][1].eggMoves = 1;
  selections[0][1].moveset = [eggMove];
});

test('two seats of six v2 selections reach the real first action input', async () => {
  const h = await hostFor();
  try {
    const opened = await h.request('native-open-selected-to-input', payload());
    const c = opened.checkpoint;
    assert.equal(c.decision.kind, 'wait-actions');
    assert.deepEqual(c.decision.requiredSeats, [0, 1]);
    const players = c.roster.entries.filter(entry => entry.owner !== null);
    assert.equal(players.length, 6);
    assert.deepEqual(players.map(entry => [entry.owner, entry.index]), [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
    assert.deepEqual(players.map(entry => entry.pokemon.fields.species),
      selections.flat().map(entry => entry.speciesId));
    assert.deepEqual(players.map(entry => entry.pokemon.fields.level), [5, 5, 5, 5, 5, 5]);
    assert.equal(players[1].pokemon.fields.moveset[0].fields.moveId, eggMoveId);
    // Only fields produced by starter construction; field position, summon and
    // battle bookkeeping are added later by the original battle phases.
    const keys = ['id', 'species', 'level', 'exp', 'levelExp', 'abilityIndex', 'formIndex', 'gender',
      'shiny', 'nature', 'ivs', 'pokerus', 'moveset', 'stats', 'hp', 'compatibleTms', 'metLevel', 'metBiome', 'friendship'];
    const construction = pokemon => Object.fromEntries(keys.map(key => [key, pokemon.fields[key]]));
    assert.deepEqual(players.map(entry => construction(entry.pokemon)), expectedParty().map(construction));
    for (let seat = 0; seat < 2; seat++) {
      const actor = c.roster.field[seat];
      assert.equal(actor, players[seat * 3].pokemon.fields.id);
      assert.ok(c.decision.options[seat].length > 0);
      assert.ok(c.decision.options[seat].filter(option => option.kind !== 'switch').every(option => option.kind === 'fight' && option.pokemonId === actor));
    }
    assert.deepEqual(c.eggState.players[0].map(egg => egg.id), [28123456]);
    assert.deepEqual(c.eggState.players[1], []);
    assert.ok(players.every(entry => entry.pokemon.fields.moveset.length > 0
      && entry.pokemon.fields.moveset.every(move => move.fields.ppUsed === 0)));
  } finally { await h.close(); }
});

test('continuous and per-phase selected entry agree, including JSON and a fresh Worker', async () => {
  const continuousHost = await hostFor();
  const stagedHost = await hostFor();
  const rebuiltHost = await hostFor();
  try {
    const continuous = await continuousHost.request('native-open-selected-to-input', payload());
    const start = await stagedHost.request('native-open-selected', payload());
    assert.notEqual(start.checkpoint.decision.kind, 'wait-actions');
    const staged = await stagedHost.request('native-run-to-boundary', start.checkpoint);
    await stagedHost.close();
    const restartedHost = await hostFor();
    const restarted = await restartedHost.request('native-run-to-boundary', JSON.parse(JSON.stringify(start.checkpoint)));
    await restartedHost.close();
    const json = JSON.parse(JSON.stringify(payload()));
    const rebuilt = await rebuiltHost.request('native-open-selected-to-input', json);
    const semantic = checkpoint => {
      const copy = structuredClone(checkpoint);
      delete copy.decision.id;
      for (const key of ['currentPhase', 'standbyPhase'])
        if (copy.continuation[key]) delete copy.continuation[key].phaseId;
      for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue'])
        for (const descriptor of copy.continuation[key]) delete descriptor.phaseId;
      return copy;
    };
    assert.equal(canonical(semantic(staged.checkpoint)), canonical(semantic(continuous.checkpoint)));
    assert.equal(canonical(semantic(restarted.checkpoint)), canonical(semantic(continuous.checkpoint)));
    assert.equal(canonical(semantic(rebuilt.checkpoint)), canonical(semantic(continuous.checkpoint)));
    assert.equal(staged.checkpoint.sceneRandom, continuous.checkpoint.sceneRandom);
    assert.equal(restarted.checkpoint.sceneRandom, continuous.checkpoint.sceneRandom);
    assert.equal(rebuilt.checkpoint.sceneRandom, continuous.checkpoint.sceneRandom);
    assert.equal(canonical([...start.events, ...staged.events]), canonical(continuous.events));
    assert.equal(canonical([...start.events, ...restarted.events]), canonical(continuous.events));
    assert.equal(canonical(rebuilt.events), canonical(continuous.events));
    assert.equal(canonical([...start.intents, ...staged.intents]), canonical(continuous.intents));
    assert.equal(canonical([...start.intents, ...restarted.intents]), canonical(continuous.intents));
  } finally { await continuousHost.close(); await stagedHost.close(); await rebuiltHost.close(); }
});

test('variable personal parties preserve seat ownership and allow coincident original trainer IDs', async () => {
  const h = await hostFor();
  try {
    for (const [left, right] of [[1, 2], [6, 1], [1, 6]]) {
      const value = payload();
      value.identities[1] = { ...value.identities[0] };
      value.starterSelections = [selections.flat().slice(0, left), selections.flat().slice(0, right)];
      const untouched = structuredClone(value);
      const opened = await h.request('native-open-selected-to-input', value);
      const c = opened.checkpoint;
      assert.equal(c.decision.kind, 'wait-actions');
      assert.deepEqual([0, 1].map(seat => c.roster.entries.filter(e => e.owner === seat).length), [left, right]);
      for (let seat = 0; seat < 2; seat++) {
        const party = c.roster.entries.filter(e => e.owner === seat);
        assert.deepEqual(party.map(e => e.index), party.map((_, i) => i));
        assert.equal(c.roster.field[seat], party[0].pokemon.fields.id);
        assert.ok(c.decision.options[seat].length > 0);
        assert.ok(c.decision.options[seat].filter(option => option.kind !== 'switch').every(option => option.pokemonId === c.roster.field[seat]));
      }
      assert.deepEqual(value, untouched);
      const fresh = await hostFor();
      try {
        assert.deepEqual(await fresh.request('native-project', { checkpoint: JSON.parse(JSON.stringify(c)), seat: 1 }),
          await h.request('native-project', { checkpoint: c, seat: 1 }));
      } finally { await fresh.close(); }
    }
  } finally { await h.close(); }
});

test('invalid selected entry is rejected before committed RNG changes and a valid control succeeds', async () => {
  const h = await hostFor();
  try {
    const before = await h.request('state');
    const bad = (mutate) => { const value = payload(); mutate(value); return value; };
    const cases = [
      ['INVALID_NATIVE_SELECTED_ENTRY', bad(value => { delete value.eggState; })],
      ['INVALID_NATIVE_SELECTED_ENTRY', bad(value => { delete value.identities; })],
      ['INVALID_NATIVE_SELECTED_ENTRY', bad(value => { delete value.starterSelections; })],
      ['INVALID_NATIVE_SELECTED_ENTRY', bad(value => { value.extra = 1; })],
      ['INVALID_TRAINER_IDENTITY', bad(value => { value.identities[1].extra = 1; })],
      ['INVALID_TRAINER_IDENTITY', bad(value => { value.identities[1].trainerId = 65536; })],
      ['INVALID_STARTER_SELECTION', bad(value => { value.starterSelections[1] = []; })],
      ['INVALID_STARTER_SELECTION', bad(value => { value.starterSelections[1] = Array(7).fill(value.starterSelections[1][0]); })],
      ['INVALID_STARTER_SELECTION', bad(value => { value.starterSelections[1][2] = value.starterSelections[1][0]; })],
      ['INVALID_STARTER_SELECTION', bad(value => { value.starterSelections[1][2].version = 1; })],
      ['INVALID_STARTER_DEX_ATTR', bad(value => { value.starterSelections[0][0].dexAttr = '0'; })],
      ['INVALID_STARTER_EGG_MOVES', bad(value => { value.starterSelections[1][2].eggMoves = -1; })],
      ['INVALID_EGG_STATE', bad(value => { value.eggState = { players: [[], null] }; })],
      ['INVALID_EGG_STATE', bad(value => { value.eggState = { players: [[{ id: 1 }], []] }; })],
      ['INVALID_STARTER_SPECIES', bad(value => { value.starterSelections[1][2].speciesId = 999999; })],
    ];
    for (const [code, value] of cases) {
      await assert.rejects(h.request('native-open-selected-to-input', value), error => error.code === code, code);
      assert.deepEqual((await h.request('state')).random, before.random);
    }
    const control = await h.request('native-open-selected-to-input', payload());
    assert.equal(control.checkpoint.decision.kind, 'wait-actions');
  } finally { await h.close(); }
});
