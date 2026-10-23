import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { attachFormalCoopServer, FormalRoomStore } from '../server/formal-coop-service.mjs';
import { createOriginalCoopAdapter } from '../server/original-coop-adapter.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { canonical, ContractError } from '../src/battle-core/coop-contract.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';
import { createOriginalClientModel } from '../src/coop/original-client-model.mjs';

let original;
const seed = 'vs01-ws-original';
const fixture = { profileLobby: true, seed, identities: [{ trainerId: 11, secretId: 22 }, { trainerId: 33, secretId: 44 }] };
before(async () => {
  await buildCoopRuntime();
  original = createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
  original.describeOriginalCatalogs();
});

class MemoryStore {
  async load() { return []; }
  async save(room) { this.room = JSON.parse(JSON.stringify(room)); }
}

test('closing one actual WS preserves the partner and disk room while a new room stays isolated after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vs02b14-exit-'));
  let env = await startEnv(new FormalRoomStore(directory));
  try {
    const room = await createRoom(env);
    const state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
    const result = await submit(room.a, state.sa, { kind: 'profile-ready', profile: profile0(), ready: true });
    assert.equal(result.receipt.accepted, true);
    await after(room.b, state.sb);
    const before = (await env.store.load()).find(r => r.roomId === room.roomId);
    const disconnected = room.b.next(m => m.type === 'syncStatus' && m.reason === 'DISCONNECTED');
    room.a.close();
    assert.equal((await disconnected).blocked, true);
    const fresh = await hello(env, 'new-session');
    fresh.send({ type: 'createRoom', name: 'new-session' });
    const welcome = await fresh.wait(m => m.type === 'welcome' && m.roomId);
    assert.notEqual(welcome.roomId, room.roomId);
    const rooms = await env.store.load();
    const preserved = rooms.find(r => r.roomId === room.roomId);
    assert.equal(canonical(preserved.checkpoint), canonical(before.checkpoint));
    assert.equal(canonical(preserved.receipts), canonical(before.receipts));
    assert.equal(preserved.revision, before.revision);
    assert.equal(rooms.length, 2);
    await env.close(); env = await startEnv(new FormalRoomStore(directory));
    const partner = await resume(env, room.b, room.b.resumeToken);
    assert.equal(partner.latestSnapshot().roomId, room.roomId);
    assert.equal(partner.latestSnapshot().revision, before.revision);
    assert.deepEqual(partner.latestSnapshot().shared.ready, [true, false]);
    const recovered = await env.store.load();
    assert.equal(recovered.length, 2);
    assert.ok(recovered.some(r => r.roomId === welcome.roomId));
  } finally { await env.close(); await rm(directory, { recursive: true, force: true }); }
});
class Client {
  constructor(ws) {
    this.ws = ws; this.messages = []; this.snapshots = []; this.waiters = [];
    this.epoch = null; this.roomId = null; this.seat = null; this.resumeToken = null;
    this.model = createOriginalClientModel(original);
    ws.on('message', data => {
      const message = JSON.parse(data.toString()); this.messages.push(message);
      if (message.type === 'snapshot') this.snapshots.push(message);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message);
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
      waiter.timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error('WS_WAIT_TIMEOUT')); }, timeout);
      this.waiters.push(waiter);
    });
  }
  latestSnapshot() { return this.snapshots.at(-1); }
  async waitRevisionAfter(revision) {
    const latest = this.latestSnapshot();
    if (latest && latest.revision > revision) return latest;
    await this.next(message => message.type === 'snapshot' && message.revision > revision);
    return this.latestSnapshot();
  }
  close() { try { this.ws.close(); } catch {} }
}
class Env {
  constructor(httpServer, adapter, store, service, url) { Object.assign(this, { httpServer, adapter, store, service, url }); this.clients = []; }
  async close() {
    for (const client of this.clients) client.close();
    await this.service.close();
    await new Promise(resolve => this.httpServer.close(resolve));
    await this.adapter.closeAll();
  }
}
async function startEnv(store = new MemoryStore()) {
  const httpServer = http.createServer((request, response) => { response.writeHead(404); response.end('not found'); });
  const adapter = createOriginalCoopAdapter({ fixture });
  const service = await attachFormalCoopServer(httpServer, { adapter, store, heartbeatMs: 60000 });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  return new Env(httpServer, adapter, store, service, `ws://127.0.0.1:${httpServer.address().port}/coop/v1/ws`);
}
async function hello(env, name) {
  const client = await Client.open(env.url); env.clients.push(client); client.name = name;
  client.send({ type: 'hello', ...env.service.versions });
  await client.wait(message => message.type === 'welcome');
  return client;
}
async function connect(env, name) { return hello(env, name); }
async function createRoom(env) {
  const a = await connect(env, 'A');
  a.send({ type: 'createRoom', name: 'A' });
  const welcomeA = await a.wait(message => message.type === 'welcome' && message.roomId);
  a.roomId = welcomeA.roomId; a.seat = welcomeA.seat; a.resumeToken = welcomeA.resumeToken;
  await a.wait(message => message.type === 'snapshot' && message.roomId === welcomeA.roomId);
  const b = await connect(env, 'B');
  b.send({ type: 'joinRoom', roomId: welcomeA.roomId, name: 'B' });
  const welcomeB = await b.wait(message => message.type === 'welcome' && message.roomId);
  b.roomId = welcomeB.roomId; b.seat = welcomeB.seat; b.resumeToken = welcomeB.resumeToken;
  await b.wait(message => message.type === 'snapshot' && message.roomId === welcomeB.roomId);
  const sa = a.latestSnapshot(), sb = b.latestSnapshot();
  return { a, b, roomId: welcomeA.roomId, runId: sa.runId, sa, sb };
}
async function resume(env, old, token) {
  const client = await hello(env, old.name);
  client.send({ type: 'resumeSeat', roomId: old.roomId, resumeToken: token });
  const welcome = await client.wait(message => message.type === 'welcome' && message.roomId === old.roomId);
  client.roomId = welcome.roomId; client.seat = welcome.seat; client.resumeToken = welcome.resumeToken;
  await client.wait(message => message.type === 'snapshot' && message.roomId === welcome.roomId);
  return client;
}
const applyAndAck = async (env, client, snapshot) => {
  if (client.epoch !== snapshot.connectionEpoch && client.consumer) client.consumer = null;
  client.epoch = snapshot.connectionEpoch;
  if (!client.consumer) client.consumer = createSnapshotConsumer({ versions: env.service.versions,
    adapter: client.model, isCurrent: epoch => epoch === client.epoch, send: message => client.send(message) });
  assert.equal(await client.consumer(snapshot), true);
};
const requiresInput = snapshot => ['lobby', 'wait-actions', 'preparation', 'switch-confirm', 'switch-select']
  .includes(snapshot.personal.decision.kind) && snapshot.personal.decision.requiredSeats.length > 0;
