import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachCoopServer, RoomStore } from '../server/coop-service.mjs';
import { ENGINE_VERSION, RULES_HASH, clone, stateHash, resolveRound } from '../src/coop/engine.mjs';

const team = [1,4,7].map(species => ({ species, ivs: [10,10,10,10,10,10], nature: 0, dexAttr: '149' }));
class Client {
  constructor(url) {
    this.socket = new WebSocket(url); this.messages = []; this.waiters = [];
    this.socket.on('message', raw => { this.messages.push(JSON.parse(raw)); this.flush(); });
  }
  async open() { await new Promise((resolve,reject) => { this.socket.once('open',resolve); this.socket.once('error',reject); }); return this; }
  send(message) { this.socket.send(JSON.stringify({ version: ENGINE_VERSION, rulesHash: RULES_HASH, ...message })); }
  wait(predicate) {
    return new Promise((resolve,reject) => {
      const waiter = { predicate, resolve, reject, timer: setTimeout(() => { this.waiters = this.waiters.filter(v => v !== waiter); reject(new Error('Timed out: ' + predicate)); }, 4000) };
      this.waiters.push(waiter); this.flush();
    });
  }
  flush() { for (const waiter of [...this.waiters]) {
    const index = this.messages.findIndex(waiter.predicate);
    if (index < 0) continue;
    clearTimeout(waiter.timer); this.waiters.splice(this.waiters.indexOf(waiter),1); waiter.resolve(this.messages.splice(index,1)[0]);
  } }
  close() { return new Promise(resolve => { if (this.socket.readyState === WebSocket.CLOSED) return resolve(); this.socket.once('close', resolve); this.socket.close(); }); }
}
async function server(store = { data: new Map(), async load() { return [...this.data.values()].map(clone); }, async save(room) { this.data.set(room.code, clone(room)); } }) {
  const httpServer = http.createServer(); const service = await attachCoopServer(httpServer, { store });
  await new Promise(resolve => httpServer.listen(0,'127.0.0.1',resolve));
  const clients = []; const url = `ws://127.0.0.1:${httpServer.address().port}/coop/ws`;
  return { ...service, store, async client() { const client = await new Client(url).open(); clients.push(client); return client; }, async close() { await Promise.all(clients.map(client => client.close())); await service.close(); await new Promise(resolve => httpServer.close(resolve)); } };
}
async function start(fixture) {
  const a = await fixture.client(), b = await fixture.client();
  a.send({ type: 'create', name: 'A' }); const identityA = await a.wait(v => v.type === 'joined');
  b.send({ type: 'join', code: identityA.code, name: 'B' }); const identityB = await b.wait(v => v.type === 'joined');
  a.send({ type: 'team', id: 'team', team }); b.send({ type: 'team', id: 'team', team });
  const snapA = await a.wait(v => v.type === 'snapshot' && v.state?.revision === 1);
  const snapB = await b.wait(v => v.type === 'snapshot' && v.state?.revision === 1);
  return { a,b,identityA,identityB,snapA,snapB };
}
function acknowledge(client, snapshot) {
  if (snapshot.grants.length) client.send({ type: 'grantAck', ids: snapshot.grants.map(g => g.id) });
  client.send({ type: 'ack', revision: snapshot.state.revision, hash: stateHash(clone(snapshot.state)) });
}
test('real WebSockets enforce hashes, duplicate receipts, stale rejection and exactly one round', async () => {
  const fixture = await server();
  try {
    const {a,b,snapA,snapB,identityA} = await start(fixture);
    a.send({ type: 'ack', revision: 1, hash: 'incorrect' });
    assert.match((await a.wait(v => v.type === 'error')).message,/校验失败/);
    a.send({ type: 'action', id: 'early', revision: 1, action: { kind:'move',move:33,target:0 } });
    assert.match((await a.wait(v => v.type === 'error')).message,/状态确认/);
    acknowledge(a,snapA); acknowledge(b,snapB);
    await a.wait(v => v.type === 'snapshot' && v.state?.revision === 1 && !v.barrier);
    a.send({type:'ack',revision:1,hash:'bad-after-confirmation'});
    assert.match((await a.wait(v=>v.type==='error')).message,/校验失败/);
    assert.equal(fixture.rooms.get(identityA.code).barrier,true);
    assert.deepEqual(fixture.rooms.get(identityA.code).acked,[false,false]);
    acknowledge(a,snapA); acknowledge(b,snapB);
    await a.wait(v=>v.type==='snapshot' && v.state?.revision===1 && !v.barrier);
    const message = { type:'action',id:'turn-1',revision:1,action:{kind:'move',move:33,target:0} };
    a.send(message); const first = await a.wait(v => v.type === 'receipt' && v.id === 'turn-1');
    a.send(message); assert.deepEqual(await a.wait(v => v.type === 'receipt' && v.id === 'turn-1'),first);
    assert.equal(fixture.rooms.get(identityA.code).state.revision,1);
    a.send({...message,action:{kind:'move',move:33,target:1}}); assert.match((await a.wait(v => v.type === 'error')).message,/同一编号/);
    b.send({ type:'action',id:'turn-1',revision:1,action:{kind:'move',move:33,target:1} });
    const next = await a.wait(v => v.type === 'snapshot' && v.state?.revision === 2);
    assert.equal(next.hash,stateHash(resolveRound(snapA.state,{0:message.action,1:{kind:'move',move:33,target:1}})));
    a.send({type:'ack',revision:1,hash:snapA.hash}); a.send({type:'snapshot'});
    const afterDelayed = await a.wait(v => v.type === 'snapshot' && v.state?.revision === 2);
    assert.equal(afterDelayed.barrier,true); assert.equal(afterDelayed.acked[0],false);
    assert.ok(!a.messages.some(v => v.type === 'error'));
    a.send({ ...message, id:'stale' }); assert.match((await a.wait(v => v.type === 'error')).message,/版本过期/);
    assert.equal(fixture.rooms.get(identityA.code).state.revision,2);
  } finally { await fixture.close(); }
});
test('disconnect pauses, preserves submitted input and original token recovers the seat', async () => {
  const fixture = await server();
  try {
    const {a,b,snapA,snapB,identityA,identityB} = await start(fixture);
    acknowledge(a,snapA); acknowledge(b,snapB); await a.wait(v => v.type === 'snapshot' && v.state && !v.barrier);
    a.send({type:'action',id:'hold',revision:1,action:{kind:'move',move:33,target:0}}); await a.wait(v => v.type === 'receipt' && v.id === 'hold');
    await b.close(); const paused = await a.wait(v => v.type === 'snapshot' && v.paused);
    assert.equal(paused.submitted[0],true);
    const outsider = await fixture.client(); outsider.send({type:'join',code:identityA.code,name:'intruder'});
    assert.match((await outsider.wait(v => v.type === 'error')).message,/房间已满/);
    const recovered = await fixture.client(); recovered.send({type:'join',code:identityA.code,token:identityB.token,name:'B'});
    const joined = await recovered.wait(v => v.type === 'joined'); assert.equal(joined.seat,1);
    const next = await recovered.wait(v => v.type === 'snapshot' && v.state);
    assert.equal(next.state.revision,1); assert.equal(next.submitted[0],true); assert.equal(next.barrier,true);
    const own = await a.wait(v => v.type === 'snapshot' && v.state && v.online.every(Boolean) && v.barrier && v.submitted[0]);
    acknowledge(a,own); acknowledge(recovered,next);
    await recovered.wait(v => v.type === 'snapshot' && !v.barrier && v.state);
    recovered.send({type:'action',id:'resume-turn',revision:1,action:{kind:'move',move:33,target:1}});
    assert.equal((await a.wait(v => v.type === 'snapshot' && v.state?.revision === 2)).state.revision,2);
  } finally { await fixture.close(); }
});
test('persist-before-broadcast rejects a failed disk write without changing canonical state', async () => {
  const store = { data: new Map(), fail:false, async load(){return[];}, async save(room){ if(this.fail) throw new Error('disk full'); this.data.set(room.code,clone(room)); } };
  const fixture = await server(store);
  try {
    const {a,b,snapA,snapB,identityA} = await start(fixture);
    acknowledge(a,snapA); acknowledge(b,snapB); await a.wait(v => v.type === 'snapshot' && v.state && !v.barrier);
    const before = canonicalRoom(fixture.rooms.get(identityA.code)); store.fail = true;
    a.send({type:'action',id:'fail',revision:1,action:{kind:'move',move:33,target:0}});
    assert.equal((await a.wait(v => v.type === 'error')).message,'disk full');
    assert.equal(canonicalRoom(fixture.rooms.get(identityA.code)),before);
    store.fail = false;
  } finally { store.fail = false; await fixture.close(); }
});
const canonicalRoom = room => JSON.stringify(room);
test('malformed WebSocket frames only close their connection and leave the server available', async () => {
  const fixture = await server();
  try {
    const broken = await fixture.client();
    const closed = new Promise(resolve => broken.socket.once('close',resolve));
    // A client-to-server frame without masking must be rejected by ws.
    broken.socket._socket.write(Buffer.from([0x81,0x00]));
    await closed;
    const healthy = await fixture.client(); healthy.send({type:'create',name:'still alive'});
    assert.equal((await healthy.wait(v=>v.type==='joined')).seat,0);
  } finally { await fixture.close(); }
});

