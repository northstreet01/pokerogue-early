import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { attachFormalCoopServer, FormalRoomStore, hashProjection } from '../server/formal-coop-service.mjs';
import { canonical, copy, ContractError, requireContract, validateMessage } from '../src/battle-core/coop-contract.mjs';
import { createSnapshotConsumer, digestProjection } from '../src/battle-core/coop-client.mjs';

// Protocol fixture only. This counter is NOT a Pokemon/original-rule adapter.
const adapter = {
  rulesVersion: 'protocol-test-only', contentHash: 'counter-fixture-v1',
  createInitialContext: () => ({ tick: 0, total: 0, balances: [10, 20] }),
  validateCheckpoint(value) { requireContract(Number.isSafeInteger(value.tick) && Number.isSafeInteger(value.total) && value.balances.length === 2, 'INVALID_CHECKPOINT'); },
  captureCheckpoint: copy, restoreCheckpoint: copy,
  describeDecision: ctx => ({ id: `decision-${ctx.tick}`, requiredSeats: [0, 1] }),
  validateAction(ctx, seat, action) { requireContract(action.kind === 'add' && action.owner === seat && Number.isInteger(action.amount) && action.amount > 0 && action.amount <= ctx.balances[seat], 'INVALID_ACTION'); },
  advanceToDecision(ctx, inputs) {
    ctx.tick++;
    for (const seat of [0, 1]) { ctx.total += inputs[seat].amount; ctx.balances[seat] -= inputs[seat].amount; }
    return { context: ctx, events: [{ kind: 'advanced' }], grants: [{ id: `grant-${ctx.tick}`, seat: 0, payload: { count: 1 } }] };
  },
  projectSnapshot: (ctx, seat) => ({ shared: { tick: ctx.tick, total: ctx.total }, personal: { balance: ctx.balances[seat] } })
};
const memoryStore = () => ({ data: new Map(), fail: false, async load() { return [...this.data.values()].map(copy); }, async save(room) { if (this.fail) throw Error('disk full'); this.data.set(room.roomId, copy(room)); } });
class Client {
  constructor(url) {
    this.socket = new WebSocket(url); this.messages = []; this.waiters = [];
    this.socket.on('message', raw => { const message = JSON.parse(raw); validateMessage(message, 'server'); this.messages.push(message); this.flush(); });
  }
  async open() { await new Promise((resolve, reject) => { this.socket.once('open', resolve); this.socket.once('error', reject); }); return this; }
  send(message) { this.socket.send(JSON.stringify(message)); }
  wait(predicate) { return new Promise((resolve, reject) => { const waiter = { predicate, resolve, timer: setTimeout(() => { this.waiters = this.waiters.filter(w => w !== waiter); reject(Error('Timed out: ' + predicate)); }, 3000) }; this.waiters.push(waiter); this.flush(); }); }
  flush() { for (const waiter of [...this.waiters]) { const index = this.messages.findIndex(waiter.predicate); if (index < 0) continue; clearTimeout(waiter.timer); this.waiters.splice(this.waiters.indexOf(waiter), 1); waiter.resolve(this.messages.splice(index, 1)[0]); } }
  async close() { if (this.socket.readyState === WebSocket.CLOSED) return; await new Promise(resolve => { this.socket.once('close', resolve); this.socket.close(); }); }
}
async function server(options = {}) {
  const httpServer = http.createServer(), store = options.store ?? memoryStore();
  const service = await attachFormalCoopServer(httpServer, { adapter, store, ...options });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const clients = [];
  return { ...service, store, async client(hello = true) { const client = await new Client(`ws://127.0.0.1:${httpServer.address().port}/coop/v1/ws`).open(); clients.push(client); if (hello) { client.send({ type: 'hello', ...service.versions }); await client.wait(m => m.type === 'welcome'); } return client; }, async close() { await Promise.all(clients.map(c => c.close())); await service.close(); await new Promise(resolve => httpServer.close(resolve)); } };
}
async function start(f) {
  const a = await f.client(), b = await f.client();
  a.send({ type: 'createRoom', name: 'A' }); const ia = await a.wait(m => m.type === 'welcome');
  b.send({ type: 'joinRoom', roomId: ia.roomId, name: 'B' }); const ib = await b.wait(m => m.type === 'welcome');
  const sa = await a.wait(m => m.type === 'snapshot'), sb = await b.wait(m => m.type === 'snapshot');
  return { a, b, ia, ib, sa, sb };
}
const request = s => ({ type: 'requestSnapshot', roomId: s.roomId, runId: s.runId, knownRevision: s.revision, reason: 'test' });
const ack = s => ({ type: 'stateAck', roomId: s.roomId, runId: s.runId, revision: s.revision, decisionId: s.decisionId, connectionEpoch: s.connectionEpoch, sharedHash: s.sharedHash, personalHash: s.personalHash });
const action = (s, id, amount = 1) => ({ type: 'submitAction', roomId: s.roomId, runId: s.runId, decisionId: s.decisionId, expectedRevision: s.revision, actionId: id, action: { kind: 'add', owner: s.seat, amount } });
async function applyModel(client, snapshot) {
  if (!client.consume) {
    client.model = null; client.ledger = new Set();
    client.consume = createSnapshotConsumer({ versions: snapshot, isCurrent: epoch => epoch === client.epoch, send: m => client.send(m), adapter: {
      applySnapshot(s) { client.model = copy({ shared: s.shared, personal: s.personal }); },
      captureAppliedState: () => copy(client.model),
      async applyGrantsTransaction(grants) { for (const grant of grants) client.ledger.add(grant.id); }
    } });
  }
  client.epoch = snapshot.connectionEpoch;
  await client.consume(snapshot);
}
async function ready(p) { await applyModel(p.a, p.sa); await applyModel(p.b, p.sb); await p.a.wait(m => m.type === 'syncStatus' && !m.blocked); assert.notEqual(p.a.model, p.b.model); assert.deepEqual(p.a.model.shared, p.b.model.shared); }
async function receipt(client, message, code = 'ACCEPTED') { client.send(message); const result = await client.wait(m => m.type === 'actionReceipt' && m.actionId === message.actionId); assert.equal(result.code, code); return result; }