async function syncBoth(env, a, b, sa, sb) {
  let snapA = sa, snapB = sb;
  for (let budget = 0; budget < 80; budget++) {
    await Promise.all([applyAndAck(env, a, snapA), applyAndAck(env, b, snapB)]);
    if (requiresInput(snapA)) {
      await Promise.all([a, b].map(client => client.wait(message => message.type === 'syncStatus'
        && message.revision === snapA.revision && !message.blocked)));
      return { sa: snapA, sb: snapB };
    }
    const revision = snapA.revision;
    [snapA, snapB] = await Promise.all([a.waitRevisionAfter(revision), b.waitRevisionAfter(revision)]);
  }
  throw new Error('SYNC_BUDGET_EXCEEDED');
}
let counter = 0;
async function submit(client, snapshot, action, actionId = `${client.name}-${snapshot.revision}-${++counter}`) {
  const message = { type: 'submitAction', roomId: snapshot.roomId, runId: snapshot.runId,
    decisionId: snapshot.decisionId, expectedRevision: snapshot.revision, actionId, action };
  client.send(message);
  const receipt = await client.wait(item => item.type === 'actionReceipt' && item.actionId === actionId);
  return { receipt, message };
}
async function accept(client, snapshot, action) {
  const { receipt } = await submit(client, snapshot, action);
  assert.equal(receipt.accepted, true, JSON.stringify(receipt));
  return receipt;
}
async function after(client, snapshot) { return client.waitRevisionAfter(snapshot.revision); }
function fightAction(snapshot) {
  const option = snapshot.personal.decision.options.find(entry => entry.kind === 'fight'
    && Number.isInteger(entry.target) && entry.target >= 2);
  assert.ok(option, 'real FIGHT option'); return option;
}
function profile(ids, counts, trainer, eggs = []) {
  const dexData = {}, starterEggMoveData = {};
  for (const id of ids) {
    const value = counts[id] ?? {};
    dexData[id] = { ivs: [31, 30, 29, 28, 27, 26], caughtAttr: 149n, natureAttr: 2,
      caughtCount: value.caught ?? 0, hatchedCount: value.hatched ?? 0 };
    starterEggMoveData[original.getPokemonSpecies(id).getRootSpeciesId()] = 0;
  }
  return original.captureProfile({ trainerId: trainer.trainerId, secretId: trainer.secretId, dexData,
    starterEggMoveData, eggs }, ids.map(id => ({ species: original.getPokemonSpecies(id), dexAttr: 149n,
    nature: 0, pokerus: false })));
}
const profile0 = () => profile([1, 4, 7], { 1: {}, 4: {}, 7: {} }, fixture.identities[0],
  [new original.Egg(28123456, 0, 3, 1000)]);
