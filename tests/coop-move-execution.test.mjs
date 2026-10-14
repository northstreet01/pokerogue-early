import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {actionContext,advanceAction,runAction} from './helpers/move-execution-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

// Test adapter stops after MovePhase. Pending MoveEffect is deliberately kept;
// the remaining damage/ability/turn runner is not replaced with a fake result.
const adapterFor=seat=>({...safeAdapter('ended'),rulesVersion:'native-move-action-test',
  createInitialContext:()=>actionContext(seat),advanceToDecision:advanceAction,
  describeDecision:c=>({id:c.decision.id,requiredSeats:[],collection:c.decision.id==='action-before'?'auto':'all'})});
for(const seat of [0,1])test(`real WS original move action resumes after restart and spends PP once, owner=${seat}`,async()=>{
  const adapter=adapterFor(seat);let f=await formalFixture(adapter);
  try{
    let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    const before=copy(f.rooms.get(id).checkpoint),reference=runAction(codec.restore(before),{reference:true,clone:false});
    reference.context.decision.id='action-before:move';
    const oldAck=pair[0].acks.shift();pair[0].send(oldAck);await pair[0].wait(m=>m.type==='syncStatus'&&m.blocked);
    assert.equal(f.rooms.get(id).revision,0);
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    pair[0].send(oldAck);await pair[0].wait(m=>m.type==='error');assert.equal(f.rooms.get(id).revision,0);
    for(const c of pair)c.send(c.acks.shift());
    for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===1);await c.consume(c.snapshot);
      assert.deepEqual(c.snapshot.events,reference.events);assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(reference.context,c.identity.seat));}
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference.context));
    const pp=reference.context.roster.entries[seat].pokemon.moveset[0].ppUsed;
    const committed=copy(f.rooms.get(id).checkpoint);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.equal(pair[seat].model.roster.entries[seat].pokemon.moveset[0].ppUsed,pp);assert.deepEqual(f.rooms.get(id).checkpoint,committed);
    assert.notEqual(pair[0].model.continuation.phaseQueuePrepend[0].phase,pair[1].model.continuation.phaseQueuePrepend[0].phase);
  }finally{await f.close();}
});
test('original move result write failure retains queue, PP and RNG; restart commits the same result once',async()=>{
  const adapter=adapterFor(0),store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{
    let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,before=copy(f.rooms.get(id).checkpoint);
    const expected=advanceAction(codec.restore(before));store.fail=true;for(const c of pair)c.send(c.acks.shift());
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    assert.deepEqual(store.data.get(id).checkpoint,before);await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    for(const c of pair)c.send(c.acks.shift());
    for(const c of pair){const s=await c.wait(m=>m.type==='snapshot'&&m.revision===1);assert.deepEqual(s.events,expected.events);await c.consume(s);}
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{await f.close();}
});
