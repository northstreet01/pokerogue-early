import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';

// MVP-QA-02B: real preparation and pre-battle switch RPC boundaries. Every
// checkpoint comes from the real entry; negative cases only change the RPC
// wrapper, seat, inputs or action and never rewrite a checkpoint to fake a stage.
const config = { seed: 'mvp-native-entry', identity: { trainerId: 1, secretId: 2 } };
const selection = { parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } };
const clone = value => structuredClone(value);
const frontPhase = checkpoint =>
  (checkpoint.continuation.phaseQueuePrepend.at(-1) ?? checkpoint.continuation.phaseQueue[0])?.phase.type;
const prepAction = (operation, extra = {}) => ({ kind: 'preparation', operation, ...extra });

let matrix, firstBattle, firstAction0, firstControl0;
let won, prep, prepSnapshot, oneSkip, oneReady, skipResult, nextBattle, switchConfirm, switchSelect;
let confirmSeat, confirmTrue, confirmFalse, selectSeat, selectReserve, selectCancel;
let confirmResult, selectResult, p18Result, otherSeat, selectOtherSeat;

async function host(t, options = {}) {
  const value = await createOriginalRuleHost({ ...config, ...options });
  t.after(() => value.close());
  return value;
}
async function stepUntil(value, checkpoint, kind, budget = 80) {
  let current = checkpoint;
  for (let index = 0; index < budget && current.decision.kind !== kind; index++)
    current = (await value.request('native-step', current)).checkpoint;
  assert.equal(current.decision.kind, kind, `expected ${kind}, got ${current.decision.kind}`);
  return current;
}
async function winToPreparation(value) {
  let current = (await value.request('native-open-to-input', clone(selection))).checkpoint;
  for (let turn = 0; turn < 10; turn++) {
    const inputs = Object.fromEntries([0, 1].map(seat => [seat,
      current.decision.options[seat].find(action => Number.isInteger(action.target) && action.target >= 2)]));
    const submitted = await value.request('native-submit', { checkpoint: current, inputs });
    current = (await value.request('native-run-to-boundary', submitted.checkpoint)).checkpoint;
    if (frontPhase(current) === 'SelectModifierPhase') return current;
  }
  throw new Error('PREPARATION_NOT_REACHED');
}
const prepare = (value, checkpoint, seat, action) =>
  value.request('native-prepare-action', { checkpoint: clone(checkpoint), seat, action: clone(action) });
const useSwitch = (value, checkpoint, inputs) =>
  value.request('native-switch', { checkpoint: clone(checkpoint), inputs: clone(inputs) });

