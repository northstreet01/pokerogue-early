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
import { fullCaptureChoice, capturedPreparation } from './helpers/native-reserve-fixture.mjs';
import { learningFixture } from './helpers/native-learning-fixture.mjs';
import { naturalLearning } from './helpers/native-natural-learning.mjs';
import { defaultTrainerRoute,defaultTrainerVictory } from './helpers/native-default-trainer.mjs';
import { trainerReserveFixture } from './helpers/native-trainer-reserve.mjs';

test('VS-02B-12R equal trainer prize: durable winning-turn retry, owned messages and natural next encounter FIGHT',
 {timeout:120000},async()=>{
  const route=await defaultTrainerVictory(),checkpoint=route.beforeVictory;await route.h.close();
  const disk=await temporaryStore();let env,rejectRevision=null;
  const fixture={seed:route.config.seed,identities:route.profiles.map(p=>p.trainer),parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}};
  const start=()=>{const real=new FormalRoomStore(disk.directory);return startEnv({fixture,initialCheckpoint:checkpoint,
    store:{load:()=>real.load(),save:room=>{if(room.revision===rejectRevision)throw Error('trainer prize candidate failure');return real.save(room);}}});};
  try{
    env=await start();const room=await createRoom(env);
    let state=await syncBoth(env,room.a,room.b,room.sa,room.sb);
    const initial=[state.sa,state.sb],before=canonical(env.service.rooms.get(room.roomId).checkpoint);
    const actions=initial.map(s=>s.personal.decision.options.find(o=>o.kind==='fight'&&(o.target===null||o.target>=2)
      &&[52,55,22,670].includes(s.personal.party[0].pokemon.fields.moveset[o.cursor]?.fields.moveId)));
    assert.ok(actions.every(Boolean));
    const isolated=await createRoom(env),isolatedBefore=canonical(env.service.rooms.get(isolated.roomId).checkpoint);
    const tokens=[room.a,room.b].map(c=>c.messages.find(m=>m.type==='welcome'&&m.roomId).resumeToken);
    const resume=async()=>{const clients=[await connect(env,'prize-A'),await connect(env,'prize-B')];
      for(const [seat,client]of clients.entries()){client.send({type:'resumeSeat',roomId:room.roomId,resumeToken:tokens[seat]});await client.wait(m=>m.type==='snapshot');}return clients;};
    const envelope={type:'submitAction',roomId:room.roomId,runId:room.runId,decisionId:initial[0].decisionId,
      expectedRevision:initial[0].revision,actionId:'trainer-prize',action:actions[0]};
    room.a.send(envelope);const receipt=await room.a.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId);assert.equal(receipt.accepted,true);
    await env.close();env=await start();let [a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),before);
    rejectRevision=initial[0].revision+1;const failure=b.next(m=>m.type==='error'&&m.code==='STORAGE_FAILED');await submit(b,state.sb,actions[1]);await failure;
    assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===room.roomId).checkpoint),before);
    await env.close();rejectRevision=null;env=await start();[a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    if(state.sa.revision===initial[0].revision)state=await syncBoth(env,a,b,await a.waitRevisionAfter(initial[0].revision),await b.waitRevisionAfter(initial[0].revision));
    assert.equal(state.sa.personal.decision.kind,'preparation');
    for(const [seat,snapshot]of [state.sa,state.sb].entries()){
      assert.equal(snapshot.personal.resources.money,initial[seat].personal.resources.money+55);
      assert.equal(snapshot.events.filter(e=>e.kind==='message'&&e.scope===seat).length,1);
      assert.ok(snapshot.events.every(e=>e.scope==='shared'||e.scope===seat));
    }
    const stable=canonical(env.service.rooms.get(room.roomId).checkpoint);
    await env.close();env=await start();[a,b]=await resume();state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),stable);
    a.send(envelope);assert.deepEqual(await a.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId),receipt);
    const conflict=a.next(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT');a.send({...envelope,action:{...actions[0],cursor:99}});await conflict;
    assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===isolated.roomId).checkpoint),isolatedBefore);
    const active={...room,a,b};state=await finishPreparation(env,active,state);state=await finishSwitches(env,active,state);
    assert.equal(state.sa.shared.waveIndex,6);assert.equal(state.sa.personal.decision.kind,'wait-actions');
    state=await submitBoth(env,active,state.sa,state.sb,[fightAction(state.sa),fightAction(state.sb)]);
    assert.ok(state.sa.events.some(e=>e.kind==='phase-start'&&e.phase==='MoveEffectPhase'));
    assert.equal(state.sa.personal.resources.money,initial[0].personal.resources.money+55);
    assert.equal(state.sb.personal.resources.money,initial[1].personal.resources.money+55);
  }finally{if(env)await env.close();await disk.cleanup();}
 });

for(const scenario of ['natural-faint','original-reserve'])test(`VS-02B-12R ${scenario}: durable trainer faint/replacement retry, one-input restart and isolation`,
 {timeout:120000},async()=>{
  const route=scenario==='natural-faint'?await defaultTrainerRoute():await trainerReserveFixture();
  let checkpoint=route.c;
  if(scenario==='natural-faint'){
    checkpoint=(await route.h.request('native-next',checkpoint)).checkpoint;
    checkpoint=(await route.h.request('native-run-to-boundary',checkpoint)).checkpoint;
  }
  await route.h.close();
  const disk=await temporaryStore();let env,rejectRevision=null;
  const fixture={seed:route.config.seed,identities:route.profiles.map(p=>p.trainer),parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}};
  const start=()=>{const real=new FormalRoomStore(disk.directory);return startEnv({fixture,initialCheckpoint:checkpoint,
    store:{load:()=>real.load(),save:room=>{if(room.revision===rejectRevision)throw Error('trainer faint candidate failure');return real.save(room);}}});};
  try{
    env=await start();const room=await createRoom(env);
    let state=await syncBoth(env,room.a,room.b,room.sa,room.sb);
    const initial=[state.sa,state.sb],before=canonical(env.service.rooms.get(room.roomId).checkpoint);
    const actions=initial.map(s=>s.personal.decision.options.find(o=>o.kind==='fight'&&(o.target===null||o.target===2)
      &&[52,55,22,670].includes(s.personal.party[0].pokemon.fields.moveset[o.cursor]?.fields.moveId)));
    assert.ok(actions.every(Boolean));
    assert.ok(initial.every(s=>s.personal.decision.options.every(o=>o.kind!=='ball')));
    const isolated=await createRoom(env),isolatedBefore=canonical(env.service.rooms.get(isolated.roomId).checkpoint);
    const tokens=[room.a,room.b].map(c=>c.messages.find(m=>m.type==='welcome'&&m.roomId).resumeToken);
    const resume=async()=>{const clients=[await connect(env,'trainer-faint-A'),await connect(env,'trainer-faint-B')];
      for(const [seat,client]of clients.entries()){client.send({type:'resumeSeat',roomId:room.roomId,resumeToken:tokens[seat]});await client.wait(m=>m.type==='snapshot');}return clients;};
    const envelope={type:'submitAction',roomId:room.roomId,runId:room.runId,decisionId:initial[0].decisionId,
      expectedRevision:initial[0].revision,actionId:'trainer-faint-first',action:actions[0]};
    room.a.send(envelope);const receipt=await room.a.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId);assert.equal(receipt.accepted,true);
    await env.close();env=await start();let [a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),before);
    assert.deepEqual(env.service.rooms.get(room.roomId).inputs,{0:actions[0]});
    rejectRevision=initial[0].revision+1;
    const failure=b.next(m=>m.type==='error'&&m.code==='STORAGE_FAILED');await submit(b,state.sb,actions[1]);await failure;
    const failed=(await disk.store.load()).find(r=>r.roomId===room.roomId);
    assert.equal(canonical(failed.checkpoint),before);assert.deepEqual(failed.inputs,{0:actions[0],1:actions[1]});
    await env.close();rejectRevision=null;env=await start();[a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    if(state.sa.revision===initial[0].revision)state=await syncBoth(env,a,b,await a.waitRevisionAfter(initial[0].revision),await b.waitRevisionAfter(initial[0].revision));
    assert.equal(state.sa.personal.decision.kind,'wait-actions');
    const phases=state.sa.events.filter(e=>e.kind==='phase-start').map(e=>e.phase);
    assert.ok(phases.includes('FaintPhase'));assert.ok(phases.includes('VictoryPhase'));
    const committed=env.service.rooms.get(room.roomId).checkpoint;
    assert.ok(committed.nativeCheckpoint.roster.entries.some(e=>e.owner===null&&e.pokemon.fields.hp===0
      &&checkpoint.battle.enemyParty.includes(e.pokemon.fields.id)),'an actual enemy faint, not merely a player faint');
    if(scenario==='original-reserve'){
      assert.ok(phases.includes('SwitchSummonPhase'));
      assert.ok(committed.nativeCheckpoint.roster.field.slice(2).some(id=>checkpoint.battle.enemyParty.slice(2).includes(id)));
    }
    assert.deepEqual(committed.nativeCheckpoint.players,checkpoint.players);
    a.send(envelope);assert.deepEqual(await a.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId),receipt);
    const conflict=a.next(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT');a.send({...envelope,action:{...actions[0],cursor:99}});await conflict;
    assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===isolated.roomId).checkpoint),isolatedBefore);
    const stable=canonical(committed);await env.close();env=await start();[a,b]=await resume();
    await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),stable,'same HP/PP/EXP/enemy roster after second restart');
  }finally{if(env)await env.close();await disk.cleanup();}
 });

