import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { restoreTurnCommands } from '../src/battle-core/command-state.mjs';

// MVP-QA-01 black-box guards for the real Node Worker entry. Every call goes
// through createOriginalRuleHost; no checkpoint, HP, queue or enemy is filled
// in by hand. A/V/S rows share one real worker and each row still checks the
// worker state, the caller payload and a following legal validation.
const config = { seed: 'mvp-native-entry', identity: { trainerId: 1, secretId: 2 } };
const selection = { parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } };
const clone = value => structuredClone(value);
const frontPhase = checkpoint =>
  (checkpoint.continuation.phaseQueuePrepend.at(-1) ?? checkpoint.continuation.phaseQueue[0])?.phase.type;

let matrix, checkpoint, checkpointSnapshot, action0, action1, control0, control1, baseline;

function pickFight(source, seat) {
  const option = source.decision.options[seat].find(action => Number.isInteger(action.target) && action.target >= 2);
  assert.ok(option, `seat ${seat} must expose a real FIGHT option with target >= 2`);
  return option;
}
function benchId(seat) {
  return checkpoint.roster.entries.find(entry => entry.owner === seat && entry.index === 1).pokemon.fields.id;
}
async function host(t, options = {}) {
  const value = await createOriginalRuleHost({ ...config, ...options });
  t.after(() => value.close());
  return value;
}
const inputs = () => ({ 0: clone(action0), 1: clone(action1) });
const parties = () => clone(selection.parties);
const partiesWith = (seat, index, value) => {
  const copy = parties();
  copy[seat][index] = value;
  return copy;
};
const egg = () => ({ players: [[], []] });

before(async () => {
  await buildCoopRuntime();
  matrix = await createOriginalRuleHost(config);
  checkpoint = (await matrix.request('native-open-to-input', clone(selection))).checkpoint;
  assert.equal(checkpoint.decision.kind, 'wait-actions');
  assert.equal(checkpoint.battle.waveIndex, 1);
  assert.equal(checkpoint.battle.double, true);
  assert.deepEqual(checkpoint.decision.requiredSeats, [0, 1]);
  for (const seat of [0, 1]) assert.ok(checkpoint.decision.options[seat].length > 0);
  action0 = pickFight(checkpoint, 0);
  action1 = pickFight(checkpoint, 1);
  assert.notEqual(action0.pokemonId, action1.pokemonId);
  assert.ok(Number.isInteger(benchId(0)));
  control0 = await matrix.request('native-validate', { checkpoint, seat: 0, action: clone(action0) });
  control1 = await matrix.request('native-validate', { checkpoint, seat: 1, action: clone(action1) });
  baseline = await matrix.request('native-submit', { checkpoint, inputs: inputs() });
  checkpointSnapshot = clone(checkpoint);
});
after(() => matrix?.close());

async function rejectsWithoutSideEffects(operation, payload, code) {
  const state = await matrix.request('state');
  const snapshot = clone(payload);
  await assert.rejects(matrix.request(operation, payload), { code });
  assert.deepEqual(await matrix.request('state'), state, 'worker bootstrap state must stay unchanged');
  assert.deepEqual(payload, snapshot, 'caller payload must not be mutated');
  assert.deepEqual(checkpoint, checkpointSnapshot, 'control checkpoint must not be mutated');
  assert.deepEqual(await matrix.request('native-validate', { checkpoint, seat: 0, action: clone(action0) }), control0);
}

const aCases = [
  ['A01', 'payload is null', () => null, 'INVALID_NATIVE_PARTIES'],
  ['A02', 'payload is an empty object', () => ({}), 'INVALID_NATIVE_PARTIES'],
  ['A03', 'parties is an empty array', () => ({ parties: [], eggState: egg() }), 'INVALID_NATIVE_PARTIES'],
  ['A04', 'parties has only one seat', () => ({ parties: [parties()[0]], eggState: egg() }), 'INVALID_NATIVE_PARTIES'],
  ['A05', 'parties has three seats', () => ({ parties: [parties()[0], parties()[1], parties()[0]], eggState: egg() }), 'INVALID_NATIVE_PARTIES'],
  ['A06', 'first seat has only two species', () => ({ parties: [[1, 4], parties()[1]], eggState: egg() }), 'INVALID_NATIVE_PARTIES'],
  ['A07', 'second seat has four species', () => ({ parties: [parties()[0], [906, 909, 912, 25]], eggState: egg() }), 'INVALID_NATIVE_PARTIES'],
  ['A08', 'first seat is a plain object', () => ({ parties: [{ 0: 1, 1: 4, 2: 7 }, parties()[1]], eggState: egg() }), 'INVALID_NATIVE_PARTIES'],
  ['A09', 'payload has an unknown top-level field', () => ({ ...clone(selection), extra: true }), 'INVALID_NATIVE_PARTIES'],
  ['A10', 'species ID is -1', () => ({ parties: partiesWith(0, 2, -1), eggState: egg() }), 'INVALID_POKEMON_SELECTION'],
  ['A11', 'species ID is 999999', () => ({ parties: partiesWith(0, 2, 999999), eggState: egg() }), 'INVALID_POKEMON_SELECTION'],
  ['A12', "species ID is the string '1'", () => ({ parties: partiesWith(0, 2, '1'), eggState: egg() }), 'INVALID_POKEMON_SELECTION'],
  ['A13', 'species ID is 1.5', () => ({ parties: partiesWith(0, 2, 1.5), eggState: egg() }), 'INVALID_POKEMON_SELECTION'],
  ['A14', 'eggState.players has only one row', () => ({ parties: parties(), eggState: { players: [[]] } }), 'INVALID_EGG_STATE'],
  ['A15', 'one egg is missing timestamp', () => ({
    parties: parties(), eggState: { players: [[{ id: 10000, gachaType: 0, hatchWaves: 3 }], []] },
  }), 'INVALID_EGG_STATE'],
  ['A16', 'eggState has an unknown field', () => ({ parties: parties(), eggState: { players: [[], []], extra: true } }), 'INVALID_EGG_STATE'],
];
for (const [id, label, payload, code] of aCases) {
  test(`${id} ${label}`, () => rejectsWithoutSideEffects('native-open-to-input', payload(), code));
}

