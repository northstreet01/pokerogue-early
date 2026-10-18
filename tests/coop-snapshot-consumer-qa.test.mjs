import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonical } from '../src/battle-core/coop-contract.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';

// MVP-QA-03: deterministic unit matrix for the formal snapshot consumer.
// The shared/personal payloads are protocol counters only: not Pokemon rules,
// not a production projection and not an M6 implementation.
const VERSIONS = Object.freeze({
  protocolVersion: 1,
  checkpointVersion: 1,
  rulesVersion: 'qa-03-rules-v1',
  contentHash: 'qa-03-content-v1',
});
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function makeSnapshot(overrides = {}) {
  const snapshot = {
    type: 'snapshot',
    ...VERSIONS,
    roomId: 'QAROOM',
    runId: 'run-qa-03',
    revision: 1,
    decisionId: 'decision-1',
    connectionEpoch: 'epoch-1',
    seat: 0,
    shared: { turn: 1 },
    personal: { money: 0 },
    events: [],
    grants: [],
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'sharedHash')) snapshot.sharedHash = hash(snapshot.shared);
  if (!Object.hasOwn(overrides, 'personalHash')) snapshot.personalHash = hash(snapshot.personal);
  return snapshot;
}

function makeAdapter(hooks = {}) {
  const state = {
    applied: { shared: { turn: 1 }, personal: { money: 0 } },
    ledger: new Map(),
    log: [],
    applies: [],
    grants: 0,
    captures: 0,
  };
  const adapter = {
    async applySnapshot(message) {
      state.log.push('apply:start');
      state.applies.push(message.revision);
      if (hooks.apply) await hooks.apply({ message, state });
      state.applied = { shared: clone(message.shared), personal: clone(message.personal) };
      state.log.push('apply:end');
    },
    async captureAppliedState() {
      state.captures++;
      state.log.push('capture');
      if (hooks.capture) await hooks.capture({ state, capture: state.captures });
      return clone(state.applied);
    },
    async applyGrantsTransaction(grants) {
      state.grants++;
      state.log.push('grants:start');
      if (hooks.grants) await hooks.grants({ grants, state });
      for (const grant of grants) if (!state.ledger.has(grant.id)) state.ledger.set(grant.id, clone(grant.payload));
      state.log.push('grants:end');
    },
  };
  return { adapter, state };
}

function setup({ hooks = {}, epoch = 'epoch-1' } = {}) {
  const { adapter, state } = makeAdapter(hooks);
  const sent = [];
  const epochRef = { current: epoch };
  const consume = createSnapshotConsumer({
    versions: VERSIONS,
    adapter,
    isCurrent: value => value === epochRef.current,
    send: message => sent.push(message),
  });
  return { consume, sent, adapter, state, epochRef };
}

function assertResync(sent, snapshot) {
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    type: 'requestSnapshot',
    roomId: snapshot.roomId,
    runId: snapshot.runId,
    knownRevision: snapshot.revision,
    reason: 'CLIENT_APPLY_FAILED',
  });
}

const stateAck = snapshot => ({
  type: 'stateAck',
  roomId: snapshot.roomId,
  runId: snapshot.runId,
  revision: snapshot.revision,
  decisionId: snapshot.decisionId,
  connectionEpoch: snapshot.connectionEpoch,
  sharedHash: snapshot.sharedHash,
  personalHash: snapshot.personalHash,
});
const grantAck = (snapshot, grants) => ({
  type: 'grantAck',
  roomId: snapshot.roomId,
  runId: snapshot.runId,
  connectionEpoch: snapshot.connectionEpoch,
  grantIds: grants.map(grant => grant.id),
});