test('VS-02B-12R naturally triggered full learning is a stable formal input boundary', {timeout:120000},async()=>{
  const route=await naturalLearning();const checkpoint=route.beforeLearning,expected=route.c;await route.h.close();
  assert.equal(checkpoint.decision.kind,'continuing');
  let env;
  try{
    env=await startEnv({fixture:{seed:checkpoint.scene.seed,identities:[{trainerId:1,secretId:2},{trainerId:3,secretId:4}],
      parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}},initialCheckpoint:checkpoint});
    const room=await createRoom(env),state=await syncBoth(env,room.a,room.b,room.sa,room.sb);
    assert.equal(state.sa.personal.decision.kind,'learn-move');
    assert.deepEqual(env.service.rooms.get(room.roomId).checkpoint.nativeCheckpoint,expected);
    assert.ok(!room.a.messages.some(m=>m.type==='error'&&m.code==='ADAPTER_FAILED'));
  }finally{if(env)await env.close();}
});

test('VS-02B-12 default natural wave five: formal WS entry, first input restart, durable retry and isolated round',
 {timeout:120000},async()=>{
  const route=await defaultTrainerRoute();const checkpoint=route.c;await route.h.close();
  const disk=await temporaryStore();let env,rejectRevision=null;
  const fixture={seed:route.config.seed,identities:route.profiles.map(p=>p.trainer),
    parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}};
  const start=()=>{const real=new FormalRoomStore(disk.directory);return startEnv({fixture,initialCheckpoint:checkpoint,
    store:{load:()=>real.load(),save:room=>{if(room.revision===rejectRevision)throw Error('trainer candidate failure');return real.save(room);}}});};
  try{
    env=await start();const room=await createRoom(env);
    let state=await syncBoth(env,room.a,room.b,room.sa,room.sb);
    assert.equal(state.sa.shared.waveIndex,5);assert.equal(state.sa.personal.decision.kind,'wait-actions');
    const authority=env.service.rooms.get(room.roomId).checkpoint;
    assert.equal(authority.nativeCheckpoint.battle.battleType,1);
    assert.ok(state.sa.personal.decision.options.every(o=>o.kind!=='ball'));
    const isolated=await createRoom(env),isolatedBefore=canonical(env.service.rooms.get(isolated.roomId).checkpoint);
    const tokens=[room.a,room.b].map(c=>c.messages.find(m=>m.type==='welcome'&&m.roomId).resumeToken);
    const resume=async()=>{const clients=[await connect(env,'trainer-A'),await connect(env,'trainer-B')];
      for(const [seat,client]of clients.entries()){client.send({type:'resumeSeat',roomId:room.roomId,resumeToken:tokens[seat]});await client.wait(m=>m.type==='snapshot');}return clients;};
    const actions=[state.sa,state.sb].map(s=>s.personal.decision.options.find(o=>o.kind==='fight'
      &&[43,39,45].includes(s.personal.party[0].pokemon.fields.moveset[o.cursor]?.fields.moveId)
      &&(o.target===null||o.target>=2)));
    assert.ok(actions.every(Boolean));
    const initial=state.sa,initialPeer=state.sb,before=canonical(authority);
    const envelope={type:'submitAction',roomId:room.roomId,runId:room.runId,decisionId:initial.decisionId,
      expectedRevision:initial.revision,actionId:'trainer-first',action:actions[0]};
    room.a.send(envelope);const receipt=await room.a.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId);
    assert.equal(receipt.accepted,true);
    await env.close();env=await start();let [a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),before);
    assert.deepEqual(env.service.rooms.get(room.roomId).inputs,{0:actions[0]});
    rejectRevision=initial.revision+1;const failure=b.next(m=>m.type==='error'&&m.code==='STORAGE_FAILED');
    await submit(b,state.sb,actions[1]);await failure;
    const failed=(await disk.store.load()).find(r=>r.roomId===room.roomId);
    assert.equal(canonical(failed.checkpoint),before);assert.deepEqual(failed.inputs,{0:actions[0],1:actions[1]});
    await env.close();rejectRevision=null;env=await start();[a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    if(state.sa.revision===initial.revision)state=await syncBoth(env,a,b,await a.waitRevisionAfter(initial.revision),await b.waitRevisionAfter(initial.revision));
    assert.equal(state.sa.personal.decision.kind,'wait-actions');assert.ok(state.sa.revision>initial.revision);
    for(const [seat,snapshot]of [state.sa,state.sb].entries()){
      const old=[initial,initialPeer][seat].personal.party[0].pokemon.fields.moveset;
      assert.equal(snapshot.personal.party[0].pokemon.fields.moveset[actions[seat].cursor].fields.ppUsed,old[actions[seat].cursor].fields.ppUsed+1);
    }
    a.send(envelope);assert.deepEqual(await a.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId),receipt);
    const conflict=a.next(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT');
    a.send({...envelope,action:{...actions[0],cursor:99}});await conflict;
    assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===isolated.roomId).checkpoint),isolatedBefore);
    const committed=canonical(env.service.rooms.get(room.roomId).checkpoint);
    await env.close();env=await start();[a,b]=await resume();await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),committed);
  }finally{if(env)await env.close();await disk.cleanup();}
 });

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
        const snapshot = this.latestSnapshot();
        reject(new Error(`WS_WAIT_TIMEOUT ${this.name}: revision=${snapshot?.revision}, decision=${snapshot?.personal.decision.kind}, errors=${this.messages.filter(m => m.type === 'error').map(m => m.code).join(',')}`));
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
  // Explicit initial fixture only: every action/restore/projection still runs
  // through the production adapter and a real room Worker, never a rule stub.
  const serviceAdapter = options.initialCheckpoint ? { ...adapter,
    createInitialContext: async args => ({ ...await adapter.createInitialContext(args),
      checkpoint: structuredClone(options.initialCheckpoint), intents: structuredClone(options.initialIntents ?? []) }) } : adapter;
  const service = await attachFormalCoopServer(httpServer, { adapter:serviceAdapter, store, heartbeatMs: 60000 });
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
  return ['lobby', 'wait-actions', 'preparation', 'switch-confirm', 'switch-select', 'wait-switch', 'capture-choice', 'learn-move'].includes(decision.kind)
    && decision.requiredSeats.length > 0;
}

