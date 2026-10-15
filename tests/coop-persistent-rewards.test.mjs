import test from 'node:test';
import assert from 'node:assert/strict';
import {persistentContext,rewardIntent,executePreparation} from './helpers/persistent-rewards-model.mjs';
import {validateEffect} from './helpers/preparation-effects-model.mjs';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {projectPreparation,preparationClients as connect} from './helpers/preparation-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c));
function adapterFor(c,options={}){const start=saved(c);return {...safeAdapter('ended'),rulesVersion:'original-persistent-rewards-test',
  createInitialContext:()=>codec.restore(start),projectSnapshot:projectPreparation,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:safeCodec.collection(c.decision)}),
  validateAction:validateEffect,
  advanceToDecision(c,inputs){const [seat,a]=Object.entries(inputs)[0];return executePreparation(c,Number(seat),a,options);}};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function ack(pair){const revision=pair[0].snapshot.revision;for(const c of pair)c.send(c.acks.shift());await pair[0].wait(m=>m.type==='syncStatus'&&m.revision===revision&&!m.blocked);}
const message=(c,a,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:id,action:a});
async function accept(pair,seat,a,id,revision){const request=message(pair[seat],a,id);pair[seat].send(request);
  const receipt=await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===id);assert.equal(receipt.accepted,true,receipt.code);await receive(pair,revision);return request;}
for(const seat of [0,1])test(`real WS persistent held reward seat ${seat} restores original models and remapped private components without replay`,async()=>{
  const c=await persistentContext({id:'LUCKY_EGG',seat,existing:1,peerModifier:true}),before=saved(c),a=rewardIntent(c,seat),adapter=adapterFor(c);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ack(pair);
    const request=await accept(pair,seat,a,'held-once',1),expected=(await executePreparation(codec.restore(before),seat,a,{reference:true})).context;
    assert.deepEqual(f.rooms.get(id).checkpoint,saved(expected));for(const x of pair)assert.deepEqual(copy(adapter.projectSnapshot(x.model,x.identity.seat)),copy(adapter.projectSnapshot(expected,x.identity.seat)));
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);await ack(pair);
    pair[seat].send(request);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId==='held-once')).accepted,true);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved(expected));assert.equal(f.rooms.get(id).revision,1);
    assert.equal(pair[1-seat].model.context.players[seat].modifiers.length,0);
  }finally{await f.close();}
});
test('real WS full original global stack fallback survives replay and does not raise its cap',async()=>{
  const c=await persistentContext({id:'GOLDEN_POKEBALL',existing:3}),a=rewardIntent(c),adapter=adapterFor(c);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ack(pair);const request=await accept(pair,0,a,'fallback-once',1);
    const expected=saved((await executePreparation(c,0,a,{reference:true})).context);assert.deepEqual(f.rooms.get(id).checkpoint,expected);
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);await ack(pair);
    pair[0].send(request);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId==='fallback-once')).accepted,true);
    assert.deepEqual(f.rooms.get(id).checkpoint,expected);
  }finally{await f.close();}
});
for(const options of [{id:'BASE_STAT_BOOSTER',existing:15},{id:'GOLDEN_POKEBALL',existing:3}])
test(`real WS persistent result write failure preserves the old stack, stats and fallback count ${options.id}`,async()=>{
  const c=await persistentContext({...options,peerModifier:true}),before=saved(c),a=rewardIntent(c),adapter=adapterFor(c);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ack(pair);store.fail=true;
    pair[0].send(message(pair[0],a,'persistent-durable'));assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.equal((await pair[0].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    assert.deepEqual(store.data.get(id).checkpoint,before);assert.deepEqual(f.rooms.get(id).inputs[0],a);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);await ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved((await executePreparation(codec.restore(before),0,a,{reference:true})).context));
  }finally{await f.close();}
});
test('real WS failed original modifier update keeps acquired stack and recalculated stats unpublished until repair',async()=>{
  const c=await persistentContext({id:'BASE_STAT_BOOSTER',existing:15}),before=saved(c),a=rewardIntent(c),fault={active:true};
  const adapter=adapterFor(c,{updateInfo:()=>fault.active?Promise.reject(Error('update')):Promise.resolve()});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ack(pair);pair[0].send(message(pair[0],a,'failed-update'));
    assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);assert.equal((await pair[0].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);const store=f.store;await f.close();fault.active=false;
    f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);await ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved((await executePreparation(codec.restore(before),0,a)).context));
  }finally{await f.close();}
});
test('real WS original held cap and foreign target reject before buffering and leave the personal menu usable',async()=>{
  const c=await persistentContext({id:'LUCKY_EGG',existing:99});c.players[0].modifiers[0].stackCount=c.players[0].modifiers[0].getMaxHeldItemCount(c.roster.entries[0].pokemon);
  const before=saved(c),a=rewardIntent(c),adapter=adapterFor(c),f=await formalFixture(adapter);
  try{const pair=await connect(f,adapter),id=pair[0].identity.roomId;await ack(pair);
    for(const [action,code]of [[a,'INVALID_PREPARATION_TARGET'],[{...a,pokemonId:101},'INVALID_PREPARATION_OWNER']]){
      pair[0].send(message(pair[0],action,code));const receipt=await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===code);
      assert.equal(receipt.accepted,false);assert.equal(receipt.code,code);assert.deepEqual(f.rooms.get(id).inputs,{});assert.deepEqual(f.rooms.get(id).checkpoint,before);
    }
    await accept(pair,0,{kind:'preparation',operation:'skip-reward'},'legal-skip',1);assert.equal(f.rooms.get(id).checkpoint.decision.players[0].rewardResolved,true);
  }finally{await f.close();}
});
test('real WS missing ACK blocks persistent rewards and different rooms retain separate modifier graphs',async()=>{
  const c=await persistentContext({id:'EXP_CHARM',peerModifier:true}),adapter=adapterFor(c),before=saved(c),f=await formalFixture(adapter);
  try{const a=await connect(f,adapter),b=await connect(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId;
    a[0].send(a[0].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&m.acked[0]&&!m.acked[1]);
    a[0].send(message(a[0],rewardIntent(c),'blocked'));assert.equal((await a[0].wait(m=>m.type==='actionReceipt')).code,'SYNC_BLOCKED');
    assert.deepEqual(f.rooms.get(aid).checkpoint,before);a[1].send(a[1].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&!m.blocked);
    await accept(a,0,rewardIntent(c),'a-reward',1);assert.deepEqual(f.rooms.get(bid).checkpoint,before);
    await ack(b);await accept(b,0,rewardIntent(c),'b-reward',1);assert.deepEqual(f.rooms.get(aid).checkpoint,f.rooms.get(bid).checkpoint);
  }finally{await f.close();}
});