const vWrapper = () => ({ checkpoint: clone(checkpoint), seat: 0, action: clone(action0) });
const withoutKind = () => {
  const { kind, ...rest } = clone(action0);
  return rest;
};
const vCases = [
  ['V01', 'wrapper is null', () => null, 'INVALID_NATIVE_ACTION'],
  ['V02', 'wrapper has an unknown field', () => ({ ...vWrapper(), extra: true }), 'INVALID_NATIVE_ACTION'],
  ['V03', 'seat is -1', () => ({ ...vWrapper(), seat: -1 }), 'INVALID_ACTION'],
  ['V04', 'seat is 2', () => ({ ...vWrapper(), seat: 2 }), 'INVALID_ACTION'],
  ['V05', "seat is the string '0'", () => ({ ...vWrapper(), seat: '0' }), 'INVALID_ACTION'],
  ['V06', 'action lacks kind', () => ({ ...vWrapper(), action: withoutKind() }), 'INVALID_ACTION'],
  ['V07', 'action has args', () => ({ ...vWrapper(), action: { ...clone(action0), args: [] } }), 'INVALID_ACTION'],
  ['V08', 'pokemonId is the other seat field ID', () => ({ ...vWrapper(), action: { ...clone(action0), pokemonId: checkpoint.roster.field[1] } }), 'INVALID_ACTION'],
  ['V09', 'pokemonId is a bench ID of the same seat', () => ({ ...vWrapper(), action: { ...clone(action0), pokemonId: benchId(0) } }), 'INVALID_ACTION'],
  ['V10', 'pokemonId is a real enemy ID', () => ({ ...vWrapper(), action: { ...clone(action0), pokemonId: checkpoint.battle.enemyParty[0] } }), 'INVALID_ACTION'],
  ['V11', 'cursor is -1', () => ({ ...vWrapper(), action: { ...clone(action0), cursor: -1 } }), 'INVALID_ACTION'],
  ['V12', 'cursor is 9999', () => ({ ...vWrapper(), action: { ...clone(action0), cursor: 9999 } }), 'INVALID_ACTION'],
  ['V13', 'target is 99', () => ({ ...vWrapper(), action: { ...clone(action0), target: 99 } }), 'INVALID_ACTION'],
  ['V14', "kind is 'capture'", () => ({ ...vWrapper(), action: { ...clone(action0), kind: 'capture' } }), 'INVALID_ACTION'],
  ['V15', 'cursor is 0.5', () => ({ ...vWrapper(), action: { ...clone(action0), cursor: 0.5 } }), 'INVALID_ACTION'],
  ['V16', 'pokemonId is null', () => ({ ...vWrapper(), action: { ...clone(action0), pokemonId: null } }), 'INVALID_ACTION'],
  ['V17', 'action is null', () => ({ ...vWrapper(), action: null }), 'INVALID_ACTION'],
];
for (const [id, label, payload, code] of vCases) {
  test(`${id} ${label}`, () => rejectsWithoutSideEffects('native-validate', payload(), code));
}

