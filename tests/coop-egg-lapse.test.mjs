import test from 'node:test';
import assert from 'node:assert/strict';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {eggs} from './helpers/egg-model.mjs';
import {eggLapseContext,advanceEggs,referenceEggs,atEggStop} from './helpers/egg-lapse-model.mjs';
import {projectEggSnapshot,eggClients as connect} from './helpers/egg-lapse-clients.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const checkpoint=c=>copy(codec.capture(c));
function adapterFor(initial,options={}){const saved=checkpoint(initial);return {...safeAdapter('ended'),rulesVersion:'original-owned-egg-lapse-test',
  createInitialContext:()=>codec.restore(saved),projectSnapshot:projectEggSnapshot,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:safeCodec.collection(c.decision)}),
  advanceToDecision:(c,inputs)=>advanceEggs(c,inputs,options)};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}
for(const options of [{rows:[[],[]]},{rows:[[3,7],[5]]},{rows:[[1,1],[1,1]]},{emptySeat:1,fromVictory:true}])
test(`real WS owned original EggLapse preserves private views on every restart ${JSON.stringify(options)}`,async()=>{
  const initial=await eggLapseContext(options),adapter=adapterFor(initial);let reference=codec.restore(checkpoint(initial)),f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0;const store=f.store;
    while(!atEggStop(reference)){
      assert.ok(revision<30);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      const expected=await referenceEggs(reference);reference=expected.context;await confirm(pair,++revision);
      assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      for(const [seat,c]of pair.entries()){
        assert.deepEqual(c.snapshot.events,copy(expected.events));assert.deepEqual(copy(adapter.projectSnapshot(c.model,seat)),copy(adapter.projectSnapshot(reference,seat)));
        assert.equal(c.model.context.eggState.players[1-seat].length,0);
        for(const egg of c.model.context.eggState.players[seat])assert.equal(Object.getPrototypeOf(egg),eggs.Egg.prototype);
        for(const egg of reference.eggState.players[1-seat])assert.ok(!JSON.stringify(c.snapshot).includes(String(egg.id)));
      }
    }
    const before=checkpoint(reference);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'UNSUPPORTED_RULE_PHASE');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
  }finally{await f.close();}
});

test('real WS egg write failure restores both counters and pending owned hatch references before retry',async()=>{
  const initial=await eggLapseContext(),before=checkpoint(initial),expected=await referenceEggs(codec.restore(before)),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    store.fail=true;for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
    for(const c of pair)assert.deepEqual(copy(adapter.projectSnapshot(c.model,c.identity.seat)),copy(adapter.projectSnapshot(expected.context,c.identity.seat)));
  }finally{await f.close();}
});

test('real WS failure while the second player progresses does not publish the first player decrement',async()=>{
  const initial=await eggLapseContext(),before=checkpoint(initial),fault={enabled:true};
  const adapter=adapterFor(initial,{onEggBind:(_c,_p,_b,tasks,{seat})=>{if(fault.enabled&&seat===1)tasks.add(Promise.reject(Error('second egg task')));}});
  let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(f.store.data.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.enabled=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await referenceEggs(codec.restore(before));assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
  }finally{await f.close();}
});

test('real WS missing one applied-state ACK cannot progress either egg inventory',async()=>{
  const initial=await eggLapseContext(),adapter=adapterFor(initial),f=await formalFixture(adapter);
  try{const pair=await connect(f,adapter),id=pair[0].identity.roomId,before=checkpoint(initial);pair[0].send(pair[0].acks.shift());
    const status=await pair[0].wait(m=>m.type==='syncStatus'&&m.acked[0]===true&&m.acked[1]===false);
    assert.ok(status);assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.equal(f.rooms.get(id).revision,0);
    pair[1].send(pair[1].acks.shift());await receive(pair,1);assert.equal(f.rooms.get(id).revision,1);
  }finally{await f.close();}
});

test('real WS egg counters and pending hatch ownership remain isolated between rooms',async()=>{
  const initial=await eggLapseContext(),adapter=adapterFor(initial),before=checkpoint(initial),f=await formalFixture(adapter);
  try{const a=await connect(f,adapter),b=await connect(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId;
    await confirm(a,1);assert.deepEqual(f.rooms.get(bid).checkpoint,before);assert.deepEqual(f.store.data.get(bid).checkpoint,before);
    await confirm(b,1);assert.deepEqual(f.rooms.get(aid).checkpoint,f.rooms.get(bid).checkpoint);
  }finally{await f.close();}
});
