import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { attachFormalCoopServer, FormalRoomStore } from '../server/formal-coop-service.mjs';
import { createOriginalCoopAdapter } from '../server/original-coop-adapter.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';
import { canonical } from '../src/battle-core/coop-contract.mjs';
import { createOriginalClientModel } from '../src/coop/original-client-model.mjs';

// VS-01 internal seam proof: two real WebSocket clients, the formal coordinator,
// the eight-method original adapter, a room-scoped original Worker, real
// personal Pokemon restoration and the formal snapshot consumer.
let original;

before(async () => {
  await buildCoopRuntime();
  original = createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
  original.describeOriginalCatalogs();
});

class MemoryStore {
  async load() { return []; }
  async save(room) { this.room = JSON.parse(JSON.stringify(room)); }
}

class Client {
  constructor(ws) {
    this.ws = ws;
    this.messages = [];
    this.snapshots = [];
    this.waiters = [];
    this.epoch = null;
    this.roomId = null;
    this.seat = null;
    this.consumer = null;
    this.model = createOriginalClientModel(original);
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      this.messages.push(message);
      if (message.type === 'snapshot') this.snapshots.push(message);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    });
    ws.on('error', () => {});
  }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return new Client(ws);
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  wait(predicate, timeout = 30000) {
    const found = this.messages.find(predicate);
    if (found) return Promise.resolve(found);
    return this.next(predicate, timeout);
  }
  next(predicate, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error('WS_WAIT_TIMEOUT'));
      }, timeout);
      this.waiters.push(waiter);
    });
  }
  latestSnapshot() { return this.snapshots.at(-1); }
  async waitRevisionAfter(revision) {
    const latest = this.latestSnapshot();
    if (latest && latest.revision > revision) return latest;
    for (;;) {
      await this.next(message => message.type === 'snapshot' && message.revision > revision);
      return this.latestSnapshot();
    }
  }
  async waitSnapshotCount(count) {
    if (this.snapshots.length > count) return this.latestSnapshot();
    await this.next(message => message.type === 'snapshot');
    return this.latestSnapshot();
  }
  close() { try { this.ws.close(); } catch {} }
}

class Env {
  constructor(httpServer, adapter, store, service, url) {
    Object.assign(this, { httpServer, adapter, store, service, url });
    this.clients = [];
  }
  async close() {
    for (const client of this.clients) client.close();
    await this.service.close();
    await new Promise(resolve => this.httpServer.close(resolve));
    await this.adapter.closeAll();
  }
}

async function startEnv(options = {}) {
  const httpServer = http.createServer((request, response) => { response.writeHead(404); response.end('not found'); });
  const adapter = createOriginalCoopAdapter({
    fixture: options.fixture ?? {
      seed: 'vs01-ws-original', identity: { trainerId: 1, secretId: 2 },
      parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] },
    },
  });
  const store = options.store ?? new MemoryStore();
  const service = await attachFormalCoopServer(httpServer, { adapter, store, heartbeatMs: 60000 });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  return new Env(httpServer, adapter, store, service, `ws://127.0.0.1:${httpServer.address().port}/coop/v1/ws`);
}

async function connect(env, name) {
  const client = await Client.open(env.url);
  env.clients.push(client);
  client.name = name;
  client.send({ type: 'hello', ...env.service.versions });
  await client.wait(message => message.type === 'welcome');
  return client;
}

async function createRoom(env) {
  const a = await connect(env, 'A');
  a.send({ type: 'createRoom', name: 'A' });
  const welcomeA = await a.wait(message => message.type === 'welcome' && message.roomId);
  a.roomId = welcomeA.roomId; a.seat = welcomeA.seat;
  await a.wait(message => message.type === 'snapshot' && message.roomId === welcomeA.roomId);

  const b = await connect(env, 'B');
  const countA = a.snapshots.length;
  b.send({ type: 'joinRoom', roomId: welcomeA.roomId, name: 'B' });
  const welcomeB = await b.wait(message => message.type === 'welcome' && message.roomId);
  b.roomId = welcomeB.roomId; b.seat = welcomeB.seat;
  await b.wait(message => message.type === 'snapshot' && message.roomId === welcomeB.roomId);
  const sa = await a.waitSnapshotCount(countA);
  const sb = b.latestSnapshot();
  return { a, b, roomId: welcomeA.roomId, runId: sa.runId, sa, sb };
}