const sWrapper = () => ({ checkpoint: clone(checkpoint), inputs: inputs() });
const sCases = [
  ['S01', 'inputs has only seat 0', () => ({ ...sWrapper(), inputs: { 0: clone(action0) } }), 'INCOMPLETE_COMMAND_INPUTS'],
  ['S02', 'inputs is an empty object', () => ({ ...sWrapper(), inputs: {} }), 'INCOMPLETE_COMMAND_INPUTS'],
  ['S03', 'inputs adds seat 2 while keeping both seats', () => ({ ...sWrapper(), inputs: { ...inputs(), 2: clone(action0) } }), 'INCOMPLETE_COMMAND_INPUTS'],
  ['S04', 'inputs is an array of two actions', () => ({ ...sWrapper(), inputs: [clone(action0), clone(action1)] }), 'INCOMPLETE_COMMAND_INPUTS'],
  ['S05', 'the two seats are swapped', () => ({ ...sWrapper(), inputs: { 0: clone(action1), 1: clone(action0) } }), 'INVALID_ACTION'],
  ['S06', "seat 0 kind is 'capture'", () => ({ ...sWrapper(), inputs: { 0: { ...clone(action0), kind: 'capture' }, 1: clone(action1) } }), 'UNSUPPORTED_COMMAND_INPUT'],
  ['S07', 'wrapper has an unknown field', () => ({ ...sWrapper(), extra: true }), 'INVALID_NATIVE_ACTION'],
  ['S08', 'inputs is null', () => ({ ...sWrapper(), inputs: null }), 'INCOMPLETE_COMMAND_INPUTS'],
  ['S09', 'inputs is a string', () => ({ ...sWrapper(), inputs: 'not-an-object' }), 'INCOMPLETE_COMMAND_INPUTS'],
];
for (const [id, label, payload, code] of sCases) {
  test(`${id} ${label}`, () => rejectsWithoutSideEffects('native-submit', payload(), code));
}

test('R01 both seats validate purely in either order', async t => {
  const h = await host(t);
  const state = await h.request('state');
  const beforeCheckpoint = clone(checkpoint);
  const seat0 = [], seat1 = [];
  for (const order of [[0, 1], [1, 0], [0, 1], [1, 0]]) for (const seat of order) {
    const value = await h.request('native-validate', {
      checkpoint: clone(checkpoint), seat, action: clone(seat === 0 ? action0 : action1),
    });
    (seat === 0 ? seat0 : seat1).push(value);
  }
  for (const value of seat0) assert.deepEqual(value, control0);
  for (const value of seat1) assert.deepEqual(value, control1);
  assert.deepEqual(checkpoint, beforeCheckpoint);
  assert.deepEqual(await h.request('state'), state);
});

test('R02 identical checkpoint and inputs are a deterministic candidate retry', async t => {
  const h = await host(t);
  const state = await h.request('state');
  const first = await h.request('native-submit', { checkpoint: clone(checkpoint), inputs: inputs() });
  const second = await h.request('native-submit', { checkpoint: clone(checkpoint), inputs: inputs() });
  assert.deepEqual(first, baseline);
  assert.deepEqual(second, first);

  const commands = restoreTurnCommands(first.checkpoint.battle.turnCommands);
  assert.equal(commands[0].command, 0, 'seat 0 command must be original FIGHT');
  assert.equal(commands[1].command, 0, 'seat 1 command must be original FIGHT');
  assert.equal(frontPhase(first.checkpoint), 'EnemyCommandPhase');
  const starts = first.events.filter(event => event.kind === 'phase-start').map(event => event.phase);
  assert.equal(starts.filter(phase => phase === 'CommandPhase').length, 2);
  assert.deepEqual(first.intents, []);
  assert.deepEqual(await h.request('state'), state);
});

test('R03 a restarted worker reproduces the same submission from checkpoint JSON', async t => {
  const first = await host(t);
  const beforeSubmit = await first.request('native-submit', { checkpoint: clone(checkpoint), inputs: inputs() });
  await first.close();

  const stored = JSON.parse(JSON.stringify(checkpoint));
  const restarted = await host(t);
  const afterSubmit = await restarted.request('native-submit', { checkpoint: stored, inputs: inputs() });

  assert.deepEqual(beforeSubmit, baseline);
  assert.deepEqual(afterSubmit, beforeSubmit);
  assert.equal(frontPhase(afterSubmit.checkpoint), 'EnemyCommandPhase');
  assert.deepEqual(afterSubmit.intents, []);
});

test('R04 a second worker stays isolated while the first handles invalid and valid calls', async t => {
  const a = await host(t), b = await host(t);
  const stateA = await a.request('state'), stateB = await b.request('state');
  const saved = clone(checkpoint);

  await assert.rejects(a.request('native-open-to-input', { ...clone(selection), extra: true }), { code: 'INVALID_NATIVE_PARTIES' });
  await assert.rejects(a.request('native-validate', {
    checkpoint: clone(checkpoint), seat: 2, action: clone(action0),
  }), { code: 'INVALID_ACTION' });
  const validated = await a.request('native-validate', { checkpoint: clone(checkpoint), seat: 0, action: clone(action0) });
  const submitted = await a.request('native-submit', { checkpoint: clone(checkpoint), inputs: inputs() });
  assert.deepEqual(validated, control0);
  assert.deepEqual(submitted, baseline);

  assert.deepEqual(await a.request('state'), stateA);
  assert.deepEqual(await b.request('state'), stateB);
  const fromB = await b.request('native-submit', { checkpoint: saved, inputs: inputs() });
  assert.deepEqual(fromB, baseline);
  assert.deepEqual(saved, checkpoint);
});