test('formal strict schemas and canonical hashing reject unsafe/ambiguous values', async () => {
  for (const value of [undefined, NaN, { x: undefined }, new Array(1), JSON.parse('{"__proto__":{}}')]) assert.throws(() => canonical(value));
  assert.throws(() => canonical({ get x() { throw Error('getter executed'); } }), /INVALID_JSON/);
  const array = []; Object.defineProperty(array, 0, { enumerable: true, get() { throw Error('getter executed'); } }); assert.throws(() => canonical(array), /INVALID_JSON/);
  assert.throws(() => validateMessage({ type: 'createRoom', name: 'A', seat: 0 }));
  assert.throws(() => validateMessage({ type: 'hello', protocolVersion: 1 }));
  assert.equal(await digestProjection({ b: [1, 2], a: 3 }), hashProjection({ a: 3, b: [1, 2] }));
});
test('handshake versions, missing adapter and forged identity fail closed', async () => {
  const f = await server({ adapter: null });
  try {
    const c = await f.client(false); c.send({ type: 'createRoom', name: 'A' }); assert.equal((await c.wait(m => m.type === 'error')).code, 'HELLO_REQUIRED');
    for (const field of ['protocolVersion', 'rulesVersion', 'contentHash', 'checkpointVersion']) { c.send({ type: 'hello', ...f.versions, [field]: typeof f.versions[field] === 'number' ? 999 : 'wrong' }); assert.equal((await c.wait(m => m.type === 'error')).code, 'VERSION_MISMATCH'); }
    c.send({ type: 'hello', ...f.versions }); await c.wait(m => m.type === 'welcome');
    c.send({ type: 'createRoom', name: 'A' }); assert.equal((await c.wait(m => m.type === 'error')).code, 'ADAPTER_UNAVAILABLE'); assert.equal(f.rooms.size, 0);
  } finally { await f.close(); }
});
test('two real clients enforce ownership, barriers, durable dedup and stale decisions', async () => {
  const f = await server();
  try {
    const p = await start(f);
    assert.notEqual(p.sa.personalHash, p.sb.personalHash); assert.equal(p.sa.sharedHash, p.sb.sharedHash);
    assert.ok(!JSON.stringify(p.sa).includes(p.ib.resumeToken));
    await receipt(p.a, action(p.sa, 'early'), 'SYNC_BLOCKED'); await ready(p);
    await receipt(p.a, { ...action(p.sa, 'foreign'), action: { kind: 'add', owner: 1, amount: 1 } }, 'INVALID_ACTION');
    p.a.send({ ...action(p.sa, 'forge'), seat: 1 }); assert.equal((await p.a.wait(m => m.type === 'error')).code, 'INVALID_MESSAGE');
    const first = await receipt(p.a, action(p.sa, 'one'));
    assert.deepEqual(f.store.data.get(p.ia.roomId).inputs, { 0: action(p.sa, 'one').action });
    assert.deepEqual(await receipt(p.a, action(p.sa, 'one')), first);
    p.a.send(action(p.sa, 'one', 2)); assert.equal((await p.a.wait(m => m.type === 'error')).code, 'ACTION_ID_CONFLICT');
    await receipt(p.b, action(p.sb, 'two', 2)); const next = await p.a.wait(m => m.type === 'snapshot' && m.revision === 1);
    assert.equal(next.shared.total, 3); assert.equal(f.store.data.get(p.ia.roomId).revision, 1);
    p.a.send(ack(p.sa)); p.a.send(request(next)); await p.a.wait(m => m.type === 'syncStatus' && m.revision === 1 && m.acked.every(v => !v));
    assert.ok(!p.a.messages.some(m => m.type === 'error'));
    await receipt(p.a, action(p.sa, 'old'), 'STALE_DECISION'); assert.deepEqual(await receipt(p.a, action(p.sa, 'one')), first);
    p.b.send({ type: 'grantAck', roomId: next.roomId, runId: next.runId, connectionEpoch: p.ib.connectionEpoch, grantIds: ['grant-1'] }); assert.equal((await p.b.wait(m => m.type === 'error')).code, 'GRANT_NOT_OWNED');
    p.a.send(ack(next)); assert.equal((await p.a.wait(m => m.type === 'error')).code, 'GRANTS_PENDING');
  } finally { await f.close(); }
});
test('actual applied model and local transaction must succeed before acknowledgments', async () => {
  const f = await server();
  try {
    const p = await start(f); await ready(p); await receipt(p.a, action(p.sa, 'a')); await receipt(p.b, action(p.sb, 'b'));
    const next = await p.a.wait(m => m.type === 'snapshot' && m.revision === 1), nextB = await p.b.wait(m => m.type === 'snapshot' && m.revision === 1);
    let model, corrupt = true, failSave = false, epoch = next.connectionEpoch, grantCount = 0; const ledger = new Set(), sent = [];
    const consume = createSnapshotConsumer({ versions: f.versions, isCurrent: e => e === epoch, send: m => { sent.push(m); p.a.send(m); }, adapter: {
      applySnapshot(s) { model = copy({ shared: s.shared, personal: s.personal }); if (corrupt) model.shared.total++; },
      captureAppliedState: () => copy(model),
      async applyGrantsTransaction(grants) { if (failSave) throw Error('local disk full'); for (const g of grants) if (!ledger.has(g.id)) { ledger.add(g.id); grantCount++; } }
    } });
    await assert.rejects(consume(next), /MODEL_MISMATCH/); assert.ok(sent.every(m => m.type === 'requestSnapshot'));
    corrupt = false; failSave = true; await assert.rejects(consume(next), /local disk full/); assert.ok(sent.every(m => m.type === 'requestSnapshot'));
    failSave = false; await consume(next); await applyModel(p.b, nextB); await p.a.wait(m => m.type === 'syncStatus' && m.revision === 1 && !m.blocked);
    await consume(next); assert.equal(grantCount, 1); assert.deepEqual(sent.filter(m => m.type !== 'requestSnapshot').slice(0, 2).map(m => m.type), ['grantAck', 'stateAck']);
    epoch = 'replaced'; assert.equal(await consume(next), false);
    p.b.send({ ...ack(nextB), sharedHash: '0'.repeat(64) }); assert.equal((await p.b.wait(m => m.type === 'error')).code, 'MODEL_MISMATCH');
    await receipt(p.a, action(next, 'after-corruption'), 'SYNC_BLOCKED');
  } finally { await f.close(); }
});
test('connection replacement invalidates confirmations and old epochs', async () => {
  const f = await server();
  try {
    const p = await start(f); await ready(p);
    const outsider = await f.client(); outsider.send({ type: 'resumeSeat', roomId: p.ia.roomId, resumeToken: 'wrong' }); assert.equal((await outsider.wait(m => m.type === 'error')).code, 'INVALID_CREDENTIAL');
    outsider.send({ type: 'joinRoom', roomId: p.ia.roomId, name: 'C' }); assert.equal((await outsider.wait(m => m.type === 'error')).code, 'ROOM_FULL');
    const a2 = await f.client(); a2.send({ type: 'resumeSeat', roomId: p.ia.roomId, resumeToken: p.ia.resumeToken }); const identity = await a2.wait(m => m.type === 'welcome'), snap = await a2.wait(m => m.type === 'snapshot');
    assert.notEqual(identity.connectionEpoch, p.ia.connectionEpoch);
    a2.send(ack(p.sa)); assert.equal((await a2.wait(m => m.type === 'error')).code, 'CONNECTION_REPLACED');
    await receipt(a2, action(snap, 'blocked'), 'SYNC_BLOCKED'); a2.send(ack(snap)); p.b.send(ack(p.sb)); await a2.wait(m => m.type === 'syncStatus' && !m.blocked);
    await receipt(a2, action(snap, 'valid'));
  } finally { await f.close(); }
});
test('disk failure pauses without publishing input; recovery requires fresh confirmations', async () => {
  const f = await server();
  try {
    const p = await start(f); await ready(p); const before = copy(f.rooms.get(p.ia.roomId)); f.store.fail = true;
    p.a.send(action(p.sa, 'disk')); assert.equal((await p.a.wait(m => m.type === 'error')).code, 'STORAGE_FAILED'); assert.deepEqual(f.rooms.get(p.ia.roomId), before);
    f.store.fail = false; p.b.send(action(p.sb, 'blocked')); assert.equal((await p.b.wait(m => m.type === 'error')).code, 'STORAGE_FAILED');
    p.a.send(request(p.sa)); await p.a.wait(m => m.type === 'syncStatus' && m.reason === 'WAITING_ACK' && m.acked.every(v => !v));
    await ready(p); await receipt(p.a, action(p.sa, 'disk')); assert.equal(f.rooms.get(p.ia.roomId).inputs[0].amount, 1);
  } finally { f.store.fail = false; await f.close(); }
});
test('real disk restart retains one input/receipt, resets ACKs, and rejects incompatible recovery without rewriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'early-formal-test-')), store = new FormalRoomStore(directory); let f = await server({ store });
  try {
    const p = await start(f); await ready(p); const original = await receipt(p.a, action(p.sa, 'pending'));
    await f.close(); const path = join(directory, `${p.ia.roomId}.json`), before = await readFile(path, 'utf8');
    f = await server({ store, adapter: { ...adapter, contentHash: 'different-content' } });
    const incompatible = await f.client(); incompatible.send({ type: 'resumeSeat', roomId: p.ia.roomId, resumeToken: p.ia.resumeToken }); assert.equal((await incompatible.wait(m => m.type === 'error')).code, 'VERSION_MISMATCH');
    assert.equal(await readFile(path, 'utf8'), before); await f.close(); f = await server({ store });
    const a = await f.client(), b = await f.client();
    a.send({ type: 'resumeSeat', roomId: p.ia.roomId, resumeToken: p.ia.resumeToken }); const ia = await a.wait(m => m.type === 'welcome');
    b.send({ type: 'resumeSeat', roomId: p.ib.roomId, resumeToken: p.ib.resumeToken }); await b.wait(m => m.type === 'welcome');
    const sa = await a.wait(m => m.type === 'snapshot'), sb = await b.wait(m => m.type === 'snapshot'); assert.equal(sa.sharedHash, p.sa.sharedHash); assert.notEqual(ia.connectionEpoch, p.ia.connectionEpoch);
    assert.deepEqual(await receipt(a, action(p.sa, 'pending')), original);
    await receipt(b, action(sb, 'too-early'), 'SYNC_BLOCKED'); await ready({ a, b, sa, sb }); await receipt(b, action(sb, 'finish'));
    assert.equal((await a.wait(m => m.type === 'snapshot' && m.revision === 1)).shared.total, 2);
  } finally { await f.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); }
});
test('runner failure retains both durable inputs and recovery advances them once', async () => {
  let fail = true; const f = await server({ adapter: { ...adapter, advanceToDecision(...args) { if (fail) throw Error('runner failure'); return adapter.advanceToDecision(...args); } } });
  try {
    const p = await start(f); await ready(p); await receipt(p.a, action(p.sa, 'a')); await receipt(p.b, action(p.sb, 'b'));
    assert.equal((await p.b.wait(m => m.type === 'error')).code, 'RUNNER_FAILED'); assert.equal(f.rooms.get(p.ia.roomId).revision, 0); assert.equal(Object.keys(f.store.data.get(p.ia.roomId).inputs).length, 2);
    fail = false; p.a.send(request(p.sa)); await p.a.wait(m => m.type === 'syncStatus' && m.reason === 'WAITING_ACK'); await ready(p);
    assert.equal((await p.a.wait(m => m.type === 'snapshot' && m.revision === 1)).shared.total, 2);
  } finally { await f.close(); }
});