const brokenAdapters = [
  ['K01', 'adapter is null', null],
  ['K02', 'adapter lacks applySnapshot', { captureAppliedState() {}, applyGrantsTransaction() {} }],
  ['K03', 'adapter lacks captureAppliedState', { applySnapshot() {}, applyGrantsTransaction() {} }],
  ['K04', 'adapter lacks applyGrantsTransaction', { applySnapshot() {}, captureAppliedState() {} }],
];
for (const [id, label, adapter] of brokenAdapters) {
  test(`${id} ${label} throws ADAPTER_UNAVAILABLE synchronously`, () => {
    assert.throws(() => createSnapshotConsumer({
      versions: VERSIONS, adapter, isCurrent: () => true, send: () => {},
    }), { code: 'ADAPTER_UNAVAILABLE' });
  });
}

test('K05 a rulesVersion mismatch rejects before hooks or send', async () => {
  const { consume, sent, state } = setup();
  const snapshot = makeSnapshot({ rulesVersion: 'qa-03-rules-other' });
  await assert.rejects(consume(snapshot), { code: 'VERSION_MISMATCH' });
  assert.deepEqual(state.log, []);
  assert.deepEqual(sent, []);
});

test('K06 an unknown snapshot field rejects with INVALID_MESSAGE before hooks', async () => {
  const { consume, sent, state } = setup();
  await assert.rejects(consume({ ...makeSnapshot(), extra: true }), { code: 'INVALID_MESSAGE' });
  assert.deepEqual(state.log, []);
  assert.deepEqual(sent, []);
});

test('K07 a grant seat differing from snapshot.seat rejects before hooks', async () => {
  const { consume, sent, state } = setup();
  await assert.rejects(consume(makeSnapshot({ grants: [{ id: 'g1', seat: 1, payload: {} }] })), { code: 'INVALID_MESSAGE' });
  assert.deepEqual(state.log, []);
  assert.deepEqual(sent, []);
});

test('K08 a non-current initial connectionEpoch returns false without hooks or send', async () => {
  const { consume, sent, state } = setup({ epoch: 'epoch-2' });
  assert.equal(await consume(makeSnapshot()), false);
  assert.deepEqual(state.log, []);
  assert.deepEqual(sent, []);
});

test('K09 a lower revision after a successful consume is ignored without hooks or send', async () => {
  const { consume, sent, state } = setup();
  assert.equal(await consume(makeSnapshot({ revision: 2 })), true);
  const logLength = state.log.length, sentLength = sent.length, applied = clone(state.applied);
  assert.equal(await consume(makeSnapshot({ revision: 1 })), false);
  assert.equal(state.log.length, logLength);
  assert.equal(sent.length, sentLength);
  assert.deepEqual(state.applied, applied);
});

test('K10 a changed runId after success rejects with RUN_MISMATCH without new hooks or send', async () => {
  const { consume, sent, state } = setup();
  assert.equal(await consume(makeSnapshot()), true);
  const logLength = state.log.length, sentLength = sent.length;
  await assert.rejects(consume(makeSnapshot({ revision: 2, runId: 'run-other' })), { code: 'RUN_MISMATCH' });
  assert.equal(state.log.length, logLength);
  assert.equal(sent.length, sentLength);
});

for (const [id, label, change] of [
  ['K11', 'shared value changed without hash', snapshot => { snapshot.shared = { turn: 2 }; }],
  ['K12', 'personal value changed without hash', snapshot => { snapshot.personal = { money: 1 }; }],
]) {
  test(`${id} ${label} rejects SNAPSHOT_CORRUPT with exactly one resync`, async () => {
    const { consume, sent, state } = setup();
    const snapshot = makeSnapshot();
    change(snapshot);
    const before = clone(snapshot);
    await assert.rejects(consume(snapshot), { code: 'SNAPSHOT_CORRUPT' });
    assertResync(sent, snapshot);
    assert.deepEqual(state.log, []);
    assert.deepEqual(snapshot, before);
  });
}