before(async () => {
  await buildCoopRuntime();
  matrix = await createOriginalRuleHost(config);
  firstBattle = (await matrix.request('native-open-to-input', clone(selection))).checkpoint;
  firstAction0 = firstBattle.decision.options[0].find(action => Number.isInteger(action.target) && action.target >= 2);
  assert.ok(firstAction0, 'first battle must expose a real FIGHT option');
  firstControl0 = await matrix.request('native-validate', { checkpoint: firstBattle, seat: 0, action: clone(firstAction0) });

  won = await winToPreparation(matrix);
  prep = (await matrix.request('native-preparation', won)).checkpoint;
  prepSnapshot = clone(prep);
  assert.equal(prep.decision.kind, 'preparation');
  assert.deepEqual(prep.decision.requiredSeats, [0, 1]);

  skipResult = await prepare(matrix, prep, 0, prepAction('skip-reward'));
  oneSkip = skipResult.checkpoint;
  oneReady = (await prepare(matrix, oneSkip, 0, prepAction('ready'))).checkpoint;
  p18Result = await prepare(matrix, oneReady, 1, prepAction('skip-reward'));

  let nextDecision = (await prepare(matrix, oneReady, 1, prepAction('skip-reward'))).checkpoint;
  nextDecision = (await prepare(matrix, nextDecision, 1, prepAction('ready'))).checkpoint;
  assert.equal(nextDecision.decision.kind, 'continuing');
  assert.equal(nextDecision.decision.reason, 'next-battle');
  nextBattle = (await matrix.request('native-next', nextDecision)).checkpoint;

  switchConfirm = await stepUntil(matrix, nextBattle, 'switch-confirm');
  confirmSeat = switchConfirm.decision.requiredSeats[0];
  otherSeat = 1 - confirmSeat;
  confirmTrue = switchConfirm.decision.options[confirmSeat].find(action => action.accept === true);
  confirmFalse = switchConfirm.decision.options[confirmSeat].find(action => action.accept === false);
  assert.ok(confirmTrue && confirmFalse, 'confirm options must include accept true and false');

  confirmResult = await useSwitch(matrix, switchConfirm, { [confirmSeat]: confirmTrue });
  switchSelect = await stepUntil(matrix, confirmResult.checkpoint, 'switch-select');
  selectSeat = switchSelect.decision.requiredSeats[0];
  selectOtherSeat = 1 - selectSeat;
  selectReserve = switchSelect.decision.options[selectSeat].find(action => action.pokemonId !== null);
  selectCancel = switchSelect.decision.options[selectSeat].find(action => action.pokemonId === null);
  assert.ok(selectReserve && selectCancel, 'select options must include reserves and cancel');
  selectResult = await useSwitch(matrix, switchSelect, { [selectSeat]: selectReserve });
});
after(() => matrix?.close());

async function runReject({ operation, make, code, stage, stageSnapshot, control, expected }) {
  const state = await matrix.request('state');
  const beforeStage = stage ? clone(stage()) : null;
  const payload = make();
  const snapshot = clone(payload);
  await assert.rejects(matrix.request(operation, payload), { code });
  assert.deepEqual(await matrix.request('state'), state, 'host bootstrap state must not change');
  assert.deepEqual(payload, snapshot, 'caller payload must not be mutated');
  if (stage) {
    assert.deepEqual(stage(), beforeStage, 'stage checkpoint must not be mutated');
    assert.deepEqual(stage(), stageSnapshot(), 'fixed control checkpoint must still match');
  }
  assert.deepEqual(await control(), expected(), 'a legal operation on the original checkpoint must still match');
}