test('transition write failure preserves durable inputs and a restart settles exactly once', async () => {
  const store = memoryStore(), save = store.save; let failTransition = true;
  store.save = async function(room) { if (room.revision === 1 && failTransition) throw Error('transition disk failure'); await save.call(this, room); };
  let f = await server({ store });
  try {
    const p = await start(f); await ready(p);
    // Reverse arrival order must produce the same authority result.
    await receipt(p.b, action(p.sb, 'b', 2)); await receipt(p.a, action(p.sa, 'a'));
    assert.equal((await p.a.wait(m => m.type === 'error')).code, 'STORAGE_FAILED');
    assert.equal(store.data.get(p.ia.roomId).revision, 0); assert.equal(Object.keys(store.data.get(p.ia.roomId).inputs).length, 2);
    assert.ok(!p.a.messages.some(m => m.type === 'snapshot' && m.revision === 1));
    await f.close(); failTransition = false; f = await server({ store });
    const a = await f.client(), b = await f.client();
    for (const [client, id] of [[a, p.ia], [b, p.ib]]) { client.send({ type: 'resumeSeat', roomId: id.roomId, resumeToken: id.resumeToken }); await client.wait(m => m.type === 'welcome'); }
    const sa = await a.wait(m => m.type === 'snapshot'), sb = await b.wait(m => m.type === 'snapshot');
    await ready({ a, b, sa, sb }); const next = await a.wait(m => m.type === 'snapshot' && m.revision === 1);
    assert.equal(next.shared.total, 3); assert.equal(next.personal.balance, 9); assert.equal(next.grants.length, 1);
    // Simulate losing the committed result/ACKs: neither receipt nor transition may replay.
    await f.close(); f = await server({ store });
    const recovered = await f.client(); recovered.send({ type: 'resumeSeat', roomId: p.ia.roomId, resumeToken: p.ia.resumeToken }); await recovered.wait(m => m.type === 'welcome');
    const saved = await recovered.wait(m => m.type === 'snapshot'); assert.equal(saved.sharedHash, next.sharedHash); assert.deepEqual(saved.grants, next.grants);
    await receipt(recovered, action(p.sa, 'a')); assert.equal(f.rooms.get(p.ia.roomId).revision, 1); assert.equal(f.rooms.get(p.ia.roomId).grants.length, 1);
  } finally { await f.close(); }
});