async function applyAndAck(env, client, snapshot) {
  if (client.epoch !== snapshot.connectionEpoch) client.epoch = snapshot.connectionEpoch;
  if (!client.consumer) client.consumer = createSnapshotConsumer({
    versions: env.service.versions,
    adapter: client.model,
    isCurrent: epoch => epoch === client.epoch,
    send: message => client.send(message),
  });
  assert.equal(await client.consumer(snapshot), true);
}

function requiresInput(snapshot) {
  const decision = snapshot.personal.decision;
  return ['lobby', 'wait-actions', 'preparation', 'switch-confirm', 'switch-select'].includes(decision.kind)
    && decision.requiredSeats.length > 0;
}

async function syncBoth(env, a, b, sa, sb) {
  let snapA = sa, snapB = sb;
  for (let budget = 0; budget < 60; budget++) {
    await Promise.all([applyAndAck(env, a, snapA), applyAndAck(env, b, snapB)]);
    if (requiresInput(snapA)) return { sa: snapA, sb: snapB };
    const revision = snapA.revision;
    [snapA, snapB] = await Promise.all([a.waitRevisionAfter(revision), b.waitRevisionAfter(revision)]);
  }
  throw new Error('SYNC_BUDGET_EXCEEDED');
}

let actionCounter = 0;
async function submit(client, snapshot, action) {
  const actionId = `${client.name}-${snapshot.revision}-${++actionCounter}`;
  const message = {
    type: 'submitAction', roomId: snapshot.roomId, runId: snapshot.runId,
    decisionId: snapshot.decisionId, expectedRevision: snapshot.revision, actionId, action,
  };
  client.send(message);
  const receipt = await client.wait(item => item.type === 'actionReceipt' && item.actionId === actionId);
  assert.equal(receipt.accepted, true, `receipt ${actionId}: ${JSON.stringify(receipt)}`);
  return receipt;
}

async function submitOne(env, room, client, snapshot, action) {
  await submit(client, snapshot, action);
  const [sa, sb] = await Promise.all([
    room.a.waitRevisionAfter(snapshot.revision), room.b.waitRevisionAfter(snapshot.revision),
  ]);
  return syncBoth(env, room.a, room.b, sa, sb);
}

async function submitBoth(env, room, sa, sb, actions) {
  const revision = sa.revision;
  await submit(room.a, sa, actions[0]);
  await submit(room.b, sb, actions[1]);
  const [nextA, nextB] = await Promise.all([room.a.waitRevisionAfter(revision), room.b.waitRevisionAfter(revision)]);
  return syncBoth(env, room.a, room.b, nextA, nextB);
}

function fightAction(snapshot) {
  const action = snapshot.personal.decision.options.find(option =>
    option.kind === 'fight' && Number.isInteger(option.target) && option.target >= 2);
  assert.ok(action, 'a real FIGHT option with target >= 2 is required');
  return action;
}

async function reachPreparation(env, room, state) {
  for (let turn = 0; turn < 8 && state.sa.personal.decision.kind === 'wait-actions'; turn++) {
    state = await submitBoth(env, room, state.sa, state.sb, [fightAction(state.sa), fightAction(state.sb)]);
  }
  assert.equal(state.sa.personal.decision.kind, 'preparation');
  return state;
}

async function finishPreparation(env, room, state) {
  for (const seat of [0, 1]) {
    const client = seat === 0 ? room.a : room.b;
    for (const operation of ['skip-reward', 'ready']) {
      const snapshot = seat === 0 ? state.sa : state.sb;
      state = await submitOne(env, room, client, snapshot, { kind: 'preparation', operation });
    }
  }
  return state;
}

async function finishSwitches(env, room, state) {
  for (let guard = 0; guard < 10; guard++) {
    const kind = state.sa.personal.decision.kind;
    if (kind === 'wait-actions') return state;
    if (kind !== 'switch-confirm' && kind !== 'switch-select') throw new Error(`unexpected ${kind}`);
    const seat = state.sa.personal.decision.requiredSeats[0];
    const snapshot = seat === 0 ? state.sa : state.sb;
    const action = kind === 'switch-confirm'
      ? snapshot.personal.decision.options.find(option => option.accept === (seat === 0))
      : snapshot.personal.decision.options.find(option => option.pokemonId !== null);
    assert.ok(action, `${kind} action for seat ${seat}`);
    state = await submitOne(env, room, seat === 0 ? room.a : room.b, snapshot, action);
  }
  throw new Error('SWITCH_BUDGET_EXCEEDED');
}