test('failure to persist a bad-hash pause cannot leave the old confirmed state playable', async () => {
  const store = { fail:false, async load(){return[];}, async save(){ if(this.fail) throw new Error('disk full'); } };
  const fixture = await server(store);
  try {
    const {a,b,snapA,snapB} = await start(fixture);
    acknowledge(a,snapA); acknowledge(b,snapB);
    await a.wait(v=>v.type==='snapshot' && v.state && !v.barrier);
    store.fail = true;
    a.send({type:'ack',revision:1,hash:'bad'});
    assert.equal((await a.wait(v=>v.type==='error')).message,'disk full');
    const paused = await b.wait(v=>v.type==='snapshot' && v.storageError);
    assert.equal(paused.barrier,true); assert.equal(paused.paused,true);
    store.fail = false;
    b.send({type:'action',id:'blocked',revision:1,action:{kind:'move',move:33,target:0}});
    assert.match((await b.wait(v=>v.type==='error')).message,/存档写入失败/);
    a.send({type:'snapshot'});
    const recovered = await a.wait(v=>v.type==='snapshot' && v.state && !v.storageError && v.barrier && v.acked.every(x=>!x));
    acknowledge(a,recovered); acknowledge(b,recovered);
    await b.wait(v=>v.type==='snapshot' && v.state && !v.storageError && !v.barrier);
    b.send({type:'action',id:'recovered',revision:1,action:{kind:'move',move:33,target:0}});
    await b.wait(v=>v.type==='receipt' && v.id==='recovered');
  } finally { store.fail=false; await fixture.close(); }
});
test('server restart restores durable state, receipts, grants and original seats', async () => {
  const directory = await mkdtemp(join(tmpdir(),'early-coop-test-')); const store = new RoomStore(directory);
  let fixture = await server(store);
  try {
    const {a,b,snapA,snapB,identityA,identityB} = await start(fixture);
    acknowledge(a,snapA); acknowledge(b,snapB); await a.wait(v => v.type === 'snapshot' && v.state && !v.barrier);
    a.send({type:'action',id:'restart-pending',revision:1,action:{kind:'move',move:33,target:0}}); await a.wait(v => v.type === 'receipt' && v.id === 'restart-pending');
    await fixture.close(); fixture = await server(store);
    const first = await fixture.client(), second = await fixture.client();
    first.send({type:'join',code:identityA.code,token:identityA.token,name:'A'}); await first.wait(v => v.type === 'joined');
    second.send({type:'join',code:identityB.code,token:identityB.token,name:'B'}); await second.wait(v => v.type === 'joined');
    const snapshot = await second.wait(v => v.type === 'snapshot' && v.state);
    assert.equal(snapshot.hash,snapA.hash); assert.equal(snapshot.submitted[0],true); assert.equal(snapshot.grants.length,0); assert.equal(snapshot.barrier,true);
  } finally { await fixture.close(); await rm(directory,{recursive:true,force:true}); }
});
