import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalCoopAdapter } from "./helpers/original-adapter.mjs";
import { FormalRoomStore } from '../server/formal-coop-service.mjs';
import { formalFixture } from './helpers/formal-ws.mjs';
import { defaultTrainerRoute, progressDefault } from './helpers/native-default-trainer.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';
import { createOriginalClientModel } from '../src/coop/original-client-model.mjs';

let api, initial;
const seed = 'learning-natural-2', identities = [{ trainerId: 1, secretId: 2 }, { trainerId: 3, secretId: 4 }];
before(async () => {
  await buildCoopRuntime(); api = createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
  const route = await defaultTrainerRoute();
  try {
    let c = route.initial;
    for (let n = 0; n < 70; n++) {
      c = (await progressDefault(route.h, c)).checkpoint;
      if (c.decision.kind === 'preparation') { initial = c; break; }
    }
    assert.ok(initial, 'natural default collection reaches the first original preparation');
  } finally { await route.h.close(); }
});
async function until(predicate, label) {
  for (let n = 0; n < 2000; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error(`WAIT_TIMEOUT: ${label}`);
}
async function open(store, old = null) {
  const original = createOriginalCoopAdapter({ fixture: { seed, identities, parties: [[909, 7], [906, 7]], eggState: { players: [[], []] } } });
  // Explicit checkpoint injection from the natural route, not browser end-to-end.
  const failures = [];
  const adapter = { ...original, async advanceToDecision(...args) {
    try { return await original.advanceToDecision(...args); }
    catch (error) { failures.push(error.code ?? error.message); throw error; }
  }, createInitialContext: ({ runId }) => original.restoreCheckpoint({
    formatVersion: 2, runId, stage: 'preparation', provisioning: { seed, identities }, lobby: null,
    nativeCheckpoint: structuredClone(initial), intents: [],
  }) };
  const server = await formalFixture(adapter, store), groups = [];
  async function connectPair(old = null, holdSeat = null) {
  const pair = []; groups.push(pair);
  for (const seat of [0, 1]) {
    const client = await server.client(), model = createOriginalClientModel(api);
    const state = { ...client, latest: null, ready: false, errors: [], identity: null, chain: Promise.resolve(), model,
      holdAck: seat === holdSeat, acks: [] };
    let epoch;
    const consumer = createSnapshotConsumer({ versions: server.versions, adapter: model,
      isCurrent: value => value === epoch, send: message => state.holdAck ? state.acks.push(message) : client.send(message) });
    client.socket.on('message', data => {
      const message = JSON.parse(data.toString());
      state.chain = state.chain.then(async () => {
        if (message.type === 'snapshot') {
          epoch = message.connectionEpoch; state.ready = false;
          assert.equal(await consumer(message), true); state.latest = message;
        } else if (message.type === 'syncStatus' && message.revision === state.latest?.revision) state.ready = !message.blocked;
        else if (message.type === 'error') state.errors.push(message.code);
      }).catch(error => state.errors.push(error.message));
    });
    if (old) client.send({ type: 'resumeSeat', roomId: old[seat].roomId, resumeToken: old[seat].resumeToken });
    else client.send(seat === 0 ? { type: 'createRoom', name: 'synthetic-shop-owner' }
      : { type: 'joinRoom', roomId: pair[0].identity.roomId, name: 'synthetic-shop-peer' });
    const welcome = await client.wait(message => message.type === 'welcome' && message.roomId);
    state.identity = welcome; pair.push(state);
  }
  await until(() => pair.every(client => client.latest && (holdSeat !== null || client.ready)), 'both verified models');
  return pair;
  }
  const pair = await connectPair(old);
  return { server, pair, adapter, failures, connectPair,
    async close() { await server.close(); await original.closeAll(); await Promise.all(groups.flat().map(client => client.chain)); } };
}
function request(client, action) {
  const snapshot = client.latest;
  return { type: 'submitAction', roomId: snapshot.roomId, runId: snapshot.runId, decisionId: snapshot.decisionId,
    expectedRevision: snapshot.revision, actionId: crypto.randomUUID(), action };
}
const personalState = value => JSON.stringify({ ...value, decision: { ...value.decision, id: null } });
async function raw(client, action) {
  const message = request(client, action); client.send(message);
  const receipt = await client.wait(reply => reply.type === 'actionReceipt' && reply.actionId === message.actionId);
  assert.equal(receipt.accepted, true, receipt.code); return message;
}
async function advance(pair, seat, action) {
  const revision = pair[seat].latest.revision, message = await raw(pair[seat], action);
  await until(() => pair.every(client => client.latest.revision > revision && client.ready), 'committed next input');
  return message;
}
function buy(snapshot) {
  for (const option of snapshot.personal.decision.players.shop) {
    const type = api.modifierTypes[option.type.catalogId]?.(); if (!type?.selectFilter) continue;
    for (const entry of snapshot.personal.party) {
      const pokemon = api.restorePokemonState(entry.pokemon);
      if (type.selectFilter(pokemon) !== null) continue;
      const moveIndex = type.moveSelectFilter ? pokemon.getMoveset().findIndex(move => type.moveSelectFilter(move) === null) : null;
      if (moveIndex === -1) continue;
      return { kind: 'preparation', operation: 'buy', optionId: option.id, pokemonId: entry.id, moveIndex, fusionId: null };
    }
  }
  assert.fail('natural preparation has an effective affordable original shop target');
}
for (const seat of [0, 1]) for (const operation of ['buy', 'reroll'])
test(`formal original ${operation} seat ${seat}: disk rollback/restart, exact receipt and next FIGHT`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vs17-shop-'));
  class FailingStore extends FormalRoomStore {
    failMoney = false;
    async save(room) {
      if (this.failMoney && room.checkpoint.nativeCheckpoint.players[seat].money !== this.beforeMoney) {
        this.failMoney = false; throw Error('TEST_SHOP_RESULT_DISK_FAILED');
      }
      return super.save(room);
    }
  }
  const store = new FailingStore(directory); let env = await open(store);
  try {
    let { pair } = env;
    const snapshot = pair[seat].latest, beforeMoney = snapshot.personal.resources.money;
    const action = operation === 'buy' ? buy(snapshot) : { kind: 'preparation', operation: 'reroll' };
    const cost = operation === 'buy' ? snapshot.personal.decision.players.shop.find(option => option.id === action.optionId).cost
      : snapshot.personal.decision.players.rerollCost;
    const currentRoom = env.server.rooms.get(snapshot.roomId);
    await env.adapter.validateAction(await env.adapter.restoreCheckpoint(currentRoom.checkpoint), seat, action);
    const oldPeer = personalState(pair[1 - seat].latest.personal);
    store.beforeMoney = beforeMoney; store.failMoney = true;
    const message = await raw(pair[seat], action);
    await until(() => pair.some(client => client.errors.includes('STORAGE_FAILED')), 'failed result write');
    assert.equal(pair[seat].latest.personal.resources.money, beforeMoney);
    const room = (await store.load())[0]; assert.equal(room.inputs[seat].operation, operation);
    assert.equal(room.checkpoint.nativeCheckpoint.players[seat].money, beforeMoney);
    const tokens = pair.map(client => client.identity);
    await env.close(); env = await open(new FormalRoomStore(directory), tokens); pair = env.pair;
    await until(() => pair.every(client => client.latest.revision > snapshot.revision && client.ready), 'resume one original effect');
    assert.equal(pair[seat].latest.personal.resources.money, beforeMoney - cost);
    assert.equal(personalState(pair[1 - seat].latest.personal), oldPeer);
    const version = pair[seat].latest.revision;
    pair[seat].send(message);
    const replay = await pair[seat].wait(reply => reply.type === 'actionReceipt' && reply.actionId === message.actionId);
    assert.equal(replay.accepted, true); assert.equal(pair[seat].latest.revision, version);
    assert.ok(pair[1 - seat].latest.events.every(event => event.kind !== 'message' || !String(event.text).includes('余额')));
    for (const owner of [0, 1]) {
      if (!pair[owner].latest.personal.decision.players.rewardResolved) await advance(pair, owner, { kind: 'preparation', operation: 'skip-reward' });
      await advance(pair, owner, { kind: 'preparation', operation: 'ready' });
    }
    for (let n = 0; n < 20 && pair[0].latest.personal.decision.kind !== 'wait-actions'; n++) {
      const owner = pair.findIndex(client => client.latest.personal.decision.requiredSeats.includes(client.latest.seat));
      const option = pair[owner].latest.personal.decision.options.find(option => option.accept === false || option.pokemonId === null);
      assert.ok(option); await advance(pair, owner, option);
    }
    const revision = pair[0].latest.revision;
    for (const client of pair) {
      const snapshot = client.latest, moves = snapshot.personal.party[0].pokemon.fields.moveset;
      const attacks = snapshot.personal.decision.options.filter(option => option.kind === 'fight' && (option.target === null || option.target >= 2));
      const attack = attacks.find(option => [52, 55, 22, 670].includes(moves[option.cursor]?.fields.moveId))
        ?? attacks.find(option => [33, 10].includes(moves[option.cursor]?.fields.moveId));
      assert.ok(attack); await raw(client, attack);
    }
    await until(() => pair.every(client => client.latest.revision > revision && client.ready) || pair.some(client => client.errors.length), 'next FIGHT')
      .catch(error => { throw Error(`${error.message}: ${JSON.stringify(pair.map(client => ({ revision: client.latest.revision,
        decision: client.latest.personal.decision.kind, ready: client.ready, errors: client.errors,
        status: client.messages.filter(message => message.type === 'syncStatus').at(-1) })))}`); });
    assert.deepEqual(pair.flatMap(client => client.errors), [], env.failures.join(', '));
  } finally { await env.close(); await rm(directory, { recursive: true, force: true }); }
});