async function syncBoth(env, a, b, sa, sb) {
  let snapA = sa, snapB = sb;
  for (let budget = 0; budget < 60; budget++) {
    await Promise.all([applyAndAck(env, a, snapA), applyAndAck(env, b, snapB)]);
    if (snapA.shared.stage === 'battle') {
      assert.ok(Number.isInteger(snapA.shared.waveCycleOffset));
      assert.equal(snapA.shared.waveCycleOffset, snapB.shared.waveCycleOffset);
      assert.equal(snapA.shared.biome, snapB.shared.biome);
    }
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

async function finishSwitches(env, room, state, switchTo = null) {
  for (let guard = 0; guard < 10; guard++) {
    const kind = state.sa.personal.decision.kind;
    if (kind === 'wait-actions') return state;
    if (kind !== 'switch-confirm' && kind !== 'switch-select') throw new Error(`unexpected ${kind}`);
    const seat = state.sa.personal.decision.requiredSeats[0];
    const snapshot = seat === 0 ? state.sa : state.sb;
    const action = kind === 'switch-confirm'
      ? snapshot.personal.decision.options.find(option => option.accept === (switchTo !== null ? seat === 1 : seat === 0))
      : snapshot.personal.decision.options.find(option => switchTo !== null && seat === 1 ? option.pokemonId === switchTo : option.pokemonId !== null);
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
      assert.ok(snapshot.personal.decision.options.filter(option => option.kind !== 'switch')
        .every(option => option.pokemonId === snapshot.shared.field[seat]));
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

for (const [seed, catalogId] of [['mvp-native-entry', 'GREAT_BALL'], ['potion-d', 'POTION']]) {
  test(`VS-02B-06 ${catalogId}: real WS durable reward failure, retry, restart, duplicate and room isolation`, { timeout: 120000 }, async () => {
    const disk = await temporaryStore(); let env;
    const fixture = { seed, identity: { trainerId: 1, secretId: 2 },
      parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } };
    try {
      let rejectRevision = null;
      const store = { load: () => disk.store.load(), save: room => {
        if (room.revision === rejectRevision) throw Error('reward candidate disk failure');
        return disk.store.save(room);
      } };
      env = await startEnv({ fixture, store });
      const room = await createRoom(env);
      let state = await reachPreparation(env, room, await syncBoth(env, room.a, room.b, room.sa, room.sb));
      const isolated = await createRoom(env);
      const isolatedBefore = canonical(env.service.rooms.get(isolated.roomId).checkpoint);
      const snapshot = state.sa, peerBefore = state.sb;
      const option = snapshot.personal.decision.players.rewards.find(o => o.type.catalogId === catalogId);
      assert.ok(option, `${seed} must draw ${catalogId}`);
      const target = catalogId === 'POTION' ? snapshot.personal.party.find(e => e.pokemon.fields.hp > 0
        && e.pokemon.fields.hp < e.pokemon.fields.stats[0]) : null;
      if (catalogId === 'POTION') assert.ok(target, 'real damaged own target required');
      const action = { kind: 'preparation', operation: 'reward', optionId: option.id,
        pokemonId: target?.id ?? null, moveIndex: null, fusionId: null };
      const envelope = { type: 'submitAction', roomId: room.roomId, runId: room.runId,
        decisionId: snapshot.decisionId, expectedRevision: snapshot.revision, actionId: `reward-${catalogId}`, action };
      const before = canonical(env.service.rooms.get(room.roomId).checkpoint);
      const tokens = [room.a, room.b].map(c => c.messages.find(m => m.type === 'welcome' && m.roomId).resumeToken);
      rejectRevision = snapshot.revision + 1;
      const failure = room.a.next(m => m.type === 'error');
      room.a.send(envelope);
      const receipt = await room.a.wait(m => m.type === 'actionReceipt' && m.actionId === envelope.actionId);
      assert.equal(receipt.accepted, true); assert.equal((await failure).code, 'STORAGE_FAILED');
      const failed = (await disk.store.load()).find(r => r.roomId === room.roomId);
      assert.equal(failed.revision, snapshot.revision); assert.equal(canonical(failed.checkpoint), before);
      assert.deepEqual(failed.inputs, { 0: action });
      assert.equal(room.a.latestSnapshot().revision, snapshot.revision);
      rejectRevision = null;
      const counts = [room.a.snapshots.length, room.b.snapshots.length];
      room.a.send({ type: 'requestSnapshot', roomId: room.roomId, runId: room.runId,
        knownRevision: snapshot.revision, reason: 'retry-reward-save' });
      await syncBoth(env, room.a, room.b,
        await room.a.waitSnapshotCount(counts[0]), await room.b.waitSnapshotCount(counts[1]));
      state = await syncBoth(env, room.a, room.b,
        await room.a.waitRevisionAfter(snapshot.revision), await room.b.waitRevisionAfter(snapshot.revision));
      assert.equal(state.sa.revision, snapshot.revision + 1);
      assert.equal(state.sa.personal.decision.players.rewardResolved, true);
      assert.deepEqual(state.sb.personal.resources, peerBefore.personal.resources);
      assert.deepEqual(state.sb.personal.party, peerBefore.personal.party);
      if (target) {
        const hp = state.sa.personal.party.find(e => e.id === target.id).pokemon.fields.hp;
        assert.equal(hp, Math.min(target.pokemon.fields.stats[0], target.pokemon.fields.hp + 20));
      } else assert.equal(state.sa.personal.resources.pokeballs[1], (snapshot.personal.resources.pokeballs[1] ?? 0) + 5);
      assert.equal(canonical(env.service.rooms.get(isolated.roomId).checkpoint), isolatedBefore);
      const committed = canonical(env.service.rooms.get(room.roomId).checkpoint);
      const hashes = [state.sa.personalHash, state.sb.personalHash];
      await env.close(); env = null;
      env = await startEnv({ fixture, store: new FormalRoomStore(disk.directory) });
      const clients = [await connect(env, 'reward-resume-A'), await connect(env, 'reward-resume-B')];
      for (const [seat, client] of clients.entries()) {
        client.send({ type: 'resumeSeat', roomId: room.roomId, resumeToken: tokens[seat] });
        await client.wait(m => m.type === 'snapshot');
        assert.equal(client.latestSnapshot().personalHash, hashes[seat]);
      }
      const [a, b] = clients;
      await syncBoth(env, a, b, a.latestSnapshot(), b.latestSnapshot());
      a.send(envelope);
      assert.deepEqual(await a.wait(m => m.type === 'actionReceipt' && m.actionId === envelope.actionId), receipt);
      const fresh = a.next(m => m.type === 'snapshot');
      a.send({ type: 'requestSnapshot', roomId: room.roomId, runId: room.runId,
        knownRevision: state.sa.revision, reason: 'reward-duplicate-barrier' });
      assert.equal((await fresh).revision, state.sa.revision);
      const restored = (await disk.store.load()).find(r => r.roomId === room.roomId);
      assert.equal(canonical(restored.checkpoint), committed); assert.deepEqual(restored.inputs, {});
      assert.equal(canonical((await disk.store.load()).find(r => r.roomId === isolated.roomId).checkpoint), isolatedBefore);
    } finally { if (env) await env.close(); await disk.cleanup(); }
  });
}

test('VS-02B-08 real WS active switch keeps the ally and lets both seats continue fighting', { timeout: 120000 }, async () => {
  let env;
  try {
    env = await startEnv({ fixture: { seed: 'vs02b08-switch', identity: { trainerId: 1, secretId: 2 },
      parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } } });
    const room = await createRoom(env);
    let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
    const switchA = state.sa.personal.decision.options.find(option => option.kind === 'switch');
    const switchB = state.sb.personal.decision.options.find(option => option.kind === 'switch');
    assert.ok(switchA && switchB);
    const outgoing = state.sa.personal.party[0].id;
    const outgoingPp = state.sa.personal.party[0].pokemon.fields.moveset.map(move => move.fields.ppUsed);
    const partnerIds = state.sb.personal.party.map(entry => entry.id);
    const revision = state.sa.revision;
    state = await submitBoth(env, room, state.sa, state.sb, [switchA, switchB]);
    assert.equal(state.sa.revision, revision + 1);
    assert.equal(state.sa.personal.decision.kind, 'wait-actions');
    assert.equal(state.sa.personal.party[0].id, switchA.pokemonId);
    assert.equal(state.sa.personal.party[1].id, outgoing);
    assert.equal(state.sb.personal.party[0].id, switchB.pokemonId);
    const outgoingAfterPp = state.sa.personal.party[1].pokemon.fields.moveset.map(move => move.fields.ppUsed);
    assert.deepEqual(outgoingAfterPp, outgoingPp, 'outgoing PP was not charged by the switch');
    assert.deepEqual(state.sb.personal.party.map(entry => entry.id).slice(0, 2),
      [switchB.pokemonId, partnerIds[0]]);
    const statusFight = snapshot => snapshot.personal.decision.options.find(option =>
      option.kind === 'fight' && option.cursor === 1 && (option.target === null || option.target >= 2))
      ?? fightAction(snapshot);
    const next = await submitBoth(env, room, state.sa, state.sb,
      [statusFight(state.sa), statusFight(state.sb)]);
    assert.ok(next.sa.revision > state.sa.revision);
    assert.ok(['wait-actions', 'preparation'].includes(next.sa.personal.decision.kind));
  } finally { if (env) await env.close(); }
});

test('VS-02B-08 active switch survives single-input restart, disk retry and duplicate receipts in isolated rooms',
  { timeout: 120000 }, async () => {
    const disk = await temporaryStore(); let env, rejectRevision = null;
    const fixture = { seed: 'vs02b08-switch', identity: { trainerId: 1, secretId: 2 },
      parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } };
    const guardedStore = () => {
      const store = new FormalRoomStore(disk.directory);
      return { load: () => store.load(), save: room => {
        if (room.revision === rejectRevision) throw Error('active switch candidate disk failure');
        return store.save(room);
      } };
    };
    try {
      env = await startEnv({ fixture, store: guardedStore() });
      const room = await createRoom(env);
      let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
      const isolated = await createRoom(env);
      const isolatedBefore = canonical(env.service.rooms.get(isolated.roomId).checkpoint);
      const initial = state.sa, peerBefore = state.sb;
      const action = initial.personal.decision.options.find(o => o.kind === 'switch');
      assert.ok(action);
      const tokens = [room.a, room.b].map(c => c.messages.find(m => m.type === 'welcome' && m.roomId).resumeToken);
      const envelope = { type: 'submitAction', roomId: room.roomId, runId: room.runId,
        decisionId: initial.decisionId, expectedRevision: initial.revision, actionId: 'active-switch-durable', action };
      const before = canonical(env.service.rooms.get(room.roomId).checkpoint);
      room.a.send(envelope);
      const receipt = await room.a.wait(m => m.type === 'actionReceipt' && m.actionId === envelope.actionId);
      assert.equal(receipt.accepted, true);
      const single = (await disk.store.load()).find(r => r.roomId === room.roomId);
      assert.equal(single.revision, initial.revision);
      assert.deepEqual(single.inputs, { 0: action });
      assert.equal(canonical(single.checkpoint), before);
      await env.close(); env = null;

      env = await startEnv({ fixture, store: guardedStore() });
      const clients = [await connect(env, 'switch-resume-A'), await connect(env, 'switch-resume-B')];
      for (const [seat, client] of clients.entries()) {
        client.send({ type: 'resumeSeat', roomId: room.roomId, resumeToken: tokens[seat] });
        await client.wait(m => m.type === 'snapshot');
      }
      const [a, b] = clients;
      state = await syncBoth(env, a, b, a.latestSnapshot(), b.latestSnapshot());
      rejectRevision = initial.revision + 1;
      const failure = b.next(m => m.type === 'error' && m.code === 'STORAGE_FAILED');
      await submit(b, state.sb, fightAction(state.sb));
      await failure;
      const failed = (await disk.store.load()).find(r => r.roomId === room.roomId);
      assert.equal(failed.revision, initial.revision);
      assert.equal(canonical(failed.checkpoint), before);
      assert.equal(Object.keys(failed.inputs).length, 2);
      assert.equal(a.latestSnapshot().revision, initial.revision);
      assert.equal(b.latestSnapshot().revision, initial.revision);
      rejectRevision = null;
      const counts = [a.snapshots.length, b.snapshots.length];
      a.send({ type: 'requestSnapshot', roomId: room.roomId, runId: room.runId,
        knownRevision: initial.revision, reason: 'retry-active-switch-save' });
      await syncBoth(env, a, b, await a.waitSnapshotCount(counts[0]), await b.waitSnapshotCount(counts[1]));
      state = await syncBoth(env, a, b, await a.waitRevisionAfter(initial.revision), await b.waitRevisionAfter(initial.revision));
      assert.equal(state.sa.revision, initial.revision + 1);
      assert.equal(state.sa.shared.field[0], action.pokemonId);
      assert.equal(state.sa.shared.field[1], peerBefore.shared.field[1]);
      assert.deepEqual(state.sa.personal.party.find(e => e.id === initial.personal.party[0].id).pokemon.fields.moveset,
        initial.personal.party[0].pokemon.fields.moveset);
      const committed = canonical(env.service.rooms.get(room.roomId).checkpoint);
      const hashes = [state.sa.personalHash, state.sb.personalHash];
      await env.close(); env = null;

      env = await startEnv({ fixture, store: new FormalRoomStore(disk.directory) });
      const resumed = [await connect(env, 'switch-final-A'), await connect(env, 'switch-final-B')];
      for (const [seat, client] of resumed.entries()) {
        client.send({ type: 'resumeSeat', roomId: room.roomId, resumeToken: tokens[seat] });
        await client.wait(m => m.type === 'snapshot');
        assert.equal(client.latestSnapshot().personalHash, hashes[seat]);
      }
      const [finalA, finalB] = resumed;
      await syncBoth(env, finalA, finalB, finalA.latestSnapshot(), finalB.latestSnapshot());
      finalA.send(envelope);
      assert.deepEqual(await finalA.wait(m => m.type === 'actionReceipt' && m.actionId === envelope.actionId), receipt);
      const conflict = finalA.next(m => m.type === 'error' && m.code === 'ACTION_ID_CONFLICT');
      finalA.send({ ...envelope, action: { ...action, pokemonId: initial.personal.party[2].id } });
      await conflict;
      const restored = (await disk.store.load()).find(r => r.roomId === room.roomId);
      assert.equal(canonical(restored.checkpoint), committed);
      assert.deepEqual(restored.inputs, {});
      assert.equal(canonical((await disk.store.load()).find(r => r.roomId === isolated.roomId).checkpoint), isolatedBefore);
    } finally { if (env) await env.close(); await disk.cleanup(); }
  });

test('VS-02B-09 ordinary capture survives single-input restart, candidate retry, deduplication and room isolation',
  { timeout: 180000 }, async () => {
    const disk = await temporaryStore(); let env, rejectRevision = null;
    const fixture = { seed: 'capture-review-5', identity: { trainerId: 1, secretId: 2 },
      parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } };
    const guardedStore = () => {
      const store = new FormalRoomStore(disk.directory);
      return { load: () => store.load(), save: room => {
        if (room.revision === rejectRevision) throw Error('capture candidate disk failure');
        return store.save(room);
      } };
    };
    const fight = snapshot => snapshot.personal.decision.options.find(o => o.kind === 'fight' && (o.target === null || o.target >= 2));
    try {
      env = await startEnv({ fixture, store: guardedStore() });
      const room = await createRoom(env);
      let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
      for (let turn = 0; turn < 10 && !state.sb.personal.decision.options.some(o => o.kind === 'ball'); turn++)
        state = await submitBoth(env, room, state.sa, state.sb, [fight(state.sa), fight(state.sb)]);
      const isolated = await createRoom(env);
      const isolatedBefore = canonical(env.service.rooms.get(isolated.roomId).checkpoint);
      const initial = state.sb;
      const action = initial.personal.decision.options.find(o => o.kind === 'ball' && o.pokeballType === 0);
      assert.ok(action, 'legal ordinary ball from actual native options');
      const tokens = [room.a, room.b].map(c => c.messages.find(m => m.type === 'welcome' && m.roomId).resumeToken);
      const envelope = { type: 'submitAction', roomId: room.roomId, runId: room.runId,
        decisionId: initial.decisionId, expectedRevision: initial.revision, actionId: 'capture-durable', action };
      const before = canonical(env.service.rooms.get(room.roomId).checkpoint);
      room.b.send(envelope);
      const receipt = await room.b.wait(m => m.type === 'actionReceipt' && m.actionId === envelope.actionId);
      assert.equal(receipt.accepted, true);
      const single = (await disk.store.load()).find(r => r.roomId === room.roomId);
      assert.equal(single.revision, initial.revision);
      assert.deepEqual(single.inputs, { 1: action });
      assert.equal(canonical(single.checkpoint), before);
      await env.close(); env = null;
      env = await startEnv({ fixture, store: guardedStore() });
      const clients = [await connect(env, 'capture-resume-A'), await connect(env, 'capture-resume-B')];
      for (const [seat, client] of clients.entries()) {
        client.send({ type: 'resumeSeat', roomId: room.roomId, resumeToken: tokens[seat] });
        await client.wait(m => m.type === 'snapshot');
      }
      const [a, b] = clients;
      state = await syncBoth(env, a, b, a.latestSnapshot(), b.latestSnapshot());
      rejectRevision = initial.revision + 1;
      const failure = a.next(m => m.type === 'error' && m.code === 'STORAGE_FAILED');
      await submit(a, state.sa, fight(state.sa)); await failure;
      const failed = (await disk.store.load()).find(r => r.roomId === room.roomId);
      assert.equal(failed.revision, initial.revision);
      assert.equal(canonical(failed.checkpoint), before);
      assert.equal(Object.keys(failed.inputs).length, 2);
      rejectRevision = null;
      const counts = [a.snapshots.length, b.snapshots.length];
      a.send({ type: 'requestSnapshot', roomId: room.roomId, runId: room.runId,
        knownRevision: initial.revision, reason: 'retry-capture-save' });
      await syncBoth(env, a, b, await a.waitSnapshotCount(counts[0]), await b.waitSnapshotCount(counts[1]));
      state = await syncBoth(env, a, b, await a.waitRevisionAfter(initial.revision), await b.waitRevisionAfter(initial.revision));
      assert.equal(state.sa.revision, initial.revision + 1);
      assert.equal(state.sa.personal.reserve.length, 0);
      assert.equal(state.sb.personal.reserve.length, 0);
      assert.equal(state.sb.personal.party.length,4);
      assert.equal(state.sb.personal.resources.pokeballs[0], initial.personal.resources.pokeballs[0] - 1);
      assert.equal(state.sb.shared.field.includes(action.targetId), false);
      const stored = env.service.rooms.get(room.roomId).checkpoint;
      const pending = stored.intents.find(i => i.type === 'capture-pending');
      assert.equal(pending.owner, 1);
      assert.equal(pending.status, 'pending');
      assert.equal(pending.payload.pokemonId, state.sb.personal.party.find(e=>e.id===0).id);
      assert.equal(pending.payload.sourcePokemonId, action.targetId);
      const committed = canonical(stored), hashes = [state.sa.personalHash, state.sb.personalHash];
      await env.close(); env = null;
      env = await startEnv({ fixture, store: new FormalRoomStore(disk.directory) });
      const resumed = [await connect(env, 'capture-final-A'), await connect(env, 'capture-final-B')];
      for (const [seat, client] of resumed.entries()) {
        client.send({ type: 'resumeSeat', roomId: room.roomId, resumeToken: tokens[seat] });
        await client.wait(m => m.type === 'snapshot');
        assert.equal(client.latestSnapshot().personalHash, hashes[seat]);
      }
      const [finalA, finalB] = resumed;
      await syncBoth(env, finalA, finalB, finalA.latestSnapshot(), finalB.latestSnapshot());
      finalB.send(envelope);
      assert.deepEqual(await finalB.wait(m => m.type === 'actionReceipt' && m.actionId === envelope.actionId), receipt);
      const conflict = finalB.next(m => m.type === 'error' && m.code === 'ACTION_ID_CONFLICT');
      finalB.send({ ...envelope, action: { ...action, targetId: action.targetId + 1 } }); await conflict;
      assert.equal(canonical((await disk.store.load()).find(r => r.roomId === room.roomId).checkpoint), committed);
      assert.equal(canonical((await disk.store.load()).find(r => r.roomId === isolated.roomId).checkpoint), isolatedBefore);
      state = await syncBoth(env, finalA, finalB, finalA.latestSnapshot(), finalB.latestSnapshot());
      assert.equal(state.sa.personal.decision.kind, 'preparation');
      const resumedRoom = { ...room, a: finalA, b: finalB };
      state = await finishSwitches(env, resumedRoom, await finishPreparation(env, resumedRoom, state));
      const nextRevision = state.sa.revision;
      state = await submitBoth(env, resumedRoom, state.sa, state.sb, [fightAction(state.sa), fightAction(state.sb)]);
      assert.ok(state.sa.revision > nextRevision, 'both actual FIGHT inputs advance the next encounter');
      assert.equal(state.sb.personal.reserve.length, 0);
      assert.equal(state.sb.personal.party.length,4);
    } finally { if (env) await env.close(); await disk.cleanup(); }
  });

