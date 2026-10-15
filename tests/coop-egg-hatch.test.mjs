import test from 'node:test';
import assert from 'node:assert/strict';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {hatchContext,advanceHatch,referenceHatch} from './helpers/egg-hatch-model.mjs';
import {projectEggSnapshot,eggClients as connect} from './helpers/egg-lapse-clients.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const checkpoint=c=>copy(codec.capture(c));
function adapterFor(initial,options={}){const saved=checkpoint(initial);return {...safeAdapter('ended'),rulesVersion:'original-owned-egg-hatch-test',
  createInitialContext:()=>codec.restore(saved),projectSnapshot:projectEggSnapshot,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:safeCodec.collection(c.decision)}),
  advanceToDecision:c=>advanceHatch(c,options)};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}
for(const seat of [0,1])test(`real WS original generated hatch seat ${seat} survives restart without replay and stays private`,async()=>{
  const initial=await hatchContext({seat}),expected=await referenceHatch(codec.restore(checkpoint(initial)));let creates=0;
  const adapter=adapterFor(initial,{onCreate:()=>creates++});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;await confirm(pair,1);
    assert.equal(creates,1);assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
    for(const c of pair)assert.deepEqual(copy(adapter.projectSnapshot(c.model,c.identity.seat)),copy(adapter.projectSnapshot(expected.context,c.identity.seat)));
    assert.ok(!JSON.stringify(pair[1-seat].snapshot).includes('10001'));const store=f.store;
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.equal(creates,1);assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'HATCH_COMMIT_UNAVAILABLE');
    assert.equal(creates,1);assert.deepEqual(store.data.get(id).checkpoint,checkpoint(expected.context));
  }finally{await f.close();}
});
test('real WS hatch storage failure keeps original egg and retries from the old checkpoint',async()=>{
  const initial=await hatchContext(),before=checkpoint(initial),expected=await referenceHatch(codec.restore(before));
  const adapter=adapterFor(initial),store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    store.fail=true;for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);await confirm(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
  }finally{await f.close();}
});
test('real WS original factory failure keeps both egg inventories and queued hatch before retry',async()=>{
  const initial=await hatchContext(),before=checkpoint(initial),fault={active:true};
  const adapter=adapterFor(initial,{onCreate:()=>{if(fault.active)throw Error('factory');}});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);const store=f.store;await f.close();fault.active=false;
    f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);await confirm(pair,1);
    const expected=await referenceHatch(codec.restore(before));assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
  }finally{await f.close();}
});
test('real WS one applied-state ACK cannot generate or consume the personal egg',async()=>{
  const initial=await hatchContext();let calls=0;const adapter=adapterFor(initial,{onCreate:()=>calls++}),f=await formalFixture(adapter);
  try{const pair=await connect(f,adapter),id=pair[0].identity.roomId;pair[0].send(pair[0].acks.shift());
    await pair[0].wait(m=>m.type==='syncStatus'&&m.acked[0]===true&&m.acked[1]===false);
    assert.equal(calls,0);assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(initial));
    pair[1].send(pair[1].acks.shift());await receive(pair,1);assert.equal(calls,1);
  }finally{await f.close();}
});
test('real WS hatch result and seed remain isolated between rooms',async()=>{
  const initial=await hatchContext(),adapter=adapterFor(initial),f=await formalFixture(adapter);
  try{const a=await connect(f,adapter),b=await connect(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId;
    await confirm(a,1);assert.deepEqual(f.rooms.get(bid).checkpoint,checkpoint(initial));
    await confirm(b,1);assert.deepEqual(f.rooms.get(aid).checkpoint,f.rooms.get(bid).checkpoint);
  }finally{await f.close();}
});