const prepCases = [
  ['P01', 'payload is null', () => null, 'INVALID_NATIVE_ACTION', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P02', 'wrapper has an extra field', () => ({
    checkpoint: clone(prep), seat: 0, action: prepAction('skip-reward'), extra: true,
  }), 'INVALID_NATIVE_ACTION', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P03', 'wrapper lacks seat', () => ({ checkpoint: clone(prep), action: prepAction('skip-reward') }),
    'INVALID_NATIVE_ACTION', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P04', 'seat is 2', () => ({ checkpoint: clone(prep), seat: 2, action: prepAction('skip-reward') }),
    'INVALID_ACTION_OWNER', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P05', "seat is the string '0'", () => ({ checkpoint: clone(prep), seat: '0', action: prepAction('skip-reward') }),
    'INVALID_ACTION_OWNER', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P06', "action kind is 'fight'", () => ({ checkpoint: clone(prep), seat: 0, action: { kind: 'fight' } }),
    'INVALID_ACTION', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P07', 'skip-reward action has an extra field', () => ({
    checkpoint: clone(prep), seat: 0, action: prepAction('skip-reward', { extra: true }),
  }), 'INVALID_SAFE_DECISION', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P08', "operation is 'unknown'", () => ({
    checkpoint: clone(prep), seat: 0, action: prepAction('unknown'),
  }), 'INVALID_ACTION', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P09', 'ready before the reward is resolved', () => ({
    checkpoint: clone(prep), seat: 0, action: prepAction('ready'),
  }), 'UNRESOLVED_PREPARATION', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P10', 'skip-reward again after it was resolved', () => ({
    checkpoint: clone(oneSkip), seat: 0, action: prepAction('skip-reward'),
  }), 'REWARD_ALREADY_RESOLVED', () => oneSkip, () => clone(oneSkip),
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P12', 'complete reward action for a real option', () => ({
    checkpoint: clone(prep), seat: 0,
    action: prepAction('reward', {
      optionId: prep.decision.players[0].rewards[0].id, pokemonId: null, moveIndex: null, fusionId: null,
    }),
  }), 'PREPARATION_EFFECT_UNAVAILABLE', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P13', 'reward action uses an unknown optionId', () => ({
    checkpoint: clone(prep), seat: 0,
    action: prepAction('reward', {
      optionId: 'not-a-real-option', pokemonId: null, moveIndex: null, fusionId: null,
    }),
  }), 'INVALID_PREPARATION_OPTION', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P14', 'reward action targets the other seat active Pokemon', () => ({
    checkpoint: clone(prep), seat: 0,
    action: prepAction('reward', {
      optionId: prep.decision.players[0].rewards[0].id, pokemonId: prep.roster.field[1], moveIndex: null, fusionId: null,
    }),
  }), 'INVALID_PREPARATION_OWNER', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P15', 'reward action has moveIndex 4', () => ({
    checkpoint: clone(prep), seat: 0,
    action: prepAction('reward', {
      optionId: prep.decision.players[0].rewards[0].id, pokemonId: null, moveIndex: 4, fusionId: null,
    }),
  }), 'INVALID_ACTION', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P16', 'opening preparation again on a preparation decision', () => clone(prep),
    'UNSAFE_PREPARATION_BOUNDARY', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P17', 'native-next before both seats are ready', () => clone(prep),
    'UNSAFE_NEXT_BATTLE_BOUNDARY', () => prep, () => prepSnapshot,
    () => prepare(matrix, prep, 0, prepAction('skip-reward')), () => skipResult],
  ['P18', 'native-next with only one seat ready', () => clone(oneReady),
    'UNSAFE_NEXT_BATTLE_BOUNDARY', () => oneReady, () => clone(oneReady),
    () => prepare(matrix, oneReady, 1, prepAction('skip-reward')), () => p18Result],
  ['P19', 'preparation action on a first-battle wait-actions checkpoint', () => ({
    checkpoint: clone(firstBattle), seat: 0, action: prepAction('skip-reward'),
  }), 'INVALID_SAFE_DECISION', () => firstBattle, () => clone(firstBattle),
    () => matrix.request('native-validate', { checkpoint: firstBattle, seat: 0, action: clone(firstAction0) }), () => firstControl0],
  ['P20', 'native-run-to-boundary on a first-battle wait-actions checkpoint', () => clone(firstBattle),
    'UNSAFE_NATIVE_CONTINUATION', () => firstBattle, () => clone(firstBattle),
    () => matrix.request('native-validate', { checkpoint: firstBattle, seat: 0, action: clone(firstAction0) }), () => firstControl0],
];
for (const [id, label, make, code, stage, stageSnapshot, control, expected] of prepCases) {
  const operation = id === 'P16' ? 'native-preparation'
    : id === 'P17' || id === 'P18' ? 'native-next'
      : id === 'P20' ? 'native-run-to-boundary' : 'native-prepare-action';
  test(`${id} ${label}`, () => runReject({ operation, make, code, stage, stageSnapshot, control, expected }));
}

test('P11 unfunded real preparation rejects reroll before the effect boundary without side effects', async () => {
  // The original ordinary entry starts at zero money; this fixture cannot
  // establish a funded reroll. Keep the real checkpoint and test its guard.
  const player = prep.decision.players[0];
  assert.ok(prep.players[0].money < player.rerollCost, 'real menu must be unable to afford this reroll');
  await runReject({
    operation: 'native-prepare-action',
    make: () => ({ checkpoint: clone(prep), seat: 0, action: prepAction('reroll') }),
    code: 'INVALID_REROLL', stage: () => prep, stageSnapshot: () => prepSnapshot,
    control: () => prepare(matrix, prep, 0, prepAction('skip-reward')), expected: () => skipResult,
  });
});

