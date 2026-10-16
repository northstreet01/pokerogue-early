import test from 'node:test';
import assert from 'node:assert/strict';
import {nextBattleContext,createNextBattle,advanceEntry,referenceNextBattle,referenceEntry,advanceCycle,validateCycleInput,nextPostPhase} from './helpers/next-battle-model.mjs';
import {choosePreparation,projectPreparation,preparationClients as connect} from './helpers/preparation-model.mjs';
import {chooseCycleInputs} from './helpers/command-cycle-model.mjs';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c));
function adapterFor(initial,options={}){const start=saved(initial);return {...safeAdapter('ended'),rulesVersion:'original-next-battle-test',
  createInitialContext:()=>codec.restore(start),projectSnapshot:projectPreparation,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':c.decision.kind==='preparation'?'incremental':'all'}),
  validateAction(c,seat,a){if(c.decision.kind==='preparation')safeCodec.validateAction(c,seat,a);else{codec.validateAction(c,seat,a);validateCycleInput(c,seat,a);}},
  advanceToDecision(c,inputs){
    if(c.decision.kind==='preparation'){const [seat,a]=Object.entries(inputs)[0];return choosePreparation(c,Number(seat),a);}
    if(c.decision.kind==='continuing'&&c.decision.reason==='next-battle')return createNextBattle(c,options);
    if(c.decision.kind==='continuing'&&['PostSummonPhase','ToggleDoublePositionPhase','CheckSwitchPhase','TurnInitPhase'].includes(nextPostPhase(c)?.constructor.name))return advanceEntry(c,options);
    return advanceCycle(c,inputs);
  }};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);assert.equal(await c.consume(c.snapshot),true);}}
function ack(pair){for(const c of pair)c.send(c.acks.shift());}
async function ready(pair){ack(pair);await pair[0].wait(m=>m.type==='syncStatus'&&m.revision===pair[0].snapshot.revision&&!m.blocked);}
const request=(c,a,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:id,action:a});
async function steps(initial){const result=[];let r=await referenceNextBattle(codec.restore(saved(initial)));
  const keep=()=>{const checkpoint=saved(r.context);result.push({context:codec.restore(checkpoint),checkpoint,events:r.events});};keep();
  while(r.context.decision.kind==='continuing'){r=await referenceEntry(r.context);keep();}return result;}
test('real WS both-ready runs original next battle, restores both models at every entry stop and deduplicates real next FIGHT',async()=>{
  const initial=await nextBattleContext({ready:false}),adapter=adapterFor(initial);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ready(pair);
    const a={kind:'preparation',operation:'ready'},sent=request(pair[1],a,'final-ready');pair[1].send(sent);
    assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).accepted,true);await receive(pair,1);
    const expectedInitial=(await choosePreparation(initial,1,a)).context,expected=await steps(expectedInitial);
    assert.equal(f.rooms.get(id).checkpoint.decision.reason,'next-battle');
    for(let i=0;i<expected.length;i++){
      ack(pair);await receive(pair,i+2);assert.deepEqual(f.rooms.get(id).checkpoint,expected[i].checkpoint);
      for(const c of pair){assert.deepEqual(c.snapshot.events,expected[i].events);assert.deepEqual(copy(adapter.projectSnapshot(c.model,c.identity.seat)),copy(adapter.projectSnapshot(expected[i].context,c.identity.seat)));}
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);
      assert.deepEqual(f.rooms.get(id).checkpoint,expected[i].checkpoint);
    }
    pair[1].send(sent);assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).accepted,true);
    const revision=f.rooms.get(id).revision,before=copy(f.rooms.get(id).checkpoint);await ready(pair);
    const inputs=chooseCycleInputs(codec.restore(before)),one=request(pair[0],inputs[0],'next-fight-0');pair[0].send(one);
    assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);assert.deepEqual(f.rooms.get(id).checkpoint,before);
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);
    pair[0].send(one);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.deepEqual(f.rooms.get(id).inputs,{0:inputs[0]});await ready(pair);
    pair[1].send(request(pair[1],inputs[1],'next-fight-1'));assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).accepted,true);
    await receive(pair,revision+1);assert.equal(f.rooms.get(id).revision,revision+1);assert.deepEqual(f.rooms.get(id).inputs,{});
    const committed=copy(f.rooms.get(id).checkpoint);pair[0].send(one);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.deepEqual(f.rooms.get(id).checkpoint,committed);
  }finally{await f.close();}
});
for(const failRevision of [1,2,4,7])test(`real WS next battle/entry result write ${failRevision} failure restores last committed model and RNG`,async()=>{
  const initial=await nextBattleContext(),expected=await steps(initial),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===failRevision)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;
    for(let rev=1;rev<failRevision;rev++){ack(pair);await receive(pair,rev);}
    const before=copy(f.rooms.get(id).checkpoint);store.fail=true;ack(pair);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);ack(pair);await receive(pair,failRevision);
    assert.deepEqual(f.rooms.get(id).checkpoint,expected[failRevision-1].checkpoint);
  }finally{await f.close();}
});
test('real WS encounter task failure recovers without rerunning published generation',async()=>{
  const initial=await nextBattleContext(),fault={active:true},before=saved(initial),adapter=adapterFor(initial,{onBind:(_c,p,_b,t)=>{
    if(fault.active&&p.constructor.name==='NextEncounterPhase')t.add(Promise.reject(Error('encounter-fault')));
  }});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;ack(pair);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.active=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved((await referenceNextBattle(codec.restore(before))).context));
  }finally{await f.close();}
});
test('real WS final-ready write failure keeps accepted input and resumes the same original NewBattle once',async()=>{
  const initial=await nextBattleContext({ready:false}),before=saved(initial),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ready(pair);store.fail=true;
    const action={kind:'preparation',operation:'ready'},sent=request(pair[1],action,'durable-ready');pair[1].send(sent);
    assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    assert.deepEqual(store.data.get(id).inputs,{1:action});await f.close();store.fail=false;f=await formalFixture(adapter,store);
    pair=await connect(f,adapter,ids);ack(pair);await receive(pair,1);assert.equal(f.rooms.get(id).checkpoint.decision.reason,'next-battle');
    pair[1].send(sent);assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).accepted,true);assert.equal(f.rooms.get(id).revision,1);
    ack(pair);await receive(pair,2);assert.equal(f.rooms.get(id).checkpoint.battle.waveIndex,2);
  }finally{await f.close();}
});
test('real WS one ACK cannot create enemies; two interleaved rooms keep original creation and RNG isolated',async()=>{
  const initial=await nextBattleContext(),before=saved(initial),adapter=adapterFor(initial),f=await formalFixture(adapter);
  try{const a=await connect(f,adapter),b=await connect(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId;
    a[0].send(a[0].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&m.acked[0]&&!m.acked[1]);assert.deepEqual(f.rooms.get(aid).checkpoint,before);
    ack(b);await receive(b,1);assert.deepEqual(f.rooms.get(aid).checkpoint,before);
    a[1].send(a[1].acks.shift());await receive(a,1);assert.deepEqual(f.rooms.get(aid).checkpoint,f.rooms.get(bid).checkpoint);
    const keep=copy(f.rooms.get(bid).checkpoint);ack(a);await receive(a,2);assert.deepEqual(f.rooms.get(bid).checkpoint,keep);
  }finally{await f.close();}
});