for (const decline of [false,true]) test(`VS-02B-10 full capture ${decline?'decline':'release'}: formal disk failure/restart/dedupe/isolation and next FIGHT`,
 {timeout:180000},async()=>{
  const native=await fullCaptureChoice();await native.h.close();
  const disk=await temporaryStore();let env,rejectRevision=null;
  const fixture={seed:native.before.scene.seed,identities:[{trainerId:1,secretId:2},{trainerId:3,secretId:4}],
   parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}};
  const store=()=>{const real=new FormalRoomStore(disk.directory);return {load:()=>real.load(),save:room=>{
   if(room.revision===rejectRevision)throw Error('capture choice candidate failure');return real.save(room);
  }}};
  const start=()=>startEnv({fixture,store:store(),initialCheckpoint:native.before});
  try {
   env=await start();const room=await createRoom(env);
   let state=await syncBoth(env,room.a,room.b,room.sa,room.sb);
   const isolated=await createRoom(env),isolatedBefore=canonical(env.service.rooms.get(isolated.roomId).checkpoint);
   state=await submitBoth(env,room,state.sa,state.sb,[fightAction(state.sa),state.sb.personal.decision.options.find(o=>o.kind==='ball'&&o.pokeballType===4)]);
   assert.equal(state.sb.personal.decision.kind,'capture-choice');
   assert.equal(state.sb.personal.party.length,6);assert.equal(state.sb.personal.reserve.length,0);
   assert.equal(state.sb.personal.resources.pokeballs[4],0);
   const initial=state.sb,peer=state.sa;
   const action=initial.personal.decision.options.find(o=>decline?o.releaseId===null:o.releaseId!==null);
   const before=canonical(env.service.rooms.get(room.roomId).checkpoint);
   const tokens=[room.a,room.b].map(c=>c.messages.find(m=>m.type==='welcome'&&m.roomId).resumeToken);
   // Restart while the original capture itself is suspended, before choosing.
   await env.close();env=await start();
   const resume=async()=>{const clients=[await connect(env,'choice-A'),await connect(env,'choice-B')];
    for(const [seat,client] of clients.entries()){client.send({type:'resumeSeat',roomId:room.roomId,resumeToken:tokens[seat]});await client.wait(m=>m.type==='snapshot')}
    return clients;
   };
   let [a,b]=await resume();state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
   assert.equal(state.sb.personal.decision.kind,'capture-choice');assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),before);
   const envelope={type:'submitAction',roomId:room.roomId,runId:room.runId,decisionId:initial.decisionId,
    expectedRevision:initial.revision,actionId:'choice-durable',action};
   rejectRevision=initial.revision+1;
   const failure=b.next(m=>m.type==='error'&&m.code==='STORAGE_FAILED');b.send(envelope);
   const receipt=await b.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId);assert.equal(receipt.accepted,true);await failure;
   const failed=(await disk.store.load()).find(r=>r.roomId===room.roomId);
   assert.equal(failed.revision,initial.revision);assert.equal(canonical(failed.checkpoint),before);assert.deepEqual(failed.inputs,{1:action});
   assert.equal(a.latestSnapshot().revision,initial.revision);
   await env.close();env=null;rejectRevision=null;env=await start();[a,b]=await resume();
   state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
   if(state.sb.revision===initial.revision)state=await syncBoth(env,a,b,await a.waitRevisionAfter(initial.revision),await b.waitRevisionAfter(initial.revision));
   assert.equal(state.sb.revision,initial.revision+1);assert.equal(state.sb.personal.party.length,6);assert.equal(state.sb.personal.reserve.length,0);
   assert.deepEqual(state.sb.personal.resources,initial.personal.resources);assert.deepEqual(state.sa.personal.resources,peer.personal.resources);
   assert.deepEqual(state.sa.personal.party.map(e=>e.id),peer.personal.party.map(e=>e.id));
   assert.deepEqual(state.sb.personal.eggs,initial.personal.eggs);
   const saved=env.service.rooms.get(room.roomId).checkpoint;
   const pending=saved.intents.filter(i=>i.type==='capture-pending');assert.equal(pending.length,1);assert.equal(pending[0].owner,1);assert.equal(pending[0].status,'pending');
   if(decline){assert.deepEqual(state.sb.personal.party.map(e=>e.id),initial.personal.party.map(e=>e.id));assert.equal(state.sb.personal.party.some(e=>e.id===0),false)}
   else {
    assert.equal(state.sb.personal.party.some(e=>e.id===action.releaseId),false);assert.ok(saved.nativeCheckpoint.roster.retiredIds.includes(action.releaseId));
    if(action.releaseId===initial.shared.field[1])assert.equal(state.sb.shared.field[1],null);
    const caught=state.sb.personal.party.find(e=>e.id===0);assert.ok(caught);assert.equal(pending[0].payload.pokemonId,caught.id);
    assert.deepEqual(pending[0].payload.pokemon,caught.pokemon);
    assert.equal(saved.intents.find(i=>i.type==='dex-ivs'&&i.payload.sourcePokemonId===pending[0].payload.sourcePokemonId).payload.pokemonId,caught.id);
   }
   const committed=canonical(saved),hashes=[state.sa.personalHash,state.sb.personalHash];
   await env.close();env=await start();[a,b]=await resume();state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
   assert.deepEqual([state.sa.personalHash,state.sb.personalHash],hashes);
   b.send(envelope);assert.deepEqual(await b.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId),receipt);
   const conflict=b.next(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT');b.send({...envelope,action:{...action,releaseId:decline?initial.personal.party[1].id:null}});await conflict;
   assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===room.roomId).checkpoint),committed);
   assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===isolated.roomId).checkpoint),isolatedBefore);
   const nextActor=decline?state.sb.personal.party.find(e=>e.index>0&&e.pokemon.fields.hp>0).id:0;
   const resumed={...room,a,b};state=await finishSwitches(env,resumed,await finishPreparation(env,resumed,state),nextActor);
   if(!decline)assert.equal(state.sb.shared.field[1],0);
   const revision=state.sb.revision,actionB=fightAction(state.sb);
   const pp=state.sb.personal.party[0].pokemon.fields.moveset[actionB.cursor].fields.ppUsed;
   state=await submitBoth(env,resumed,state.sa,state.sb,[fightAction(state.sa),actionB]);assert.ok(state.sb.revision>revision);
   assert.equal(state.sb.personal.party[0].pokemon.fields.moveset[actionB.cursor].fields.ppUsed,pp+1);
  }finally{if(env)await env.close();await disk.cleanup()}
 });

