import test from 'node:test';
import assert from 'node:assert/strict';
import {encounterContext,createEncounter,referenceEncounter,advanceEncounterEntry,referenceEncounterEntry,choosePreBattle} from './helpers/encounter-modifiers-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {projectPreparation,preparationClients as connect} from './helpers/preparation-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c));
function adapterFor(initial,options={}){const start=saved(initial);return {...safeAdapter('ended'),rulesVersion:'original-encounter-modifiers-test',
  createInitialContext:()=>codec.restore(start),projectSnapshot:projectPreparation,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
  validateAction:(c,seat,a)=>codec.validateAction(c,seat,a),
  advanceToDecision:(c,inputs)=>c.decision.reason==='next-battle'?createEncounter(c,options):advanceEncounterEntry(c,inputs,options)
};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);assert.equal(await c.consume(c.snapshot),true);}}
function ack(pair){for(const c of pair)c.send(c.acks.shift());}
async function ready(pair){ack(pair);await pair[0].wait(m=>m.type==='syncStatus'&&m.revision===pair[0].snapshot.revision&&!m.blocked);}
const request=(c,a,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:id,action:a});
for(const seed of [3,36])test(`real WS natural item seed ${seed} keeps personal inventories through both-client restarts and deduplicated switch declines`,async()=>{
  const initial=await encounterContext({seed:`encounter-items-${seed}`,reserves:true}),adapter=adapterFor(initial);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId,ref={context:codec.restore(saved(initial))};
    let revision=0,oldRequest;
    while(ref.context.decision.kind!=='wait-actions'){
      assert.ok(revision<15);
      if(ref.context.decision.kind==='continuing'){
        ack(pair);ref=ref.context.decision.reason==='next-battle'?await referenceEncounter(ref.context):await referenceEncounterEntry(ref.context);
      }else{
        await ready(pair);const inputs=choosePreBattle(ref.context,{accept:false}),seat=Number(Object.keys(inputs)[0]);
        oldRequest={seat,message:request(pair[seat],inputs[seat],`decline-${revision}`)};pair[seat].send(oldRequest.message);
        assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);ref=await referenceEncounterEntry(ref.context,inputs);
      }
      await receive(pair,++revision);assert.deepEqual(f.rooms.get(id).checkpoint,saved(ref.context));
      for(const client of pair){assert.deepEqual(client.snapshot.events,ref.events);assert.deepEqual(copy(adapter.projectSnapshot(client.model,client.identity.seat)),copy(adapter.projectSnapshot(ref.context,client.identity.seat)));}
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);
      assert.deepEqual(f.rooms.get(id).checkpoint,saved(ref.context));
      if(oldRequest){const client=pair[oldRequest.seat];client.send(oldRequest.message);
        assert.equal((await client.wait(m=>m.type==='actionReceipt')).accepted,true);
        assert.equal(f.rooms.get(id).revision,revision);assert.deepEqual(f.rooms.get(id).checkpoint,saved(ref.context));
      }
    }
    assert.equal(f.rooms.get(id).checkpoint.enemyModifiers.length,1);assert.equal(ref.context.battle.double,true);
  }finally{await f.close();}
});
for(const failRevision of [1,3,6])test(`real WS encounter item result write ${failRevision} failure restores items and RNG then retries original execution`,async()=>{
  const initial=await encounterContext({seed:'encounter-items-3'}),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===failRevision)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId,ref={context:codec.restore(saved(initial))};
    for(let rev=1;rev<failRevision;rev++){ack(pair);await receive(pair,rev);ref=rev===1?await referenceEncounter(ref.context):await referenceEncounterEntry(ref.context);}
    const before=copy(f.rooms.get(id).checkpoint);store.fail=true;ack(pair);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);ack(pair);await receive(pair,failRevision);
    ref=failRevision===1?await referenceEncounter(ref.context):await referenceEncounterEntry(ref.context);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved(ref.context));
  }finally{await f.close();}
});
test('real WS enemy update rejection leaves committed inventory unchanged and recovers after restart',async()=>{
  const initial=await encounterContext({seed:'encounter-items-36'}),before=saved(initial),fault={active:true};
  const adapter=adapterFor(initial,{updateInfo:(_pk,seat)=>fault.active&&seat===null?Promise.reject(Error('update-fault')):Promise.resolve()});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;ack(pair);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.active=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved((await referenceEncounter(codec.restore(before))).context));
  }finally{await f.close();}
});
test('real WS two rooms keep enemy items and personal item queries isolated behind both ACKs',async()=>{
  const initial=await encounterContext({seed:'encounter-items-3'}),before=saved(initial),adapter=adapterFor(initial),f=await formalFixture(adapter);
  try{const a=await connect(f,adapter),b=await connect(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId;
    a[0].send(a[0].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&m.acked[0]&&!m.acked[1]);assert.deepEqual(f.rooms.get(aid).checkpoint,before);
    ack(b);await receive(b,1);assert.deepEqual(f.rooms.get(aid).checkpoint,before);
    a[1].send(a[1].acks.shift());await receive(a,1);assert.deepEqual(f.rooms.get(aid).checkpoint,f.rooms.get(bid).checkpoint);
    const keep=copy(f.rooms.get(bid).checkpoint);ack(a);await receive(a,2);assert.deepEqual(f.rooms.get(bid).checkpoint,keep);
  }finally{await f.close();}
});