const recover = s => ({ type:'recoverDecision',roomId:s.roomId,runId:s.runId,revision:s.revision,
  decisionId:s.decisionId,connectionEpoch:s.connectionEpoch });
test('both authenticated seats can abandon only an uncommitted failed candidate; old receipts cannot replay', async () => {
  let fail = true;
  const f = await server({adapter:{...adapter,advanceToDecision(...args){if(fail)throw Error('stuck');return adapter.advanceToDecision(...args);}}});
  try {
    const p=await start(f);await ready(p);
    p.a.send(recover(p.sa));assert.equal((await p.a.wait(m=>m.type==='error')).code,'RECOVERY_NOT_AVAILABLE');
    const first=action(p.sa,'stuck-a'),second=action(p.sb,'stuck-b');
    await receipt(p.a,first);await receipt(p.b,second);
    await p.b.wait(m=>m.type==='error'&&m.code==='RUNNER_FAILED');
    const before=copy(f.store.data.get(p.ia.roomId));
    p.a.send({...recover(p.sa),connectionEpoch:'old'});
    assert.equal((await p.a.wait(m=>m.type==='error')).code,'CONNECTION_REPLACED');
    p.a.send(recover(p.sa));await p.a.wait(m=>m.type==='syncStatus'&&m.reason==='RECOVERY_PENDING');
    p.a.send(recover(p.sa));await p.a.wait(m=>m.type==='syncStatus'&&m.reason==='RECOVERY_PENDING');
    assert.deepEqual(f.store.data.get(p.ia.roomId),before,'one seat cannot reset the other input');
    p.b.send(recover(p.sb));
    const sa=await p.a.wait(m=>m.type==='snapshot'&&m.revision===1),sb=await p.b.wait(m=>m.type==='snapshot'&&m.revision===1);
    assert.deepEqual(f.rooms.get(p.ia.roomId).checkpoint,before.checkpoint);
    assert.deepEqual(f.rooms.get(p.ia.roomId).inputs,{});
    assert.equal(sa.sharedHash,p.sa.sharedHash);assert.equal(sa.personalHash,p.sa.personalHash);
    assert.deepEqual(f.rooms.get(p.ia.roomId).receipts,before.receipts);
    assert.deepEqual(f.rooms.get(p.ia.roomId).grants,before.grants);
    await ready({a:p.a,b:p.b,sa,sb});
    assert.equal((await receipt(p.a,first)).revision,0);
    assert.deepEqual(f.rooms.get(p.ia.roomId).inputs,{});
    p.a.send(recover(p.sa));assert.equal((await p.a.wait(m=>m.type==='error')).code,'STALE_DECISION');
    fail=false;
    await receipt(p.a,action(sa,'new-a'));await receipt(p.b,action(sb,'new-b'));
    assert.equal((await p.a.wait(m=>m.type==='snapshot'&&m.revision===2)).shared.total,2);
  }finally{await f.close();}
});