test('VS-02B-10 old capture migration persists explicit release across failure/restart and preserves pending collection facts',
 {timeout:120000},async()=>{
  const native=await capturedPreparation();await native.h.close();
  const checkpoint=native.c,entries=checkpoint.roster.entries;
  const captured=entries.find(e=>e.owner===1&&e.pokemon.fields.id===0);captured.group='reserve';captured.index=0;
  // Explicit legacy full-party checkpoint, not a forged browser acceptance.
  for(let index=3;index<6;index++){const e=structuredClone(entries.find(e=>e.owner===1&&e.group==='party'&&e.index===1));e.index=index;e.pokemon.fields.id=4000000000+index;entries.push(e)}
  const pending=[{id:'synthetic-legacy-capture-fact',owner:1,source:'scene',recipient:null,type:'capture-pending',
    payload:{kind:'capture-pending',pokemonId:0,pokemon:structuredClone(captured.pokemon)},status:'pending'}];
  const disk=await temporaryStore();let env,rejectRevision=null;
  const fixture={seed:checkpoint.scene.seed,identity:{trainerId:1,secretId:2},parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}};
  const start=()=>{const actual=new FormalRoomStore(disk.directory);return startEnv({fixture,initialCheckpoint:checkpoint,initialIntents:pending,
    store:{load:()=>actual.load(),save:room=>{if(room.revision===rejectRevision)throw Error('legacy choice disk failure');return actual.save(room)}}})};
  try{
   env=await start();const room=await createRoom(env);let state=await syncBoth(env,room.a,room.b,room.sa,room.sb);
   const isolated=await createRoom(env),isolatedBefore=canonical(env.service.rooms.get(isolated.roomId).checkpoint);
   const initial=state.sb,action=initial.personal.decision.legacyCapture.options.find(o=>o.choice==='keep');
   assert.equal(action.pokemonId,0);assert.notEqual(action.releaseId,null);
   const before=canonical(env.service.rooms.get(room.roomId).checkpoint),tokens=[room.a,room.b].map(c=>c.messages.find(m=>m.type==='welcome'&&m.roomId).resumeToken);
   const envelope={type:'submitAction',roomId:room.roomId,runId:room.runId,decisionId:initial.decisionId,expectedRevision:initial.revision,actionId:'legacy-choice-durable',action};
   rejectRevision=initial.revision+1;const fail=room.b.next(m=>m.type==='error'&&m.code==='STORAGE_FAILED');room.b.send(envelope);
   const receipt=await room.b.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId);assert.equal(receipt.accepted,true);await fail;
   const saved=(await disk.store.load()).find(r=>r.roomId===room.roomId);assert.equal(canonical(saved.checkpoint),before);assert.deepEqual(saved.inputs,{1:action});
   await env.close();env=null;rejectRevision=null;env=await start();
   const resume=async()=>{const clients=[await connect(env,'legacy-A'),await connect(env,'legacy-B')];
    for(const [seat,client] of clients.entries()){client.send({type:'resumeSeat',roomId:room.roomId,resumeToken:tokens[seat]});await client.wait(m=>m.type==='snapshot')}return clients};
   let [a,b]=await resume();state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
   if(state.sb.revision===initial.revision)state=await syncBoth(env,a,b,await a.waitRevisionAfter(initial.revision),await b.waitRevisionAfter(initial.revision));
   assert.equal(state.sb.personal.party.length,6);assert.equal(state.sb.personal.reserve.length,0);assert.equal(state.sb.personal.decision.legacyCapture,undefined);
   assert.deepEqual(state.sb.personal.party.find(e=>e.id===0).pokemon,captured.pokemon);
   assert.equal(state.sb.personal.party.some(e=>e.id===action.releaseId),false);
   if(action.releaseId===initial.shared.field[1])assert.equal(state.sb.shared.field[1],null);
   assert.deepEqual(state.sb.personal.resources,initial.personal.resources);assert.deepEqual(state.sb.personal.eggs,initial.personal.eggs);
   const committed=canonical(env.service.rooms.get(room.roomId).checkpoint);assert.deepEqual(JSON.parse(committed).intents,pending);
   await env.close();env=await start();[a,b]=await resume();state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
   b.send(envelope);assert.deepEqual(await b.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId),receipt);
   const conflict=b.next(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT');b.send({...envelope,action:{...action,choice:'discard',releaseId:null}});await conflict;
   assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===room.roomId).checkpoint),committed);
   assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===isolated.roomId).checkpoint),isolatedBefore);
   const resumed={...room,a,b};state=await finishSwitches(env,resumed,await finishPreparation(env,resumed,state),0);
   assert.equal(state.sb.shared.field[1],0);const revision=state.sb.revision;
   state=await submitBoth(env,resumed,state.sa,state.sb,[fightAction(state.sa),fightAction(state.sb)]);assert.ok(state.sb.revision>revision);
  }finally{if(env)await env.close();await disk.cleanup()}
 });