const confirmWrapper = (inputs = { [confirmSeat]: confirmTrue }, extra = {}) => ({
  checkpoint: clone(switchConfirm), inputs: clone(inputs), ...extra,
});
const confirmCases = [
  ['Q01', 'payload is null', () => null, 'INVALID_NATIVE_ACTION'],
  ['Q02', 'wrapper has an extra field', () => confirmWrapper(undefined, { extra: true }), 'INVALID_NATIVE_ACTION'],
  ['Q03', 'wrapper lacks inputs', () => ({ checkpoint: clone(switchConfirm) }), 'INVALID_NATIVE_ACTION'],
  ['Q04', 'inputs is an empty object', () => confirmWrapper({}), 'INCOMPLETE_SWITCH_INPUTS'],
  ['Q05', 'inputs includes both seats', () => confirmWrapper({ 0: confirmTrue, 1: confirmTrue }), 'INCOMPLETE_SWITCH_INPUTS'],
  ['Q06', 'inputs only includes the other seat', () => confirmWrapper({ [otherSeat]: confirmTrue }), 'INCOMPLETE_SWITCH_INPUTS'],
  ['Q07', 'inputs is an array', () => confirmWrapper([confirmTrue]), 'INCOMPLETE_SWITCH_INPUTS'],
  ['Q08', 'inputs is null', () => confirmWrapper(null), 'INCOMPLETE_SWITCH_INPUTS'],
  ['Q09', "accept is the string 'true'", () => confirmWrapper({ [confirmSeat]: { ...confirmTrue, accept: 'true' } }), 'INVALID_ACTION'],
  ['Q10', 'confirm action lacks pokemonId', () => {
    const action = { ...confirmTrue };
    delete action.pokemonId;
    return confirmWrapper({ [confirmSeat]: action });
  }, 'INVALID_ACTION'],
  ['Q11', 'confirm pokemonId is the other seat active Pokemon', () => confirmWrapper({
    [confirmSeat]: { ...confirmTrue, pokemonId: switchConfirm.roster.field[otherSeat] },
  }), 'INVALID_ACTION'],
  ['Q12', 'confirm pokemonId is an own bench Pokemon', () => confirmWrapper({
    [confirmSeat]: { ...confirmTrue, pokemonId: switchConfirm.roster.entries.find(entry => entry.owner === confirmSeat && entry.index === 1).pokemon.fields.id },
  }), 'INVALID_ACTION'],
  ['Q13', 'confirm action has an extra field', () => confirmWrapper({
    [confirmSeat]: { ...confirmTrue, extra: true },
  }), 'INVALID_ACTION'],
];
for (const [id, label, make, code] of confirmCases) {
  test(`${id} ${label}`, () => runReject({
    operation: 'native-switch', make, code, stage: () => switchConfirm, stageSnapshot: () => clone(switchConfirm),
    control: () => useSwitch(matrix, switchConfirm, { [confirmSeat]: confirmTrue }), expected: () => confirmResult,
  }));
}

const selectWrapper = inputs => ({ checkpoint: clone(switchSelect), inputs: clone(inputs) });
const selectCases = [
  ['Q14', 'select action picks the other seat reserve', () => selectWrapper({
    [selectSeat]: { kind: 'switch-select', pokemonId: switchSelect.roster.entries.find(entry => entry.owner === selectOtherSeat && entry.index === 1).pokemon.fields.id },
  }), 'INVALID_ACTION'],
  ['Q15', 'select action picks the own active Pokemon', () => selectWrapper({
    [selectSeat]: { kind: 'switch-select', pokemonId: switchSelect.roster.field[selectSeat] },
  }), 'INVALID_ACTION'],
  ['Q16', 'select stage receives a confirm action', () => selectWrapper({
    [selectSeat]: { kind: 'switch-confirm', pokemonId: switchSelect.roster.field[selectSeat], accept: true },
  }), 'INVALID_ACTION'],
];
for (const [id, label, make, code] of selectCases) {
  test(`${id} ${label}`, () => runReject({
    operation: 'native-switch', make, code, stage: () => switchSelect, stageSnapshot: () => clone(switchSelect),
    control: () => useSwitch(matrix, switchSelect, { [selectSeat]: selectReserve }), expected: () => selectResult,
  }));
}