const profile1 = () => profile([1, 4, 7], { 1: {}, 4: {}, 7: {} }, fixture.identities[1]);

test('two real WS clients import original profiles, respect 14/10 budgets and reach a first real FIGHT', async () => {
  const env = await startEnv();
  try {
    const room = await createRoom(env);
    let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
    assert.equal(state.sa.personal.decision.kind, 'lobby');
    assert.equal(state.sa.shared.budget.shared, 14);
    assert.equal(state.sa.shared.budget.used, 0);
    assert.equal(state.sa.personal.profile, null);
    assert.equal(state.sa.personal.eggs, null);

    // Personal cap rejects before buffering.
    const expensive = profile([1, 4, 7, 10, 13, 16], {}, fixture.identities[0]);
    const rejected = await submit(room.a, state.sa, { kind: 'profile-ready', profile: expensive, ready: true });
    assert.equal(rejected.receipt.accepted, false);
    assert.equal(rejected.receipt.code, 'PERSONAL_BUDGET_EXCEEDED');
    assert.equal(room.a.latestSnapshot().revision, state.sa.revision);

    await accept(room.a, state.sa, { kind: 'profile-ready', profile: profile0(), ready: true });
    let [sa, sb] = await Promise.all([after(room.a, state.sa), after(room.b, state.sb)]);
    state = await syncBoth(env, room.a, room.b, sa, sb);
    assert.deepEqual(state.sa.shared.ready, [true, false]);
    assert.equal(state.sa.shared.budget.used, 9);
    assert.equal(state.sa.personal.profile.trainer.trainerId, 11);
    assert.deepEqual(state.sa.personal.eggs.map(egg => egg.id), [28123456]);

    // Combined 18 > 14 rejects the second ready without dropping the first.
    const rejectedShared = await submit(room.b, state.sb, { kind: 'profile-ready', profile: profile1(), ready: true });
    assert.equal(rejectedShared.receipt.accepted, false);
    assert.equal(rejectedShared.receipt.code, 'SHARED_BUDGET_EXCEEDED');
    assert.equal(room.b.latestSnapshot().revision, state.sb.revision);

    const cheap = profile([1, 4], { 1: { caught: 100 }, 4: {} }, fixture.identities[1]);
    await accept(room.b, state.sb, { kind: 'profile-ready', profile: cheap, ready: true });
    [sa, sb] = await Promise.all([after(room.a, state.sa), after(room.b, state.sb)]);
    state = await syncBoth(env, room.a, room.b, sa, sb);
    assert.equal(state.sa.personal.decision.kind, 'wait-actions');
    assert.equal(state.sa.shared.stage, 'battle');
    assert.deepEqual(state.sa.personal.party.map(entry => entry.pokemon.fields.species), [1, 4, 7]);
    assert.deepEqual(state.sb.personal.party.map(entry => entry.pokemon.fields.species), [1, 4]);

    const revision = state.sa.revision;
    await accept(room.a, state.sa, fightAction(state.sa));
    await accept(room.b, state.sb, fightAction(state.sb));
    const [nextA, nextB] = await Promise.all([after(room.a, state.sa), after(room.b, state.sb)]);
    assert.ok(nextA.revision > revision);
    assert.equal(nextA.sharedHash, nextB.sharedHash);
    assert.equal(env.store.room.checkpoint.formatVersion, 3);
    assert.equal('profile' in nextA.shared, false);
  } finally { await env.close(); }
});