test('VS-02B-10 natural combat faint resumes an owned forced switch after formal service/Worker restart',
  { timeout: 180000 }, async () => {
    const disk = await temporaryStore(); let env;
    const fixture = { seed: 'team-forced-ws', identity: { trainerId: 1, secretId: 2 },
      parties: [[7, 4, 1], [129, 906, 909]], eggState: { players: [[], []] } };
    try {
      env = await startEnv({ fixture, store: disk.store });
      const room = await createRoom(env);
      let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
      for (let turn = 0; turn < 40 && state.sa.personal.decision.kind === 'wait-actions'; turn++) {
        const status = snapshot => {
          const moves = snapshot.personal.party[0].pokemon.fields.moveset;
          const cursor = moves.findIndex(m => [39, 150].includes(m.fields.moveId)); // Original Tail Whip / Splash, no inflicted damage.
          const option = snapshot.personal.decision.options.find(o => o.kind === 'fight' && o.cursor === cursor);
          assert.ok(option); return option;
        };
        state = await submitBoth(env, room, state.sa, state.sb, [status(state.sa), status(state.sb)]);
      }
      assert.equal(state.sa.personal.decision.kind, 'wait-switch');
      const seat = state.sa.personal.decision.requiredSeats[0], snapshot = seat === 0 ? state.sa : state.sb;
      const action = snapshot.personal.decision.options[0], peerId = snapshot.shared.field[1 - seat];
      assert.equal(snapshot.personal.party.find(e => e.id === snapshot.shared.field[seat]).pokemon.fields.hp, 0);
      assert.ok(action && snapshot.personal.party.some(e => e.id === action.pokemonId));
      const tokens = [room.a, room.b].map(c => c.messages.find(m => m.type === 'welcome' && m.roomId).resumeToken);
      const hash = [state.sa.personalHash, state.sb.personalHash];
      await env.close(); env = null;
      env = await startEnv({ fixture, store: new FormalRoomStore(disk.directory) });
      const clients = [await connect(env, 'forced-A'), await connect(env, 'forced-B')];
      for (const [s, client] of clients.entries()) {
        client.send({ type: 'resumeSeat', roomId: room.roomId, resumeToken: tokens[s] });
        await client.wait(m => m.type === 'snapshot');
        assert.equal(client.latestSnapshot().personalHash, hash[s]);
      }
      const [a, b] = clients, resumedRoom = { ...room, a, b };
      state = await syncBoth(env, a, b, a.latestSnapshot(), b.latestSnapshot());
      state = await submitOne(env, resumedRoom, clients[seat], seat === 0 ? state.sa : state.sb, action);
      assert.equal(state.sa.shared.field[seat], action.pokemonId);
      assert.equal(state.sa.shared.field[1 - seat], peerId);
      assert.equal(state.sa.personal.decision.kind, 'wait-actions');
      const revision = state.sa.revision;
      state = await submitBoth(env, resumedRoom, state.sa, state.sb, [fightAction(state.sa), fightAction(state.sb)]);
      assert.ok(state.sa.revision > revision);
    } finally { if (env) await env.close(); await disk.cleanup(); }
  });