test('C01 unready on a fresh menu stays unready without touching resources', async t => {
  const value = await host(t);
  const result = await prepare(value, prep, 0, prepAction('unready'));
  const checkpoint = result.checkpoint;
  assert.equal(checkpoint.decision.players[0].ready, false);
  assert.equal(checkpoint.decision.id, `${prep.decision.id}~1`);
  assert.deepEqual(checkpoint.players, prep.players);
  assert.deepEqual(checkpoint.sceneRandom, prep.sceneRandom);
  assert.deepEqual(checkpoint.modifierPools, prep.modifierPools);
  assert.deepEqual(checkpoint.decision.players.map(player => player.rewards), prep.decision.players.map(player => player.rewards));
  assert.deepEqual(checkpoint.decision.players.map(player => player.shop), prep.decision.players.map(player => player.shop));
});

test('C02 both skip/ready orders reach the same unstarted next-battle state', async t => {
  const value = await host(t);
  let first = prep;
  for (const [seat, operation] of [[0, 'skip-reward'], [0, 'ready'], [1, 'skip-reward'], [1, 'ready']])
    first = (await prepare(value, first, seat, prepAction(operation))).checkpoint;
  let second = prep;
  for (const [seat, operation] of [[1, 'skip-reward'], [0, 'skip-reward'], [1, 'ready'], [0, 'ready']])
    second = (await prepare(value, second, seat, prepAction(operation))).checkpoint;
  assert.deepEqual(first, second);
  assert.equal(first.decision.kind, 'continuing');
  assert.equal(first.decision.reason, 'next-battle');
  assert.equal(frontPhase(first), 'NewBattlePhase');
});

test('C03 unready after ready leaves the partner menu and resources untouched', async t => {
  const value = await host(t);
  const checkpoint = (await prepare(value, oneReady, 0, prepAction('unready'))).checkpoint;
  assert.equal(checkpoint.decision.players[0].ready, false);
  assert.equal(checkpoint.decision.kind, 'preparation');
  assert.deepEqual(checkpoint.decision.players[1], oneReady.decision.players[1]);
  assert.deepEqual(checkpoint.players[1], oneReady.players[1]);
  assert.deepEqual(checkpoint.sceneRandom, oneReady.sceneRandom);
  assert.deepEqual(checkpoint.modifierPools, oneReady.modifierPools);
  const readyAgain = (await prepare(value, checkpoint, 0, prepAction('ready'))).checkpoint;
  assert.equal(readyAgain.decision.players[0].ready, true);
  assert.deepEqual(readyAgain.decision.players[0].rewards, prep.decision.players[0].rewards);
  assert.equal(readyAgain.decision.kind, 'preparation');
});

test('C04 repeating skip/ready/unready on the same old candidate is deterministic', async t => {
  const value = await host(t);
  const skipA = await prepare(value, prep, 0, prepAction('skip-reward'));
  const skipB = await prepare(value, prep, 0, prepAction('skip-reward'));
  assert.deepEqual(skipA, skipB);
  const readyA = await prepare(value, oneSkip, 0, prepAction('ready'));
  const readyB = await prepare(value, oneSkip, 0, prepAction('ready'));
  assert.deepEqual(readyA, readyB);
  const unreadyA = await prepare(value, oneReady, 0, prepAction('unready'));
  const unreadyB = await prepare(value, oneReady, 0, prepAction('unready'));
  assert.deepEqual(unreadyA, unreadyB);
});