test('K13 applySnapshot failure propagates and requests exactly one resync', async () => {
  const { consume, sent, state } = setup({ hooks: { apply: () => { throw new Error('TEST_APPLY_FAILED'); } } });
  const snapshot = makeSnapshot();
  const before = clone(snapshot);
  await assert.rejects(consume(snapshot), { message: 'TEST_APPLY_FAILED' });
  assertResync(sent, snapshot);
  assert.deepEqual(state.log, ['apply:start']);
  assert.deepEqual(snapshot, before);
});

test('K14 the first capture failure propagates with exactly one resync', async () => {
  const { consume, sent, state } = setup({ hooks: { capture: () => { throw new Error('TEST_CAPTURE_FAILED'); } } });
  const snapshot = makeSnapshot();
  await assert.rejects(consume(snapshot), { message: 'TEST_CAPTURE_FAILED' });
  assertResync(sent, snapshot);
  assert.deepEqual(state.log, ['apply:start', 'apply:end', 'capture']);
  assert.equal(state.grants, 0);
});

for (const [id, label, mutate] of [
  ['K15', 'shared model mismatch on first capture', state => { state.applied.shared.turn = 99; }],
  ['K16', 'personal model mismatch on first capture', state => { state.applied.personal.money = 99; }],
]) {
  test(`${id} ${label} rejects MODEL_MISMATCH with exactly one resync`, async () => {
    const { consume, sent, state } = setup({ hooks: { capture: ({ state: adapterState, capture }) => { if (capture === 1) mutate(adapterState); } } });
    const snapshot = makeSnapshot();
    await assert.rejects(consume(snapshot), { code: 'MODEL_MISMATCH' });
    assertResync(sent, snapshot);
    assert.equal(state.grants, 0);
    assert.equal(state.captures, 1);
  });
}

test('K17 applyGrantsTransaction failure propagates without ACK and resyncs once', async () => {
  const { consume, sent, state } = setup({ hooks: { grants: () => { throw new Error('TEST_STORAGE_FAILED'); } } });
  const snapshot = makeSnapshot({ grants: [{ id: 'g1', seat: 0, payload: { item: 'qa' } }] });
  await assert.rejects(consume(snapshot), { message: 'TEST_STORAGE_FAILED' });
  assertResync(sent, snapshot);
  assert.equal(state.captures, 1);
  assert.equal(state.grants, 1);
});

test('K18 the second capture failure propagates without ACK and resyncs once', async () => {
  const { consume, sent, state } = setup({ hooks: { capture: ({ capture }) => { if (capture === 2) throw new Error('TEST_FINAL_CAPTURE_FAILED'); } } });
  const snapshot = makeSnapshot({ grants: [{ id: 'g1', seat: 0, payload: { item: 'qa' } }] });
  await assert.rejects(consume(snapshot), { message: 'TEST_FINAL_CAPTURE_FAILED' });
  assertResync(sent, snapshot);
  assert.equal(state.captures, 2);
  assert.equal(state.grants, 1);
});

for (const [id, label, mutate] of [
  ['K19', 'grant callback mutates shared', state => { state.applied.shared.turn = 99; }],
  ['K20', 'grant callback mutates personal', state => { state.applied.personal.money = 99; }],
]) {
  test(`${id} ${label} and the final capture rejects MODEL_MISMATCH`, async () => {
    const { consume, sent, state } = setup({ hooks: { grants: ({ state: adapterState }) => mutate(adapterState) } });
    const snapshot = makeSnapshot({ grants: [{ id: 'g1', seat: 0, payload: { item: 'qa' } }] });
    await assert.rejects(consume(snapshot), { code: 'MODEL_MISMATCH' });
    assertResync(sent, snapshot);
    assert.equal(state.captures, 2);
    assert.equal(state.grants, 1);
  });
}

test('K21 a grantless snapshot applies, captures twice and sends only stateAck', async () => {
  const { consume, sent, state } = setup();
  const snapshot = makeSnapshot();
  assert.equal(await consume(snapshot), true);
  assert.deepEqual(state.log, ['apply:start', 'apply:end', 'capture', 'grants:start', 'grants:end', 'capture']);
  assert.equal(state.grants, 1);
  assert.equal(state.captures, 2);
  assert.deepEqual(sent, [stateAck(snapshot)]);
});