test('two real WS clients drive the original worker to the second battle FIGHT', { timeout: 120000 }, async () => {
  const env = await startEnv();
  try {
    const room = await createRoom(env);
    let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);

    assert.equal(room.sa.sharedHash, room.sb.sharedHash);
    assert.equal(state.sa.sharedHash, state.sb.sharedHash);
    assert.ok(state.sa.shared.waveIndex === 1);
    assert.ok(state.sa.shared.pokemon.length >= 2);
    for (const snapshot of [state.sa, state.sb]) {
      assert.ok(snapshot.personal.party.every(entry => entry.owner === snapshot.seat));
      assert.ok(!canonical(snapshot.shared).includes('sceneRandom'));
      assert.ok(!canonical(snapshot.shared).includes('nativeCheckpoint'));
      assert.ok(!canonical(snapshot.personal).includes('resumeToken'));
      for (const event of snapshot.events)
        if (Object.hasOwn(event, 'scope')) assert.ok(event.scope === 'shared' || event.scope === snapshot.seat);
      assert.ok(snapshot.shared.pokemon.every(entry => !Object.hasOwn(entry, 'moveset') && !Object.hasOwn(entry, 'ivs')));
    }

    state = await reachPreparation(env, room, state);
    assert.equal(state.sa.personal.decision.kind, 'preparation');
    assert.notDeepEqual(
      state.sa.personal.party.map(entry => entry.id),
      state.sb.personal.party.map(entry => entry.id),
    );
    assert.ok(state.sa.events.some(event => event.scope === 0));
    assert.ok(!state.sa.events.some(event => event.scope === 1));
    assert.ok(state.sb.events.some(event => event.scope === 1));
    assert.ok(!state.sb.events.some(event => event.scope === 0));

    const firstField = state.sa.shared.field.slice(0, 2);
    state = await finishPreparation(env, room, state);
    state = await finishSwitches(env, room, state);
    assert.equal(state.sa.personal.decision.kind, 'wait-actions');
    assert.equal(state.sa.shared.waveIndex, 2);
    assert.notDeepEqual(state.sa.shared.field.slice(0, 2), firstField);
    for (const seat of [0, 1]) {
      const snapshot = seat === 0 ? state.sa : state.sb;
      assert.ok(snapshot.personal.party.some(entry => entry.id === snapshot.shared.field[seat]));
      assert.ok(snapshot.personal.decision.options.every(option => option.pokemonId === snapshot.shared.field[seat]));
    }

    const secondRevision = state.sa.revision;
    const secondActions = [fightAction(state.sa), fightAction(state.sb)];
    await submit(room.a, state.sa, secondActions[0]);
    await submit(room.b, state.sb, secondActions[1]);
    const [afterA, afterB] = await Promise.all([
      room.a.waitRevisionAfter(secondRevision), room.b.waitRevisionAfter(secondRevision),
    ]);
    for (const snapshot of [afterA, afterB]) {
      assert.ok(snapshot.revision > secondRevision);
      assert.equal(snapshot.shared.waveIndex, 2);
      assert.ok(snapshot.events.some(event => event.kind === 'phase-start' && event.phase === 'CommandPhase'));
    }
    assert.equal(afterA.revision, afterB.revision);
    assert.equal(afterA.sharedHash, afterB.sharedHash);
    await Promise.all([applyAndAck(env, room.a, afterA), applyAndAck(env, room.b, afterB)]);
    assert.deepEqual(room.a.messages.filter(message => message.type === 'error'), []);
    assert.deepEqual(room.b.messages.filter(message => message.type === 'error'), []);
    state = { sa: afterA, sb: afterB };

    const record = env.service.rooms.get(room.roomId);
    const measurement = await env.adapter.measureProjection(room.runId, 0);
    const memory = process.memoryUsage();
    console.log('VS-01 measurement', JSON.stringify({
      checkpointBytes: Buffer.byteLength(JSON.stringify(record.checkpoint)),
      snapshotSharedBytes: Buffer.byteLength(canonical(state.sa.shared)),
      snapshotPersonalBytes: Buffer.byteLength(canonical(state.sa.personal)),
      snapshotEventsBytes: Buffer.byteLength(canonical(state.sa.events)),
      warmProjectionRpcMs: measurement.rpcMs,
      processRss: memory.rss,
      processHeapUsed: memory.heapUsed,
      revision: record.revision,
    }));
    assert.ok(measurement.rpcMs >= 0);
    assert.ok(Buffer.byteLength(JSON.stringify(record.checkpoint)) > 1000);
  } finally {
    await env.close();
  }
});