test('formal original shop requires both ACKs and isolates two simultaneous room wallets, menus and RNG', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vs17-rooms-')), env = await open(new FormalRoomStore(directory));
  try {
    const first = env.pair, second = await env.connectPair(null, 1);
    const roomId = second[0].identity.roomId, before = structuredClone(env.server.rooms.get(roomId).checkpoint);
    const action = { kind: 'preparation', operation: 'reroll' }, rejected = request(second[0], action);
    second[0].send(rejected);
    const receipt = await second[0].wait(message => message.type === 'actionReceipt' && message.actionId === rejected.actionId);
    assert.equal(receipt.accepted, false); assert.equal(receipt.code, 'SYNC_BLOCKED');
    assert.deepEqual(env.server.rooms.get(roomId).checkpoint, before); assert.deepEqual(env.server.rooms.get(roomId).inputs, {});
    const firstBefore = structuredClone(env.server.rooms.get(first[0].identity.roomId).checkpoint);
    second[1].holdAck = false; for (const ack of second[1].acks.splice(0)) second[1].send(ack);
    await until(() => second.every(client => client.ready), 'release second model ACK');
    const money = second[1].latest.personal.resources.money, cost = second[1].latest.personal.decision.players.rerollCost;
    await advance(second, 1, action);
    assert.equal(second[1].latest.personal.resources.money, money - cost);
    assert.deepEqual(env.server.rooms.get(first[0].identity.roomId).checkpoint, firstBefore);
    assert.deepEqual(first.flatMap(client => client.errors), []); assert.deepEqual(second.flatMap(client => client.errors), []);
  } finally { await env.close(); await rm(directory, { recursive: true, force: true }); }
});