test('K22 a personal grant is verified before grantAck then stateAck', async () => {
  const { consume, sent, state } = setup();
  const grants = [{ id: 'g1', seat: 0, payload: { item: 'qa' } }];
  const snapshot = makeSnapshot({ grants });
  assert.equal(await consume(snapshot), true);
  assert.deepEqual(state.log, ['apply:start', 'apply:end', 'capture', 'grants:start', 'grants:end', 'capture']);
  assert.deepEqual(sent, [grantAck(snapshot, grants), stateAck(snapshot)]);
  assert.equal(state.ledger.size, 1);
});

test('K23 consuming the same successful snapshot again applies and ACKs again', async () => {
  const { consume, sent, state } = setup();
  const grants = [{ id: 'g1', seat: 0, payload: { item: 'qa' } }];
  const snapshot = makeSnapshot({ grants });
  assert.equal(await consume(snapshot), true);
  assert.equal(await consume(snapshot), true);
  assert.deepEqual(state.applies, [1, 1]);
  assert.equal(state.captures, 4);
  assert.equal(state.grants, 2);
  assert.equal(state.ledger.size, 1);
  assert.deepEqual(sent, [grantAck(snapshot, grants), stateAck(snapshot), grantAck(snapshot, grants), stateAck(snapshot)]);
});

test('K24 applySnapshot mutating its events copy cannot change the caller snapshot', async () => {
  const { consume, sent } = setup({ hooks: { apply: ({ message }) => { message.events.push('mutated'); } } });
  const snapshot = makeSnapshot({ events: [{ kind: 'phase-start', phase: 'CommandPhase' }] });
  const before = clone(snapshot);
  assert.equal(await consume(snapshot), true);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(sent, [stateAck(snapshot)]);
});

test('K25 grant callback mutating its grants copy cannot change the caller or grantAck ids', async () => {
  const { consume, sent } = setup({ hooks: { grants: ({ grants }) => { grants[0].payload.item = 'mutated'; grants[0].id = 'changed'; } } });
  const grants = [{ id: 'g1', seat: 0, payload: { item: 'qa' } }];
  const snapshot = makeSnapshot({ grants });
  const before = clone(snapshot);
  assert.equal(await consume(snapshot), true);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(sent, [grantAck(snapshot, grants), stateAck(snapshot)]);
});

test('K26 a gated first apply blocks the queued second apply until release', { timeout: 10000 }, async () => {
  const started = deferred(), gate = deferred();
  const { consume, sent, state } = setup({ hooks: { apply: async ({ message }) => { if (message.revision === 1) { started.resolve(); await gate.promise; } } } });
  const first = consume(makeSnapshot({ revision: 1 }));
  await started.promise;
  const second = consume(makeSnapshot({ revision: 2, decisionId: 'decision-2' }));
  await Promise.resolve();
  assert.deepEqual(state.applies, [1]);
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, true);
  assert.equal(b, true);
  assert.deepEqual(state.applies, [1, 2]);
  assert.deepEqual(sent.map(message => message.revision), [1, 2]);
});

test('K27 a failed first apply does not poison the queued second apply', { timeout: 10000 }, async () => {
  const started = deferred(), gate = deferred();
  const { consume, sent, state } = setup({ hooks: { apply: async ({ message }) => {
    if (message.revision === 1) { started.resolve(); await gate.promise; throw new Error('TEST_FIRST_APPLY_FAILED'); }
  } } });
  const first = consume(makeSnapshot({ revision: 1 }));
  const firstOutcome = first.then(() => null, error => error.message);
  await started.promise;
  const second = consume(makeSnapshot({ revision: 2, decisionId: 'decision-2' }));
  gate.resolve();
  const [outcome, secondResult] = await Promise.all([firstOutcome, second]);
  assert.equal(outcome, 'TEST_FIRST_APPLY_FAILED');
  assert.equal(secondResult, true);
  assert.deepEqual(state.applies, [1, 2]);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], {
    type: 'requestSnapshot', roomId: 'QAROOM', runId: 'run-qa-03', knownRevision: 1, reason: 'CLIENT_APPLY_FAILED',
  });
  assert.deepEqual(sent[1], stateAck(makeSnapshot({ revision: 2, decisionId: 'decision-2' })));
});