test('a corrupted applied model cannot ACK or advance the room', { timeout: 60000 }, async () => {
  const env = await startEnv();
  try {
    const room = await createRoom(env);
    room.a.epoch = room.sa.connectionEpoch;
    const model = createOriginalClientModel(original);
    const sent = [];
    const corrupting = createSnapshotConsumer({
      versions: env.service.versions,
      isCurrent: () => true,
      send: message => sent.push(message),
      adapter: {
        applySnapshot(snapshot) {
          model.applySnapshot(snapshot);
          model.tamper(applied => { applied.personal.party[0].pokemon.hp = 0; });
        },
        captureAppliedState: () => model.captureAppliedState(),
        applyGrantsTransaction() {},
      },
    });
    await assert.rejects(corrupting(room.sa), /MODEL_MISMATCH/);
    assert.deepEqual(sent.map(message => message.type), ['requestSnapshot']);
    assert.equal(env.service.rooms.get(room.roomId).revision, 0);
    await applyAndAck(env, room.b, room.sb);
    await room.b.wait(message => message.type === 'syncStatus' && message.acked[1] === true);
    assert.equal(env.service.rooms.get(room.roomId).revision, 0);
  } finally {
    await env.close();
  }
});

test('the same actionId reuses its receipt and a changed fingerprint is rejected', { timeout: 60000 }, async () => {
  const env = await startEnv();
  try {
    const room = await createRoom(env);
    await syncBoth(env, room.a, room.b, room.sa, room.sb);
    const action = fightAction(room.sa);
    const message = {
      type: 'submitAction', roomId: room.sa.roomId, runId: room.sa.runId,
      decisionId: room.sa.decisionId, expectedRevision: room.sa.revision, actionId: 'dup-action-1', action,
    };
    room.a.send(message);
    const first = await room.a.wait(item => item.type === 'actionReceipt' && item.actionId === 'dup-action-1');
    room.a.send(message);
    const second = await room.a.next(item => item.type === 'actionReceipt' && item.actionId === 'dup-action-1');
    assert.deepEqual(second, first);
    assert.equal(env.service.rooms.get(room.roomId).revision, 0);

    room.a.send({ ...message, action: { ...action, target: 99 } });
    const conflict = await room.a.next(item => item.type === 'error');
    assert.equal(conflict.code, 'ACTION_ID_CONFLICT');

    await submit(room.b, room.sb, fightAction(room.sb));
    const record = env.service.rooms.get(room.roomId);
    assert.ok(record.inputs[0] && record.inputs[1]);
    assert.ok(record.revision === 0 || record.revision === 1);
  } finally {
    await env.close();
  }
});

test('adapter candidate retries are deterministic and invalid actions do not mutate', { timeout: 60000 }, async () => {
  const adapter = createOriginalCoopAdapter();
  const runId = 'vs01-retry-' + Date.now();
  try {
    const context = await adapter.createInitialContext({ runId });
    const before = canonical(await adapter.captureCheckpoint(context));
    assert.ok((await adapter.captureCheckpoint(context)).intents.length > 0);
    const viewA = await adapter.projectSnapshot(context, 0);
    const viewB = await adapter.projectSnapshot(context, 1);
    const a0 = viewA.personal.decision.options.find(option => Number.isInteger(option.target) && option.target >= 2);
    const b0 = viewB.personal.decision.options.find(option => Number.isInteger(option.target) && option.target >= 2);
    await adapter.validateAction(context, 0, a0);
    await adapter.validateAction(context, 1, b0);
    assert.equal(canonical(await adapter.captureCheckpoint(context)), before);

    const first = await adapter.advanceToDecision(context, { 0: a0, 1: b0 });
    const second = await adapter.advanceToDecision(context, { 0: a0, 1: b0 });
    assert.deepEqual(canonical(await adapter.captureCheckpoint(first.context)), canonical(await adapter.captureCheckpoint(second.context)));
    assert.deepEqual(canonical(first.events), canonical(second.events));
    assert.equal(canonical(await adapter.captureCheckpoint(context)), before);

    await assert.rejects(adapter.validateAction(context, 0, { ...a0, cursor: 9999 }), /INVALID_ACTION/);
    assert.equal(canonical(await adapter.captureCheckpoint(context)), before);

    const checkpoint = await adapter.captureCheckpoint(first.context);
    const stored = JSON.parse(JSON.stringify(checkpoint));
    await adapter.validateCheckpoint(stored);
    const restored = await adapter.restoreCheckpoint(stored);
    assert.deepEqual(canonical(await adapter.captureCheckpoint(restored)), canonical(checkpoint));
  } finally {
    await adapter.closeAll();
  }
});