test('same numeric identity and one-versus-six parties are accepted for each seat', async () => {
  const adapter = createOriginalCoopAdapter({ fixture: { profileLobby: true, seed: 'vs01-ws-original',
    identities: [{ trainerId: 11, secretId: 22 }, { trainerId: 11, secretId: 22 }] } });
  try {
    const shared = { trainerId: 777, secretId: 888 };
    const one = profile([25], { 25: {} }, shared);
    const six = profile([1, 4, 7, 10, 13, 16],
      Object.fromEntries([1, 4, 7, 10, 13, 16].map(id => [id, { caught: 100 }])), shared);
    let context = await adapter.createInitialContext({ runId: 'same-id-variable-party' });
    for (const [seat, value] of [[0, one], [1, six]]) {
      const action = { kind: 'profile-ready', profile: value, ready: true };
      await adapter.validateAction(context, seat, action);
      context = (await adapter.advanceToDecision(context, { [seat]: action })).context;
    }
    assert.equal(context.checkpoint.decision.kind, 'wait-actions');
    const view0 = await adapter.projectSnapshot(context, 0);
    const view1 = await adapter.projectSnapshot(context, 1);
    assert.equal(view0.personal.party.length, 1);
    assert.equal(view1.personal.party.length, 6);
    const checkpoint = await adapter.captureCheckpoint(context);
    await adapter.validateCheckpoint(JSON.parse(JSON.stringify(checkpoint)));
    assert.equal(checkpoint.formatVersion, 3);
    for (const mutate of [c => { c.stage = 'preparation'; }, c => { c.provisioning.seed = 'wrong-seed'; }]) {
      const corrupt = structuredClone(checkpoint); mutate(corrupt);
      await assert.rejects(adapter.restoreCheckpoint(corrupt), /INVALID_CHECKPOINT/);
    }
  } finally { await adapter.closeAll(); }
});

test('ready selection is locked until unready; real failed entry can restore and retry different identities', async () => {
  let failEntry = true;
  const adapter = createOriginalCoopAdapter({ fixture, hostFactory: async options => {
    const host = await createOriginalRuleHost(options);
    return { ...host, async request(operation, payload) {
      const result = await host.request(operation, payload);
      if (operation === 'native-open-selected-to-input' && failEntry) {
        failEntry = false;
        throw new ContractError('TEST_ENTRY_FAILED');
      }
      return result;
    } };
  } });
  try {
    let context = await adapter.createInitialContext({ runId: 'profile-failed-candidate' });
    const a = profile([1], {}, { trainerId: 101, secretId: 202 });
    const b = profile([4], {}, { trainerId: 303, secretId: 404 });
    context = (await adapter.advanceToDecision(context, { 0: { kind: 'profile-ready', profile: a, ready: true } })).context;
    const changed = profile([7], {}, a.trainer);
    await assert.rejects(adapter.validateAction(context, 0, { kind: 'profile-ready', profile: changed, ready: true }),
      /PROFILE_READY_SELECTION_LOCKED/);
    await adapter.validateAction(context, 0, { kind: 'profile-ready', profile: changed, ready: false });
    const before = await adapter.captureCheckpoint(context);
    const action = { kind: 'profile-ready', profile: b, ready: true };
    await assert.rejects(adapter.advanceToDecision(context, { 1: action }), /TEST_ENTRY_FAILED/);
    assert.equal(canonical(await adapter.captureCheckpoint(context)), canonical(before));
    context = await adapter.restoreCheckpoint(JSON.parse(JSON.stringify(before)));
    assert.deepEqual((await adapter.projectSnapshot(context, 0)).shared.ready, [true, false]);
    const result = await adapter.advanceToDecision(context, { 1: action });
    const checkpoint = await adapter.captureCheckpoint(result.context);
    assert.equal(checkpoint.formatVersion, 3);
    assert.deepEqual(checkpoint.provisioning.identities, [a.trainer, b.trainer]);
    assert.equal(checkpoint.nativeCheckpoint.decision.kind, 'wait-actions');
  } finally { await adapter.closeAll(); }
});