test('K28 an epoch change during apply returns false without further hooks or ACK', async () => {
  const { consume, sent, state, epochRef } = setup({ hooks: { apply: () => { epochRef.current = 'epoch-2'; } } });
  assert.equal(await consume(makeSnapshot()), false);
  assert.deepEqual(state.log, ['apply:start', 'apply:end']);
  assert.equal(state.captures, 0);
  assert.equal(state.grants, 0);
  assert.deepEqual(sent, []);
});

test('K29 an epoch change during the grants transaction returns false without ACK', async () => {
  const { consume, sent, state, epochRef } = setup({ hooks: { grants: () => { epochRef.current = 'epoch-2'; } } });
  const snapshot = makeSnapshot({ grants: [{ id: 'g1', seat: 0, payload: { item: 'qa' } }] });
  assert.equal(await consume(snapshot), false);
  assert.deepEqual(state.log, ['apply:start', 'apply:end', 'capture', 'grants:start', 'grants:end']);
  assert.equal(state.captures, 1);
  assert.deepEqual(sent, []);
});

test('K30 an epoch change during the final capture returns false without ACK', async () => {
  const { consume, sent, state, epochRef } = setup({ hooks: { capture: ({ capture }) => { if (capture === 2) epochRef.current = 'epoch-2'; } } });
  assert.equal(await consume(makeSnapshot()), false);
  assert.equal(state.captures, 2);
  assert.equal(state.grants, 1);
  assert.deepEqual(sent, []);
});

test('K31 an epoch change plus apply failure propagates without resync or ACK', { timeout: 10000 }, async () => {
  const { consume, sent, epochRef } = setup({ hooks: { apply: () => { epochRef.current = 'epoch-2'; throw new Error('TEST_OLD_EPOCH_APPLY_FAILED'); } } });
  await assert.rejects(consume(makeSnapshot()), { message: 'TEST_OLD_EPOCH_APPLY_FAILED' });
  assert.deepEqual(sent, []);
});

test('K32 two independent consumers keep models, ledgers and sends isolated', async () => {
  const a = setup(), b = setup();
  const aGrants = [{ id: 'a1', seat: 0, payload: { item: 'a' } }];
  const bGrants = [{ id: 'b1', seat: 0, payload: { item: 'b' } }];
  const aSnapshot = makeSnapshot({ roomId: 'ROOM-A', runId: 'run-a', shared: { turn: 1 }, grants: aGrants });
  const bSnapshot = makeSnapshot({ roomId: 'ROOM-B', runId: 'run-b', shared: { turn: 2 }, grants: bGrants, decisionId: 'decision-b' });
  assert.equal(await a.consume(aSnapshot), true);
  assert.equal(await b.consume(bSnapshot), true);
  assert.deepEqual(a.sent, [grantAck(aSnapshot, aGrants), stateAck(aSnapshot)]);
  assert.deepEqual(b.sent, [grantAck(bSnapshot, bGrants), stateAck(bSnapshot)]);
  assert.deepEqual(a.state.applied, { shared: { turn: 1 }, personal: { money: 0 } });
  assert.deepEqual(b.state.applied, { shared: { turn: 2 }, personal: { money: 0 } });
  assert.deepEqual([...a.state.ledger.keys()], ['a1']);
  assert.deepEqual([...b.state.ledger.keys()], ['b1']);
});