test('one failed room worker does not stop another room', { timeout: 120000 }, async () => {
  const env = await startEnv();
  try {
    const one = await createRoom(env);
    const two = await createRoom(env);
    await syncBoth(env, one.a, one.b, one.sa, one.sb);
    await syncBoth(env, two.a, two.b, two.sa, two.sb);

    await env.adapter.failRoom(one.runId);
    one.a.send({
      type: 'requestSnapshot', roomId: one.sa.roomId, runId: one.sa.runId,
      knownRevision: one.sa.revision, reason: 'worker-failure-check',
    });
    const failure = await one.a.next(message => message.type === 'error');
    assert.ok(['ROOM_WORKER_FAILED', 'ADAPTER_FAILED'].includes(failure.code), JSON.stringify(failure));

    const freshA = two.a.next(message => message.type === 'snapshot' && message.runId === two.runId);
    const freshB = two.b.next(message => message.type === 'snapshot' && message.runId === two.runId);
    two.a.send({
      type: 'requestSnapshot', roomId: two.sa.roomId, runId: two.sa.runId,
      knownRevision: two.sa.revision, reason: 'other-room-still-alive',
    });
    const [sa, sb] = await Promise.all([freshA, freshB]);
    assert.equal(sa.sharedHash, two.sa.sharedHash);
    assert.equal(sa.sharedHash, sb.sharedHash);
    assert.equal(sa.revision, 0);
    assert.ok(sa.personal.party.length > 0);
    const state = await syncBoth(env, two.a, two.b, sa, sb);
    const next = await submitBoth(env, two, state.sa, state.sb, [fightAction(sa), fightAction(sb)]);
    assert.ok(next.sa.revision > sa.revision);
    assert.equal(next.sa.sharedHash, next.sb.sharedHash);
  } finally {
    await env.close();
  }
});

test('a ready player can unready through the real formal preparation boundary', { timeout: 60000 }, async () => {
  const env = await startEnv();
  try {
    const room = await createRoom(env);
    let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
    state = await reachPreparation(env, room, state);
    const partner = structuredClone(state.sb.personal);
    state = await submitOne(env, room, room.a, state.sa, { kind: 'preparation', operation: 'skip-reward' });
    state = await submitOne(env, room, room.a, state.sa, { kind: 'preparation', operation: 'ready' });
    assert.equal(state.sa.personal.decision.players.ready, true);
    state = await submitOne(env, room, room.a, state.sa, { kind: 'preparation', operation: 'unready' });
    assert.equal(state.sa.personal.decision.kind, 'preparation');
    assert.equal(state.sa.personal.decision.players.ready, false);
    assert.deepEqual(state.sb.personal.resources, partner.resources);
    assert.deepEqual(state.sb.personal.party, partner.party);
    assert.deepEqual(state.sb.personal.decision.players, partner.decision.players);
    state = await submitOne(env, room, room.a, state.sa, { kind: 'preparation', operation: 'ready' });
    assert.equal(state.sa.personal.decision.players.ready, true);
    assert.equal(state.sa.personal.decision.kind, 'preparation');
  } finally {
    await env.close();
  }
});