test('C05 preparation JSON restart matches the uninterrupted legal result', async t => {
  const uninterrupted = await (await host(t)).request('native-prepare-action', {
    checkpoint: clone(prep), seat: 0, action: prepAction('skip-reward'),
  });
  const restarted = await host(t);
  const stored = JSON.parse(JSON.stringify(prep));
  const after = await restarted.request('native-prepare-action', {
    checkpoint: stored, seat: 0, action: prepAction('skip-reward'),
  });
  assert.deepEqual(after, uninterrupted);
});

test('C06 switch-confirm JSON restart reproduces the rejected switch choice', async t => {
  const uninterrupted = await (await host(t)).request('native-switch', {
    checkpoint: clone(switchConfirm), inputs: { [confirmSeat]: confirmFalse },
  });
  const restarted = await host(t);
  const stored = JSON.parse(JSON.stringify(switchConfirm));
  const after = await restarted.request('native-switch', {
    checkpoint: stored, inputs: { [confirmSeat]: confirmFalse },
  });
  assert.deepEqual(after, uninterrupted);
});

test('C07 switch-select JSON restart reproduces the reserve choice and continues to real actions', async t => {
  const value = await host(t);
  const uninterrupted = await useSwitch(value, switchSelect, { [selectSeat]: selectReserve });
  const restarted = await host(t);
  const stored = JSON.parse(JSON.stringify(switchSelect));
  const after = await restarted.request('native-switch', {
    checkpoint: stored, inputs: { [selectSeat]: selectReserve },
  });
  assert.deepEqual(after, uninterrupted);

  let current = uninterrupted.checkpoint;
  for (let index = 0; index < 120 && current.decision.kind !== 'wait-actions'; index++) {
    if (current.decision.kind === 'switch-confirm') {
      const seat = current.decision.requiredSeats[0];
      const action = current.decision.options[seat].find(option => option.accept === false);
      current = (await value.request('native-switch', { checkpoint: current, inputs: { [seat]: action } })).checkpoint;
    } else if (current.decision.kind === 'switch-select') {
      const seat = current.decision.requiredSeats[0];
      const action = current.decision.options[seat].find(option => option.pokemonId === null);
      current = (await value.request('native-switch', { checkpoint: current, inputs: { [seat]: action } })).checkpoint;
    } else current = (await value.request('native-step', current)).checkpoint;
  }
  assert.equal(current.decision.kind, 'wait-actions');
  assert.equal(current.battle.waveIndex, 2);
  assert.equal(current.roster.field[selectSeat], selectReserve.pokemonId);
  assert.equal(current.roster.field[1 - selectSeat], switchSelect.roster.field[1 - selectSeat]);
  for (const seat of [0, 1]) assert.ok(current.decision.options[seat].filter(action => action.kind !== 'switch').every(action => action.pokemonId === current.roster.field[seat]));
});

test('C08 two hosts keep preparation, RNG, resources and legal results isolated', async t => {
  const a = await host(t), b = await host(t);
  const prepB = (await b.request('native-preparation', won)).checkpoint;
  assert.deepEqual(prepB, prep);
  const stateB = await b.request('state');

  await assert.rejects(prepare(a, prep, 2, prepAction('skip-reward')), { code: 'INVALID_ACTION_OWNER' });
  await assert.rejects(useSwitch(a, switchConfirm, { [1 - confirmSeat]: confirmTrue }), { code: 'INCOMPLETE_SWITCH_INPUTS' });
  const legalA = await prepare(a, prep, 0, prepAction('skip-reward'));
  assert.deepEqual(legalA, skipResult);

  assert.deepEqual(await b.request('state'), stateB);
  assert.deepEqual((await b.request('native-preparation', won)).checkpoint, prep);
  assert.deepEqual(await prepare(b, prepB, 0, prepAction('skip-reward')), skipResult);
});
