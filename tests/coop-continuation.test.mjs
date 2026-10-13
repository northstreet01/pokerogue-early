import test from 'node:test';
import assert from 'node:assert/strict';
import { codec } from './helpers/decision-model.mjs';
import { switchFinishContext, continueSwitchFinishes, finishHandler } from './helpers/continuation-model.mjs';
import { formalFixture } from './helpers/formal-ws.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';
import { prependPhase } from '../src/battle-core/phase-queue.mjs';

// Acknowledged test gate around the saved onEnd tail, NOT a production turn
// runner. The original post-summon hazards/abilities remain explicitly pending.
function adapterFor(batonPass) {
  return {rulesVersion:'m2-continuation-test',contentHash:'synthetic-catalog',
    createInitialContext:()=>switchFinishContext(batonPass),captureCheckpoint:codec.capture,
    validateCheckpoint:codec.validate,restoreCheckpoint:codec.restore,
    describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats}),
    validateAction:codec.validateAction,advanceToDecision:continueSwitchFinishes,
    projectSnapshot:c=>({shared:codec.capture(c),personal:{}})};
}
async function connect(f,adapter,identities) {
  const pair=[await f.client(),await f.client()];
  for(const [seat,c] of pair.entries()) {
    c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}:seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',roomId:pair[0].identity.roomId,name:'B'});
    c.identity=await c.wait(m=>m.type==='welcome');
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.send(m),adapter:{
      applySnapshot(s){const candidate=codec.restore(s.shared);c.model=candidate;},
      captureAppliedState:()=>adapter.projectSnapshot(c.model),async applyGrantsTransaction(g){assert.deepEqual(g,[]);}
    }});
  }
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot');await c.consume(c.snapshot);}
  await pair[0].wait(m=>m.type==='syncStatus'&&!m.blocked);return pair;
}
const submit=c=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:'once-'+c.identity.seat,action:c.model.decision.options[c.identity.seat][0]});
function uninterrupted(baton) {
  const c=switchFinishContext(baton),events=[];
  for(const d of c.continuation.phaseQueue)events.push(...finishHandler(c,d));
  c.continuation.phaseQueue=[];prependPhase(c.continuation,{kind:'post-summon',fieldIndex:0,pokemonId:100});c.decision.id+='-finished';
  return {context:c,events};
}
for(const baton of [false,true])for(const firstSeat of [0,1])test(`real WS queued switch finish resumes after seat ${firstSeat} input, baton=${baton}`,async()=>{
  const adapter=adapterFor(baton),reference=uninterrupted(baton);let f=await formalFixture(adapter);
  try {
    let pair=await connect(f,adapter);const identities=pair.map(c=>c.identity),roomId=identities[0].roomId;
    const pending=submit(pair[firstSeat]);pair[firstSeat].send(pending);await pair[firstSeat].wait(m=>m.type==='actionReceipt'&&m.accepted);
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.equal(pair[0].model.continuation.phaseQueue.length,2);
    assert.notEqual(pair[0].model.roster.entries[0].pokemon,pair[1].model.roster.entries[0].pokemon);
    pair[firstSeat].send(pending);await pair[firstSeat].wait(m=>m.type==='actionReceipt'&&m.accepted);
    pair[1-firstSeat].send(submit(pair[1-firstSeat]));await pair[1-firstSeat].wait(m=>m.type==='actionReceipt'&&m.accepted);
    for(const c of pair){const s=await c.wait(m=>m.type==='snapshot'&&m.revision===1);assert.deepEqual(s.events,reference.events);await c.consume(s);assert.deepEqual(codec.capture(c.model),codec.capture(reference.context));}
    await pair[0].wait(m=>m.type==='syncStatus'&&m.revision===1&&!m.blocked);
    assert.deepEqual(f.rooms.get(roomId).checkpoint,codec.capture(reference.context));
    // Restart once more after commit: transferred stages and remaining work
    // survive and replayed inputs do not rerun the old reset or achievement hook.
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    pair[firstSeat].send(pending);await pair[firstSeat].wait(m=>m.type==='actionReceipt'&&m.accepted);
    assert.equal(f.rooms.get(roomId).revision,1);assert.deepEqual(f.rooms.get(roomId).checkpoint,codec.capture(reference.context));
  } finally {await f.close();}
});

test('switch tail commit failure retains pending queue and both inputs; retry has identical events/state',async()=>{
  const adapter=adapterFor(true),store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  const f=await formalFixture(adapter,store);
  try {
    const pair=await connect(f,adapter),roomId=pair[0].identity.roomId,before=copy(f.rooms.get(roomId).checkpoint);store.fail=true;
    for(const c of pair){c.send(submit(c));await c.wait(m=>m.type==='actionReceipt'&&m.accepted);}
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(roomId).checkpoint,before);assert.equal(Object.keys(store.data.get(roomId).inputs).length,2);
    store.fail=false;pair.forEach(c=>{c.messages=[];});
    pair[0].send({type:'requestSnapshot',roomId,runId:pair[0].snapshot.runId,knownRevision:0,reason:'retry'});
    for(const c of pair)await c.consume(await c.wait(m=>m.type==='snapshot'&&m.revision===0));
    const expected=uninterrupted(true);
    for(const c of pair){const s=await c.wait(m=>m.type==='snapshot'&&m.revision===1);assert.deepEqual(s.events,expected.events);await c.consume(s);assert.deepEqual(codec.capture(c.model),codec.capture(expected.context));}
  } finally {store.fail=false;await f.close();}
});

test('unknown persisted continuation blocks recovery without rewriting the room',async()=>{
  const adapter=adapterFor(true);let f=await formalFixture(adapter);
  try {
    const pair=await connect(f,adapter),identity=pair[0].identity,store=f.store;await f.close();
    const room=store.data.get(identity.roomId);room.checkpoint.continuation.phaseQueue[0].kind='arbitrary-phase';const before=copy(room);
    f=await formalFixture(adapter,store);const c=await f.client();c.send({type:'resumeSeat',roomId:identity.roomId,resumeToken:identity.resumeToken});
    assert.equal((await c.wait(m=>m.type==='error')).code,'UNSUPPORTED_CONTINUATION');assert.deepEqual(store.data.get(identity.roomId),before);assert.equal(c.messages.some(m=>m.type==='snapshot'),false);
  } finally {await f.close();}
});