for (const slot of [1, null]) test(`VS-02B-11 native learning slot=${slot}: formal storage rollback/restart/dedupe/isolation and next FIGHT`,
 { timeout: 120000 }, async () => {
  // Explicit synthetic learning queue; all projection/validation/advance and
  // subsequent combat use the production adapter and real room Worker.
  const native = await learningFixture({ seat: 1, moveId: 52 });
  const paused = (await native.h.request('native-run-to-boundary', native.c)).checkpoint;
  await native.h.close();
  const disk = await temporaryStore(); let env, rejectRevision = null;
  const fixture = { seed: paused.scene.seed, identities: [{trainerId:1,secretId:2},{trainerId:3,secretId:4}],
    parties:[[1,4,7],[906,909,912]], eggState:{players:[[],[]]} };
  const start = () => { const actual = new FormalRoomStore(disk.directory);
    return startEnv({ fixture, initialCheckpoint: paused, store: { load: () => actual.load(), save: room => {
      if (room.revision === rejectRevision) throw Error('synthetic learning candidate disk failure');
      return actual.save(room);
    } } });
  };
  try {
    env = await start(); const room = await createRoom(env);
    let state = await syncBoth(env, room.a, room.b, room.sa, room.sb);
    const isolated = await createRoom(env), isolatedBefore = canonical(env.service.rooms.get(isolated.roomId).checkpoint);
    const initial = state.sb, peer = state.sa, before = canonical(env.service.rooms.get(room.roomId).checkpoint);
    assert.equal(initial.personal.decision.kind, 'learn-move');
    assert.deepEqual(initial.personal.decision.learn, paused.decision.learn);
    const tokens = [room.a,room.b].map(c => c.messages.find(m => m.type === 'welcome' && m.roomId).resumeToken);
    const resume = async () => { const clients = [await connect(env,'learn-A'),await connect(env,'learn-B')];
      for (const [seat,client] of clients.entries()) {
        client.send({type:'resumeSeat',roomId:room.roomId,resumeToken:tokens[seat]}); await client.wait(m=>m.type==='snapshot');
      }
      return clients;
    };
    await env.close(); env = await start(); let [a,b] = await resume();
    state = await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),before);
    const action = initial.personal.decision.options.find(o => o.slot === slot);
    const envelope = {type:'submitAction',roomId:room.roomId,runId:room.runId,decisionId:initial.decisionId,
      expectedRevision:initial.revision,actionId:'learn-durable',action};
    rejectRevision = initial.revision + 1;
    const failure = b.next(m => m.type==='error' && m.code==='STORAGE_FAILED'); b.send(envelope);
    const receipt = await b.wait(m => m.type==='actionReceipt' && m.actionId===envelope.actionId);
    assert.equal(receipt.accepted,true,receipt.code); await failure;
    const failed = (await disk.store.load()).find(r=>r.roomId===room.roomId);
    assert.equal(failed.revision,initial.revision); assert.equal(canonical(failed.checkpoint),before);
    assert.deepEqual(failed.inputs,{1:action});
    await env.close(); rejectRevision=null; env=await start(); [a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    if(state.sb.revision===initial.revision) state=await syncBoth(env,a,b,await a.waitRevisionAfter(initial.revision),await b.waitRevisionAfter(initial.revision));
    assert.equal(state.sb.revision,initial.revision+1);
    assert.equal(state.sb.personal.decision.kind,'wait-actions');
    assert.deepEqual(state.sa.personal.party,peer.personal.party);
    assert.deepEqual(state.sb.personal.eggs,initial.personal.eggs);
    assert.deepEqual(state.sb.personal.resources,initial.personal.resources);
    const expected=structuredClone(initial.personal.party[0].pokemon.fields.moveset);
    if(slot!==null) expected[slot]={type:'PokemonMove',fields:{moveId:52,ppUsed:0,ppUp:0,virtual:false},undefinedFields:[]};
    assert.deepEqual(state.sb.personal.party[0].pokemon.fields.moveset,expected);
    const committed=canonical(env.service.rooms.get(room.roomId).checkpoint);
    await env.close(); env=await start(); [a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),committed);
    b.send(envelope); assert.deepEqual(await b.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId),receipt);
    const conflict=b.next(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT');
    b.send({...envelope,action:{...action,slot:slot===null?0:null}}); await conflict;
    assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===isolated.roomId).checkpoint),isolatedBefore);
    const attack=slot===null?fightAction(state.sb):state.sb.personal.decision.options.find(o=>o.kind==='fight'&&o.cursor===slot&&o.target>=2);
    assert.ok(attack);
    const pp=state.sb.personal.party[0].pokemon.fields.moveset[attack.cursor].fields.ppUsed;
    state=await submitBoth(env,{...room,a,b},state.sa,state.sb,[fightAction(state.sa),attack]);
    assert.ok(state.sb.revision>initial.revision+1);
    assert.equal(state.sb.personal.party[0].pokemon.fields.moveset[attack.cursor].fields.ppUsed,pp+1);
  } finally { if(env) await env.close(); await disk.cleanup(); }
 });