test('the original client rejects permanent grants instead of falsely acknowledging them', { timeout: 60000 }, async () => {
  const env = await startEnv();
  try {
    const room = await createRoom(env);
    const snapshot = structuredClone(room.sa);
    // Protocol failure injection only: the actual VS-01 rule adapter grants [].
    snapshot.grants = [{ id: 'unsupported-permanent-grant', seat: snapshot.seat, payload: { count: 1 } }];
    const before = canonical(snapshot), sent = [];
    const model = createOriginalClientModel(original);
    const consume = createSnapshotConsumer({
      versions: env.service.versions, adapter: model,
      isCurrent: epoch => epoch === snapshot.connectionEpoch,
      send: message => sent.push(message),
    });
    await assert.rejects(consume(snapshot), /PERMANENT_GRANTS_UNAVAILABLE/);
    assert.deepEqual(sent.map(message => message.type), ['requestSnapshot']);
    assert.equal(sent[0].reason, 'CLIENT_APPLY_FAILED');
    assert.equal(canonical(snapshot), before);
    assert.equal(env.service.rooms.get(room.roomId).revision, 0);
  } finally {
    await env.close();
  }
});

test('terminal adapter descriptions do not request another automatic rule transition', async () => {
  const adapter = createOriginalCoopAdapter();
  // Description policy only, not a fabricated end-of-battle execution.
  const description = await adapter.describeDecision({ checkpoint: {
    decision: { id: 'terminal-description', kind: 'ended', requiredSeats: [], victory: true, reason: 'victory' },
  } });
  assert.deepEqual(description, { id: 'terminal-description', requiredSeats: [], collection: 'all' });
});


const lobbyFixture = { seed: 'vs02-lobby-fixture', lobby: true,
  identities: [{ trainerId: 1, secretId: 2 }, { trainerId: 3, secretId: 4 }] };
async function enterLobbyBattle(env) {
  const room = await createRoom(env);
  let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
  for (const seat of [0, 1]) state = await submitOne(env, room, seat === 0 ? room.a : room.b,
    seat === 0 ? state.sa : state.sb, { kind: 'starter-ready',
      starters: seat === 0 ? [1, 4, 7] : [25, 133, 152], eggs: [], ready: true });
  assert.equal(state.sa.personal.decision.kind, 'wait-actions');
  return { room, state };
}
async function temporaryStore() {
  // Verify the generated directory before recursive test cleanup on Windows.
  const root = resolve('build');
  const directory = await mkdtemp(join(root, 'vs02-disk-'));
  assert.ok(resolve(directory).startsWith(root + sep));
  return { directory, store: new FormalRoomStore(directory),
    cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('VS-02 real disk restart retains one FIGHT input and receipt, then settles exactly once', { timeout: 120000 }, async () => {
  const disk = await temporaryStore();
  let env;
  const reference = createOriginalCoopAdapter({ fixture: lobbyFixture });
  try {
    env = await startEnv({ store: disk.store, fixture: lobbyFixture });
    const { room, state } = await enterLobbyBattle(env);
    const tokens = [room.a, room.b].map(c => c.messages.find(m => m.type === 'welcome' && m.roomId).resumeToken);
    const envelope = { type: 'submitAction', roomId: room.roomId, runId: room.runId,
      decisionId: state.sa.decisionId, expectedRevision: state.sa.revision,
      actionId: 'vs02-persist-before-restart', action: fightAction(state.sa) };
    room.a.send(envelope);
    const receipt = await room.a.wait(m => m.type === 'actionReceipt' && m.actionId === envelope.actionId);
    assert.equal(receipt.accepted, true);
    await env.close(); env = null;
    const saved = (await disk.store.load())[0];
    assert.deepEqual(saved.inputs, { 0: envelope.action });
    assert.deepEqual(saved.receipts['0:' + envelope.actionId].reply, receipt);
    const referenceContext = await reference.restoreCheckpoint(saved.checkpoint);
    const expected = await reference.advanceToDecision(referenceContext,
      { 0: envelope.action, 1: fightAction(state.sb) });
    const expectedCheckpoint = await reference.captureCheckpoint(expected.context);

    // A different configured seed cannot replace the persisted seed on resume.
    env = await startEnv({ store: new FormalRoomStore(disk.directory),
      fixture: { ...lobbyFixture, seed: 'must-not-reseed-saved-room' } });
    const a = await connect(env, 'restart-A'), b = await connect(env, 'restart-B');
    for (const [seat, client] of [a, b].entries()) {
      client.send({ type: 'resumeSeat', roomId: room.roomId, resumeToken: tokens[seat] });
      const welcome = await client.wait(m => m.type === 'welcome' && m.roomId);
      assert.equal(welcome.seat, seat);
      await client.wait(m => m.type === 'snapshot');
    }
    const sa = a.latestSnapshot(), sb = b.latestSnapshot();
    assert.notEqual(sa.connectionEpoch, state.sa.connectionEpoch);
    assert.equal(sa.revision, state.sa.revision);
    assert.equal(sa.sharedHash, state.sa.sharedHash);
    assert.equal(sa.personalHash, state.sa.personalHash);
    a.send(envelope);
    assert.deepEqual(await a.wait(m => m.type === 'actionReceipt' && m.actionId === envelope.actionId), receipt);
    await syncBoth(env, a, b, sa, sb);
    const next = await submitOne(env, { a, b }, b, sb, fightAction(sb));
    assert.equal(next.sa.revision, saved.revision + 1);
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint), canonical(expectedCheckpoint));
    const again = a.next(m => m.type === 'actionReceipt' && m.actionId === envelope.actionId);
    a.send(envelope); assert.deepEqual(await again, receipt);
    // An ordered snapshot request is a barrier after duplicate processing.
    const fresh = a.next(m => m.type === 'snapshot');
    a.send({ type: 'requestSnapshot', roomId: room.roomId, runId: room.runId,
      knownRevision: next.sa.revision, reason: 'verify-no-second-settlement' });
    assert.equal((await fresh).revision, saved.revision + 1);
    const committed = (await disk.store.load())[0];
    assert.equal(committed.revision, saved.revision + 1);
    assert.equal(canonical(committed.checkpoint), canonical(expectedCheckpoint));
    assert.deepEqual(committed.inputs, {});
  } finally {
    if (env) await env.close();
    await reference.closeAll(); await disk.cleanup();
  }
});

