import test from 'node:test';
import assert from 'node:assert/strict';
import {transferContext,reviveContext,advanceItems,referenceItems,save,clone,chooseBattleItems} from './helpers/transfer-revive-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {projectPreparation,preparationClients as connect} from './helpers/preparation-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const adapterFor=(initial,options={})=>{const start=save(initial);return {...safeAdapter('ended'),rulesVersion:'original-transfer-revive-test',
  createInitialContext:()=>codec.restore(start),projectSnapshot:projectPreparation,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
  validateAction:(c,seat,a)=>codec.validateAction(c,seat,a),advanceToDecision:(c,inputs)=>advanceItems(c,inputs,options)};};
function ack(pair){for(const c of pair)c.send(c.acks.shift());}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);assert.equal(await c.consume(c.snapshot),true);}}
async function ready(pair){ack(pair);await pair[0].wait(m=>m.type==='syncStatus'&&m.revision===pair[0].snapshot.revision&&!m.blocked);}
const request=(c,a,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:id,action:a});
for(const seat of [0,null])for(const id of ['MINI_BLACK_HOLE','GRIP_CLAW'])test(`real WS owner ${seat} ${id} original transfer and RNG survive both-client restart without replay`,async()=>{
  const initial=await transferContext({seat,id,seed:'contact-3'}),adapter=adapterFor(initial);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ref={context:clone(initial)},revision=0;const ids=pair.map(c=>c.identity),room=ids[0].roomId;
    const steps=id==='GRIP_CLAW'?2:1;
    for(let i=0;i<steps;i++){
      ack(pair);ref=await referenceItems(ref.context);await receive(pair,++revision);assert.deepEqual(f.rooms.get(room).checkpoint,save(ref.context));
      for(const c of pair){assert.deepEqual(c.snapshot.events,ref.events);assert.deepEqual(copy(adapter.projectSnapshot(c.model,c.identity.seat)),copy(adapter.projectSnapshot(ref.context,c.identity.seat)));}
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);assert.deepEqual(f.rooms.get(room).checkpoint,save(ref.context));
    }
  }finally{await f.close();}
});
for(const seat of [0,1,null])test(`real WS lethal round owner ${seat} revives through every restored original phase then deduplicates real input`,async()=>{
  const initial=await reviveContext({seat,fullRound:true}),adapter=adapterFor(initial);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ref={context:clone(initial)},revision=0;const ids=pair.map(c=>c.identity),room=ids[0].roomId;
    while(ref.context.decision.kind!=='wait-actions'){
      assert.ok(revision<90);ack(pair);ref=await referenceItems(ref.context);await receive(pair,++revision);
      assert.deepEqual(f.rooms.get(room).checkpoint,save(ref.context));for(const c of pair)assert.deepEqual(c.snapshot.events,ref.events);
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);
      assert.deepEqual(f.rooms.get(room).checkpoint,save(ref.context));
    }
    await ready(pair);const inputs=chooseBattleItems(ref.context),sent=[];
    for(const owner of ref.context.decision.requiredSeats){const message=request(pair[owner],inputs[owner],`revived-input-${owner}`);sent.push({owner,message});pair[owner].send(message);assert.equal((await pair[owner].wait(m=>m.type==='actionReceipt')).accepted,true);}
    ref=await referenceItems(ref.context,inputs);await receive(pair,++revision);const committed=copy(f.rooms.get(room).checkpoint);
    assert.deepEqual(committed,save(ref.context));const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);
    for(const {owner,message}of sent){pair[owner].send(message);assert.equal((await pair[owner].wait(m=>m.type==='actionReceipt')).accepted,true);}
    assert.equal(f.rooms.get(room).revision,revision);assert.deepEqual(f.rooms.get(room).checkpoint,committed);
  }finally{await f.close();}
});
async function pendingRevive(seat,phase){let c=await reviveContext({seat});if(phase==='heal')c=(await advanceItems(c)).context;return c;}
for(const seat of [0,1,null])for(const phase of ['faint','heal'])test(`real WS revive owner ${seat} ${phase} write failure retains exact seed/HP boundary`,async()=>{
  const initial=await pendingRevive(seat,phase),before=save(initial),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter);const ids=pair.map(c=>c.identity),room=ids[0].roomId;store.fail=true;ack(pair);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(room).checkpoint,before);assert.deepEqual(store.data.get(room).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(room).checkpoint,save((await referenceItems(clone(initial))).context));
  }finally{await f.close();}
});
for(const id of ['MINI_BLACK_HOLE','GRIP_CLAW'])test(`real WS ${id} result write failure retries original ownership transaction once`,async()=>{
  let initial=await transferContext({id,seed:'contact-3'});if(id==='GRIP_CLAW')initial=(await advanceItems(initial)).context;
  const before=save(initial),adapter=adapterFor(initial),store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter);const ids=pair.map(c=>c.identity),room=ids[0].roomId;store.fail=true;ack(pair);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(room).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(room).checkpoint,save((await referenceItems(clone(initial))).context));
  }finally{await f.close();}
});
test('real WS rejected transfer task keeps inventory/RNG and recovers after restart',async()=>{
  const initial=await transferContext(),before=save(initial),fault={active:true},adapter=adapterFor(initial,{beforeTransfer:()=>fault.active?Promise.reject(Error('transfer-fault')):undefined});
  let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter);const ids=pair.map(c=>c.identity),room=ids[0].roomId;ack(pair);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');assert.deepEqual(f.rooms.get(room).checkpoint,before);
    const store=f.store;await f.close();fault.active=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(room).checkpoint,save((await referenceItems(clone(initial))).context));
  }finally{await f.close();}
});
test('real WS failed enemy update drains the personal transfer before detaching and can retry after restart',async()=>{
  const initial=await transferContext(),before=save(initial),fault={active:true};
  const adapter=adapterFor(initial,{updateInfo:(_actor,seat)=>fault.active&&seat===null?Promise.reject(Error('enemy-update-fault')):Promise.resolve()});
  let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter);const ids=pair.map(c=>c.identity),room=ids[0].roomId;ack(pair);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');assert.deepEqual(f.rooms.get(room).checkpoint,before);
    assert.equal(f.rooms.get(room).revision,0);const store=f.store;assert.deepEqual(store.data.get(room).checkpoint,before);
    await f.close();fault.active=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(room).checkpoint,save((await referenceItems(clone(initial))).context));
  }finally{await f.close();}
});
test('real WS transfer waits for both ACKs and keeps two room inventories isolated',async()=>{
  const initial=await transferContext(),before=save(initial),adapter=adapterFor(initial),f=await formalFixture(adapter);
  try{const a=await connect(f,adapter),b=await connect(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId;
    a[0].send(a[0].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&m.acked[0]&&!m.acked[1]);assert.deepEqual(f.rooms.get(aid).checkpoint,before);
    ack(b);await receive(b,1);assert.deepEqual(f.rooms.get(aid).checkpoint,before);a[1].send(a[1].acks.shift());await receive(a,1);
    assert.deepEqual(f.rooms.get(aid).checkpoint,f.rooms.get(bid).checkpoint);
  }finally{await f.close();}
});