for (const slot of [0,null]) test(`VS-02B-11R natural level-6 learning slot=${slot}: real WS durable retry/restart and move FIGHT`,
 {timeout:120000}, async()=>{
  const natural=await naturalLearning(); const checkpoint=natural.c; await natural.h.close();
  const disk=await temporaryStore();let env,rejectRevision=null;
  const fixture={seed:checkpoint.scene.seed,identities:[{trainerId:1,secretId:2},{trainerId:3,secretId:4}],
    parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}};
  // Only initial context injection: checkpoint came from untouched normal
  // selected entry and actual battles. All formal actions use the production adapter.
  const start=()=>{const real=new FormalRoomStore(disk.directory);return startEnv({fixture,initialCheckpoint:checkpoint,
    store:{load:()=>real.load(),save:room=>{if(room.revision===rejectRevision)throw Error('natural learning candidate failure');return real.save(room);}}});};
  try{
    env=await start();const room=await createRoom(env);
    let state=await syncBoth(env,room.a,room.b,room.sa,room.sb);
    assert.equal(state.sa.shared.waveIndex,4);assert.equal(state.sa.personal.decision.learn.moveId,61);
    assert.equal(state.sb.personal.decision.learn,null);
    const isolated=await createRoom(env),isolatedBefore=canonical(env.service.rooms.get(isolated.roomId).checkpoint);
    const initial=state.sa,peer=state.sb,before=canonical(env.service.rooms.get(room.roomId).checkpoint);
    const tokens=[room.a,room.b].map(c=>c.messages.find(m=>m.type==='welcome'&&m.roomId).resumeToken);
    const resume=async()=>{const clients=[await connect(env,'natural-learn-A'),await connect(env,'natural-learn-B')];
      for(const [seat,client]of clients.entries()){client.send({type:'resumeSeat',roomId:room.roomId,resumeToken:tokens[seat]});await client.wait(m=>m.type==='snapshot');}
      return clients;};
    await env.close();env=await start();let [a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),before);
    const action=initial.personal.decision.options.find(o=>o.slot===slot);
    const envelope={type:'submitAction',roomId:room.roomId,runId:room.runId,decisionId:initial.decisionId,
      expectedRevision:initial.revision,actionId:'natural-learn',action};
    rejectRevision=initial.revision+1;const failure=a.next(m=>m.type==='error'&&m.code==='STORAGE_FAILED');a.send(envelope);
    const receipt=await a.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId);assert.equal(receipt.accepted,true);await failure;
    const failed=(await disk.store.load()).find(r=>r.roomId===room.roomId);
    assert.equal(canonical(failed.checkpoint),before);assert.deepEqual(failed.inputs,{0:action});
    await env.close();rejectRevision=null;env=await start();[a,b]=await resume();
    state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    if(state.sa.revision===initial.revision)state=await syncBoth(env,a,b,await a.waitRevisionAfter(initial.revision),await b.waitRevisionAfter(initial.revision));
    assert.equal(state.sa.revision,initial.revision+1);assert.equal(state.sa.personal.decision.kind,'wait-actions');
    const expected=structuredClone(initial.personal.party[0].pokemon.fields.moveset);
    if(slot!==null)expected[slot]={type:'PokemonMove',fields:{moveId:61,ppUsed:0,ppUp:0,virtual:false},undefinedFields:[]};
    assert.deepEqual(state.sa.personal.party[0].pokemon.fields.moveset,expected);
    assert.deepEqual(state.sb.personal.party[0].pokemon.fields.moveset,peer.personal.party[0].pokemon.fields.moveset,'queued peer EXP cannot change its moves');
    assert.deepEqual(state.sa.personal.resources,initial.personal.resources);
    const committed=canonical(env.service.rooms.get(room.roomId).checkpoint);
    await env.close();env=await start();[a,b]=await resume();state=await syncBoth(env,a,b,a.latestSnapshot(),b.latestSnapshot());
    assert.equal(canonical(env.service.rooms.get(room.roomId).checkpoint),committed);
    a.send(envelope);assert.deepEqual(await a.wait(m=>m.type==='actionReceipt'&&m.actionId===envelope.actionId),receipt);
    const conflict=a.next(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT');a.send({...envelope,action:{...action,slot:slot===null?0:null}});await conflict;
    assert.equal(canonical((await disk.store.load()).find(r=>r.roomId===isolated.roomId).checkpoint),isolatedBefore);
    const attack=state.sa.personal.decision.options.find(o=>o.kind==='fight'&&o.cursor===0&&(o.target===null||o.target>=2));
    const defense=state.sb.personal.decision.options.find(o=>o.kind==='fight'&&state.sb.personal.party[0].pokemon.fields.moveset[o.cursor].fields.moveId===111);
    assert.ok(attack&&defense);
    const pp=state.sa.personal.party[0].pokemon.fields.moveset[0].fields.ppUsed;
    state=await submitBoth(env,{...room,a,b},state.sa,state.sb,[attack,defense]);
    assert.equal(state.sa.personal.party[0].pokemon.fields.moveset[0].fields.moveId,slot===null?55:61);
    assert.equal(state.sa.personal.party[0].pokemon.fields.moveset[0].fields.ppUsed,pp+1);
    assert.ok(state.sa.events.some(e=>e.kind==='phase-start'&&e.phase==='MoveEffectPhase'));
  }finally{if(env)await env.close();await disk.cleanup();}
 });