test('VS-02 candidate disk failure keeps old checkpoint and both durable inputs without publishing', { timeout: 120000 }, async () => {
  const disk = await temporaryStore(); let env;
  try {
    let rejectRevision = null;
    const store = { load: () => disk.store.load(), save: room => {
      if (room.revision === rejectRevision) throw new Error('injected candidate disk failure');
      return disk.store.save(room);
    } };
    env = await startEnv({ store, fixture: lobbyFixture });
    const { room, state } = await enterLobbyBattle(env);
    const before = canonical(env.service.rooms.get(room.roomId).checkpoint);
    rejectRevision = state.sa.revision + 1;
    await submit(room.a, state.sa, fightAction(state.sa));
    const failure = room.b.next(m => m.type === 'error');
    await submit(room.b, state.sb, fightAction(state.sb));
    assert.equal((await failure).code, 'STORAGE_FAILED');
    const saved = (await disk.store.load())[0];
    assert.equal(saved.revision, state.sa.revision);
    assert.equal(canonical(saved.checkpoint), before);
    assert.deepEqual(Object.keys(saved.inputs), ['0', '1']);
    assert.equal(room.a.latestSnapshot().revision, state.sa.revision);
    assert.equal(room.b.latestSnapshot().revision, state.sb.revision);
    assert.equal(env.service.rooms.get(room.roomId).revision, state.sa.revision);
  } finally { if (env) await env.close(); await disk.cleanup(); }
});


test('VS-02 corrupted envelope version or run ownership is rejected without rewriting disk', { timeout: 60000 }, async () => {
  const disk = await temporaryStore(); let env;
  try {
    env = await startEnv({ store: disk.store, fixture: lobbyFixture });
    const room = await createRoom(env);
    const token = room.a.messages.find(m => m.type === 'welcome' && m.roomId).resumeToken;
    await env.close(); env = null;
    const saved = (await disk.store.load())[0];
    for (const [mutate, code] of [
      [c => { c.checkpoint.formatVersion = 1; }, 'INVALID_CHECKPOINT'],
      [c => { c.checkpoint.runId = 'another-run'; }, 'RUN_MISMATCH'],
    ]) {
      const corrupt = structuredClone(saved); mutate(corrupt);
      await disk.store.save(corrupt);
      const file = join(disk.directory, saved.roomId + '.json');
      const before = await readFile(file, 'utf8');
      env = await startEnv({ store: new FormalRoomStore(disk.directory), fixture: lobbyFixture });
      const client = await connect(env, 'corrupt-resume');
      client.send({ type: 'resumeSeat', roomId: room.roomId, resumeToken: token });
      assert.equal((await client.wait(m => m.type === 'error')).code, code);
      assert.equal(client.snapshots.length, 0);
      await env.close(); env = null;
      assert.equal(await readFile(file, 'utf8'), before);
    }
  } finally { if (env) await env.close(); await disk.cleanup(); }
});
