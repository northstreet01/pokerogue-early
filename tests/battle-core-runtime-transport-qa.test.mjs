import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';

// MVP-QA-02A: real Worker transport, message copy, queueing and close lifecycle.
// Every case uses createOriginalRuleHost; no mock Worker and no copied rules.
const config = { seed: 'mvp-transport-qa', identity: { trainerId: 1, secretId: 2 } };
const construct = (speciesId = 1) => ({ speciesId, level: 5, enemy: false });
const clone = value => structuredClone(value);

let baseline1, baseline1State, baseline2, baseline2State, sequence, sequenceState, twoConstructsState;

async function host(t, options = {}) {
  const value = await createOriginalRuleHost({ ...config, ...options });
  t.after(() => value.close());
  return value;
}

before(async () => {
  await buildCoopRuntime();
  const control = await createOriginalRuleHost(config);
  try {
    baseline1 = await control.request('construct', construct(1));
    baseline1State = await control.request('state');
    baseline2 = await control.request('construct', construct(2));
    baseline2State = await control.request('state');
  } finally { await control.close(); }

  const ordered = await createOriginalRuleHost(config);
  try {
    sequence = [];
    for (const id of [1, 25, 906, 4, 7, 912]) sequence.push(await ordered.request('construct', construct(id)));
    sequenceState = await ordered.request('state');
  } finally { await ordered.close(); }

  const two = await createOriginalRuleHost(config);
  try {
    await two.request('construct', construct(1));
    await two.request('construct', construct(25));
    twoConstructsState = await two.request('state');
  } finally { await two.close(); }
});

