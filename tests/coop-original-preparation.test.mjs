import test from 'node:test';
import assert from 'node:assert/strict';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {preparationContext,openMenus,referenceMenus,choosePreparation,atPreparationEnd,projectPreparation,preparationClients as connect} from './helpers/preparation-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy,requireContract as check} from '../src/battle-core/coop-contract.mjs';
import {validatePreparationAction} from '../src/battle-core/preparation-runner.mjs';
const saved=c=>copy(codec.capture(c)),act=operation=>({kind:'preparation',operation});
function adapterFor(initial,options={}){const start=saved(initial);return {...safeAdapter('ended'),rulesVersion:'original-owned-preparation-test',
  createInitialContext:()=>codec.restore(start),projectSnapshot:projectPreparation,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:safeCodec.collection(c.decision)}),
  validateAction:(c,seat,a)=>c.decision.kind==='preparation'?validatePreparationAction(c,seat,a,safeCodec):codec.validateAction(c,seat,a),
  advanceToDecision(c,inputs){check(!atPreparationEnd(c),'NEXT_BATTLE_RUNNER_UNAVAILABLE');
    if(c.decision.kind==='continuing')return openMenus(c,options);
    const [seat,action]=Object.entries(inputs)[0];return choosePreparation(c,Number(seat),action);}};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function ack(pair){const revision=pair[0].snapshot.revision;for(const c of pair)c.send(c.acks.shift());
  if(pair[0].snapshot.shared.battle.decision.kind==='preparation')await pair[0].wait(m=>m.type==='syncStatus'&&m.revision===revision&&!m.blocked);}
const message=(c,action,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:id,action});
async function accept(pair,seat,action,id,revision){const request=message(pair[seat],action,id);pair[seat].send(request);
  const receipt=await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===id);assert.equal(receipt.accepted,true,receipt.code);
  await receive(pair,revision);return request;}
for(const options of [{},{emptySeat:1}])test(`real WS original personal preparation survives every choice restart and both-ready gate ${JSON.stringify(options)}`,async()=>{
  const initial=await preparationContext(options);let starts=0;const adapter=adapterFor(initial,{onStart:()=>starts++});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=1;
    await ack(pair);await receive(pair,revision);let reference=await referenceMenus(codec.restore(saved(initial)));
    assert.equal(starts,2);assert.deepEqual(f.rooms.get(id).checkpoint,saved(reference));
    let first;
    for(const [seat,operation]of [[0,'skip-reward'],[0,'ready'],[0,'unready'],[1,'skip-reward'],[1,'ready'],[0,'ready']]){
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.equal(starts,2);assert.deepEqual(f.rooms.get(id).checkpoint,saved(reference));
      await ack(pair);const request=await accept(pair,seat,act(operation),`choice-${revision}`,++revision);first??=request;
      reference=(await choosePreparation(reference,seat,act(operation))).context;
      assert.deepEqual(f.rooms.get(id).checkpoint,saved(reference));
      for(const c of pair)assert.deepEqual(copy(adapter.projectSnapshot(c.model,c.identity.seat)),copy(adapter.projectSnapshot(reference,c.identity.seat)));
    }
    assert.ok(atPreparationEnd(reference));assert.equal(starts,2);
    pair[0].send(first);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===first.actionId)).accepted,true);
    assert.equal(f.rooms.get(id).revision,revision);
    await ack(pair);assert.equal((await pair[1].wait(m=>m.type==='error')).code,'NEXT_BATTLE_RUNNER_UNAVAILABLE');
    assert.deepEqual(f.rooms.get(id).checkpoint,saved(reference));
  }finally{await f.close();}
});
test('real WS preparation menu storage failure retains queue, RNG and both inventories before retry',async()=>{
  const initial=await preparationContext(),before=saved(initial),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    store.fail=true;await ack(pair);assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);await ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved(await referenceMenus(codec.restore(before))));
  }finally{await f.close();}
});
test('real WS second personal menu task failure rolls back the first menu and its random draws',async()=>{
  const initial=await preparationContext(),before=saved(initial),fault={active:true},adapter=adapterFor(initial,{
    onMenuBind:(_c,_p,_b,tasks,{seat})=>{if(fault.active&&seat===1)tasks.add(Promise.reject(Error('second menu')));}});
  let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    await ack(pair);assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.active=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await ack(pair);await receive(pair,1);assert.deepEqual(f.rooms.get(id).checkpoint,saved(await referenceMenus(codec.restore(before))));
  }finally{await f.close();}
});
test('real WS failed personal ready write preserves the old ready flags and unstarted NewBattle',async()=>{
  const initial=(await openMenus(await preparationContext())).context,adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===2)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    await ack(pair);await accept(pair,0,act('skip-reward'),'skip',1);await ack(pair);const before=copy(f.rooms.get(id).checkpoint);
    store.fail=true;pair[0].send(message(pair[0],act('ready'),'ready'));
    assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId==='ready')).accepted,true);
    assert.equal((await pair[0].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    assert.equal(f.rooms.get(id).inputs[0].operation,'ready');
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);await ack(pair);await receive(pair,2);
    assert.equal(f.rooms.get(id).checkpoint.decision.players[0].ready,true);
    assert.equal(f.rooms.get(id).checkpoint.decision.players[1].ready,false);
  }finally{await f.close();}
});
test('real WS rejects unsupported item effect before buffering it and still permits a legal skip',async()=>{
  const initial=(await openMenus(await preparationContext())).context,adapter=adapterFor(initial),before=saved(initial),f=await formalFixture(adapter);
  try{const pair=await connect(f,adapter),id=pair[0].identity.roomId;await ack(pair);
    const a={kind:'preparation',operation:'reward',optionId:initial.decision.players[0].rewards[0].id,pokemonId:null,moveIndex:null,fusionId:null};
    pair[0].send(message(pair[0],a,'unsupported'));
    const receipt=await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId==='unsupported');
    assert.equal(receipt.accepted,false);assert.equal(receipt.code,'PREPARATION_EFFECT_UNAVAILABLE');
    assert.deepEqual(f.rooms.get(id).inputs,{});assert.deepEqual(f.rooms.get(id).checkpoint,before);
    await accept(pair,0,act('skip-reward'),'legal-skip',1);assert.equal(f.rooms.get(id).checkpoint.decision.players[0].rewardResolved,true);
  }finally{await f.close();}
});
test('real WS one ACK cannot draw menus and independent rooms retain separate preparation progress',async()=>{
  const initial=await preparationContext(),adapter=adapterFor(initial),f=await formalFixture(adapter);
  try{const a=await connect(f,adapter),b=await connect(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId;
    a[0].send(a[0].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&m.acked[0]&&!m.acked[1]);
    assert.deepEqual(f.rooms.get(aid).checkpoint,saved(initial));a[1].send(a[1].acks.shift());await receive(a,1);
    assert.deepEqual(f.rooms.get(bid).checkpoint,saved(initial));await ack(a);await accept(a,0,act('skip-reward'),'a-skip',2);
    await ack(b);await receive(b,1);assert.equal(f.rooms.get(bid).checkpoint.decision.players[0].rewardResolved,false);
    assert.equal(f.rooms.get(aid).checkpoint.decision.players[0].rewardResolved,true);
  }finally{await f.close();}
});