test('recovery refuses storage faults and a failed reset save keeps the last durable candidate',async()=>{
  const store=memoryStore();
  const f=await server({store,adapter:{...adapter,advanceToDecision(){throw Error('stuck');}}});
  try{
    const p=await start(f);await ready(p);await receipt(p.a,action(p.sa,'a'));await receipt(p.b,action(p.sb,'b'));
    await p.b.wait(m=>m.type==='error'&&m.code==='RUNNER_FAILED');
    const before=copy(store.data.get(p.ia.roomId));
    p.a.send(recover(p.sa));await p.a.wait(m=>m.type==='syncStatus'&&m.reason==='RECOVERY_PENDING');
    store.fail=true;p.b.send(recover(p.sb));
    await p.b.wait(m=>m.type==='error'&&m.code==='STORAGE_FAILED');
    assert.deepEqual(store.data.get(p.ia.roomId),before);assert.deepEqual(f.rooms.get(p.ia.roomId),before);
    p.a.send(recover(p.sa));assert.equal((await p.a.wait(m=>m.type==='error')).code,'RECOVERY_NOT_AVAILABLE');
  }finally{await f.close();}
});

test('connection invalidation during an awaited local transaction suppresses every old ACK', async () => {
  const f = await server();
  try {
    const p = await start(f); let current = true, release, began; const started = new Promise(resolve => { began = resolve; }), sent = [];
    const consume = createSnapshotConsumer({ versions: f.versions, isCurrent: () => current, send: m => sent.push(m), adapter: {
      applySnapshot() {}, captureAppliedState: () => ({ shared: p.sa.shared, personal: p.sa.personal }),
      async applyGrantsTransaction() { began(); await new Promise(resolve => { release = resolve; }); }
    } });
    const work = consume(p.sa); await started; current = false; release(); assert.equal(await work, false); assert.deepEqual(sent, []);
  } finally { await f.close(); }
});

test('a resync request delivers fresh snapshots to both clients whose ACKs were withdrawn', async () => {
  const f = await server();
  try {
    const p = await start(f); await ready(p);
    p.a.messages = []; p.b.messages = [];
    p.a.send(request(p.sa));
    const sa = await p.a.wait(m => m.type === 'snapshot'), sb = await p.b.wait(m => m.type === 'snapshot');
    await ready({ a: p.a, b: p.b, sa, sb });
    await receipt(p.a, action(sa, 'resynced'));
  } finally { await f.close(); }
});

test('formal endpoint without an adapter rejects room creation', async () => {
  const f = await server({adapter:null});
  try { const client=await f.client();client.send({type:'createRoom',name:'A'});
    assert.equal((await client.wait(m=>m.type==='error')).code,'ADAPTER_UNAVAILABLE');assert.equal(f.rooms.size,0);
  } finally { await f.close(); }
});