const invalidTimeouts = [
  ['H01', 'timeoutMs is null', null],
  ['H02', 'timeoutMs is -1', -1],
  ['H03', 'timeoutMs is 0', 0],
  ['H04', 'timeoutMs is 1.5', 1.5],
  ['H05', 'timeoutMs is NaN', NaN],
  ['H06', 'timeoutMs is Infinity', Infinity],
  ['H07', "timeoutMs is the string '15000'", '15000'],
  ['H08', 'timeoutMs is false', false],
  ['H09', 'timeoutMs is 120001', 120001],
  ['H10', 'timeoutMs is Number.MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
];
for (const [id, label, timeoutMs] of invalidTimeouts) {
  test(`${id} ${label} rejects with INVALID_RUNTIME_TIMEOUT`, async () => {
    await assert.rejects(createOriginalRuleHost({ ...config, timeoutMs }), { code: 'INVALID_RUNTIME_TIMEOUT' });
  });
}

const invalidIdentities = [
  ['H11', 'identity is null', null],
  ['H12', 'identity is an empty object', {}],
  ['H13', 'identity has only secretId', { secretId: 2 }],
  ['H14', 'identity has only trainerId', { trainerId: 1 }],
  ['H15', 'trainerId is 1.5', { trainerId: 1.5, secretId: 2 }],
  ['H16', 'secretId is 65536', { trainerId: 1, secretId: 65536 }],
  ['H17', "trainerId is the string '1'", { trainerId: '1', secretId: 2 }],
  ['H18', 'secretId is false', { trainerId: 1, secretId: false }],
];
for (const [id, label, identity] of invalidIdentities) {
  test(`${id} ${label} rejects with INVALID_TRAINER_IDENTITY`, async () => {
    await assert.rejects(createOriginalRuleHost({ ...config, identity }), { code: 'INVALID_TRAINER_IDENTITY' });
  });
}

const invalidSeeds = [
  ['H19', 'seed is null', null],
  ['H20', 'seed is the number 1', 1],
  ['H21', 'seed is an empty string', ''],
  ['H22', 'seed is 257 characters', 'a'.repeat(257)],
];
for (const [id, label, seed] of invalidSeeds) {
  test(`${id} ${label} rejects with INVALID_ROOM_SEED`, async () => {
    await assert.rejects(createOriginalRuleHost({ ...config, seed }), { code: 'INVALID_ROOM_SEED' });
  });
}

const invalidOperations = [
  ['H23', 'operation is null', null],
  ['H24', 'operation is an empty object', {}],
  ['H25', 'operation is an empty string', ''],
  ['H26', 'operation is uppercase STATE', 'STATE'],
];
for (const [id, label, operation] of invalidOperations) {
  test(`${id} ${label} rejects and leaves the host usable`, async t => {
    const value = await host(t);
    const state = await value.request('state');
    const payload = clone(construct(1));
    await assert.rejects(value.request(operation, payload), { code: 'UNSUPPORTED_RUNTIME_OPERATION' });
    assert.deepEqual(payload, construct(1));
    assert.deepEqual(await value.request('state'), state);
    assert.deepEqual(await value.request('construct', construct(1)), baseline1);
    assert.deepEqual(await value.request('state'), baseline1State);
    await value.close();
  });
}

const invalidPayloads = [
  ['H27', 'payload is a function', () => {}],
  ['H28', 'payload is a Symbol', Symbol('payload')],
  ['H29', 'payload is a WeakMap', new WeakMap()],
  ['H30', 'payload is a Promise', Promise.resolve()],
];
for (const [id, label, payload] of invalidPayloads) {
  test(`${id} ${label} rejects with INVALID_RUNTIME_PAYLOAD and keeps the host usable`, async t => {
    const value = await host(t);
    const state = await value.request('state');
    await assert.rejects(value.request('construct', payload), { code: 'INVALID_RUNTIME_PAYLOAD' });
    assert.deepEqual(await value.request('state'), state);
    assert.deepEqual(await value.request('construct', construct(1)), baseline1);
    assert.deepEqual(await value.request('state'), baseline1State);
    await value.close();
  });
}

test('H31 sending construct then mutating the caller payload before await uses the posted copy', async t => {
  const value = await host(t);
  const payload = construct(1);
  const pending = value.request('construct', payload);
  payload.speciesId = 999999;
  payload.level = 99;
  payload.enemy = true;
  const actual = await pending;
  assert.deepEqual(actual, baseline1);
  assert.deepEqual(await value.request('state'), baseline1State);
  await value.close();
});

test('H32 mutating returned catalogs or construct values cannot pollute the worker', async t => {
  const value = await host(t);
  const catalogs = await value.request('catalogs');
  const pristine = clone(catalogs);
  catalogs.species[0].id = -1;
  catalogs.species.push({ id: 0, obtainable: true });
  catalogs.moves.push(0);
  catalogs.abilities.length = 0;
  assert.deepEqual(await value.request('catalogs'), pristine);

  const first = await value.request('construct', construct(1));
  assert.deepEqual(first, baseline1);
  const saved = clone(first);
  first.pokemon.type = 'Changed';
  first.pokemon.fields = {};
  first.pokemon.fields.hp = 0;
  first.random = 'changed';
  assert.equal(first.pokemon.type, 'Changed');
  assert.deepEqual(saved, baseline1);
  assert.deepEqual(await value.request('construct', construct(2)), baseline2);
  assert.deepEqual(await value.request('state'), baseline2State);
  await value.close();
});

test('H33 six queued constructs keep call order and equal sequential results', async t => {
  const value = await host(t);
  const ids = [1, 25, 906, 4, 7, 912];
  const results = await Promise.all(ids.map(id => value.request('construct', construct(id))));
  for (const [index, actual] of results.entries()) assert.deepEqual(actual, sequence[index]);
  assert.deepEqual(await value.request('state'), sequenceState);
  await value.close();
});

test('H34 a rejected item between valid queued items does not disturb the random sequence', async t => {
  const value = await host(t);
  const settled = await Promise.allSettled([
    value.request('construct', construct(1)),
    value.request('construct', construct(999999)),
    value.request('construct', construct(25)),
    value.request('state'),
  ]);
  assert.equal(settled[0].status, 'fulfilled');
  assert.deepEqual(settled[0].value, sequence[0]);
  assert.equal(settled[1].status, 'rejected');
  assert.equal(settled[1].reason.code, 'INVALID_POKEMON_SELECTION');
  assert.equal(settled[2].status, 'fulfilled');
  assert.deepEqual(settled[2].value, sequence[1]);
  assert.equal(settled[3].status, 'fulfilled');
  assert.deepEqual(settled[3].value, twoConstructsState);
  await value.close();
});

test('H35 closing with a pending request rejects it and later requests with ORIGINAL_RUNTIME_CLOSED', async t => {
  const value = await host(t);
  const pending = value.request('catalogs');
  const observed = pending.then(
    () => ({ resolved: true, code: null }),
    error => ({ resolved: false, code: error.code }),
  );
  const closed = value.close();
  await closed;
  assert.deepEqual(await observed, { resolved: false, code: 'ORIGINAL_RUNTIME_CLOSED' });
  await assert.rejects(value.request('catalogs'), { code: 'ORIGINAL_RUNTIME_CLOSED' });
});

test('H36 repeated close with pending work settles and leaves another host independent', async t => {
  const closing = await host(t);
  const other = await host(t);
  const pending = [closing.request('construct', construct(1)), closing.request('construct', construct(25))];
  const observed = pending.map(promise => promise.then(
    () => ({ resolved: true, code: null }),
    error => ({ resolved: false, code: error.code }),
  ));

  const first = closing.close();
  const second = closing.close();
  assert.equal(first, second);
  let timer;
  await Promise.race([
    Promise.all([first, second]),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('close did not settle')), 10000); }),
  ]).finally(() => clearTimeout(timer));
  for (const outcome of await Promise.all(observed)) {
    assert.deepEqual(outcome, { resolved: false, code: 'ORIGINAL_RUNTIME_CLOSED' });
  }

  const otherResults = await Promise.all([
    other.request('construct', construct(1)),
    other.request('construct', construct(25)),
    other.request('state'),
  ]);
  assert.deepEqual(otherResults[0], sequence[0]);
  assert.deepEqual(otherResults[1], sequence[1]);
  assert.deepEqual(otherResults[2], twoConstructsState);
  await other.close();
});