test('profile battle commit failure preserves disk lobby and retries once after a real server restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vs02b03-failure-'));
  class FailingStore extends FormalRoomStore {
    failBattle = true;
    async save(room) {
      if (this.failBattle && room.checkpoint.nativeCheckpoint) {
        this.failBattle = false;
        throw new Error('TEST_DISK_FAILURE');
      }
      return super.save(room);
    }
  }
  const store = new FailingStore(directory);
  let env = await startEnv(store);
  try {
    const room = await createRoom(env);
    let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
    const a = profile([1], {}, { trainerId: 101, secretId: 202 });
    const b = profile([4], {}, { trainerId: 303, secretId: 404 });
    await accept(room.a, state.sa, { kind: 'profile-ready', profile: a, ready: true });
    const [sa, sb] = await Promise.all([after(room.a, state.sa), after(room.b, state.sb)]);
    state = await syncBoth(env, room.a, room.b, sa, sb);
    const sent = await submit(room.b, state.sb, { kind: 'profile-ready', profile: b, ready: true });
    assert.equal(sent.receipt.accepted, true);
    await room.b.wait(message => message.type === 'error' && message.code === 'STORAGE_FAILED');
    const [persisted] = await store.load();
    assert.equal(persisted.revision, state.sb.revision);
    assert.equal(persisted.checkpoint.nativeCheckpoint, null);
    assert.equal(persisted.checkpoint.lobby.players[1].profile, null);
    assert.equal(persisted.inputs[1].profile.trainer.trainerId, 303);
    // Project the old committed room with the same live adapter after failure.
    const restored = await env.adapter.restoreCheckpoint(persisted.checkpoint);
    assert.equal((await env.adapter.projectSnapshot(restored, 0)).personal.decision.kind, 'lobby');
    await env.close();
    env = await startEnv(new FormalRoomStore(directory));
    const ra = await resume(env, room.a, room.a.resumeToken);
    const rb = await resume(env, room.b, room.b.resumeToken);
    const next = await syncBoth(env, ra, rb, ra.latestSnapshot(), rb.latestSnapshot());
    // ACK of the persisted pending input opens one battle, no second action.
    const [ba, bb] = next.sa.personal.decision.kind === 'wait-actions' ? [next.sa, next.sb]
      : await Promise.all([after(ra, next.sa), after(rb, next.sb)]);
    assert.equal(ba.revision, persisted.revision + 1);
    assert.equal(bb.personal.decision.kind, 'wait-actions');
    const [battle] = await new FormalRoomStore(directory).load();
    assert.equal(battle.checkpoint.formatVersion, 3);
    assert.deepEqual(battle.checkpoint.provisioning.identities, [a.trainer, b.trainer]);
  } finally {
    await env.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('lobby profile ready and battle survive a disk restart; the old actionId replays without rebuilding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vs02b03-'));
  let env = await startEnv(new FormalRoomStore(directory));
  let room, oldA, oldAction, oldToken, oldRevision;
  try {
    room = await createRoom(env);
    let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
    oldToken = room.a.resumeToken;
    const action = { kind: 'profile-ready', profile: profile0(), ready: true };
    const stored = await submit(room.a, state.sa, action);
    oldAction = stored.message; oldRevision = state.sa.revision;
    assert.equal(stored.receipt.accepted, true);
    oldA = room.a;
    await env.close();

    env = await startEnv(new FormalRoomStore(directory));
    const a = await resume(env, oldA, oldToken);
    const lobbySnapshot = a.latestSnapshot();
    assert.equal(lobbySnapshot.personal.decision.kind, 'lobby');
    assert.deepEqual(lobbySnapshot.shared.ready, [true, false]);
    assert.equal(lobbySnapshot.revision, oldRevision + 1);
    // Same actionId + exact persisted message replays the receipt.
    a.send(oldAction);
    const replay = await a.wait(item => item.type === 'actionReceipt' && item.actionId === oldAction.actionId);
    assert.equal(replay.accepted, true);
    assert.equal(a.latestSnapshot().revision, lobbySnapshot.revision);

    const b = await resume(env, room.b, room.b.resumeToken);
    let next = await syncBoth(env, a, b, a.latestSnapshot(), b.latestSnapshot());
    await accept(b, next.sb, { kind: 'profile-ready', profile: profile([1, 4], { 1: { caught: 100 }, 4: {} },
      fixture.identities[1]), ready: true });
    const [sa, sb] = await Promise.all([after(a, next.sa), after(b, next.sb)]);
    next = await syncBoth(env, a, b, sa, sb);
    assert.equal(next.sa.personal.decision.kind, 'wait-actions');
    const battleRevision = next.sa.revision;
    const battleToken = a.resumeToken; const battleRoom = a.roomId;
    await env.close();

    env = await startEnv(new FormalRoomStore(directory));
    const resumed = await resume(env, { name: 'A', roomId: battleRoom }, battleToken);
    assert.equal(resumed.latestSnapshot().revision, battleRevision);
    assert.equal(resumed.latestSnapshot().personal.decision.kind, 'wait-actions');
    assert.deepEqual(resumed.latestSnapshot().personal.party.map(entry => entry.pokemon.fields.species), [1, 4, 7]);
  } finally {
    try { await env.close(); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
