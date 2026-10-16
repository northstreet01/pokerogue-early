import test from 'node:test';
import assert from 'node:assert/strict';
import {preBattleContext,createPreBattle,advancePreBattle,referencePreBattle,choosePreBattle,nextPostPhase} from './helpers/pre-battle-switch-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {projectPreparation,preparationClients as connect} from './helpers/preparation-model.mjs';
import {validateCycleInput} from './helpers/command-cycle-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c));
const stageOf=c=>c.continuation.currentPhase?.remaining??nextPostPhase(c)?.constructor.name;
async function contextAt(stage,seats=[0,1]){let c=(await createPreBattle(await preBattleContext({seats}))).context;
  for(let i=0;i<35;i++){if(stageOf(c)===stage)return c;c=(await advancePreBattle(c,choosePreBattle(c))).context;}throw Error('missing stage');}
function adapterFor(initial,options={}){const start=saved(initial);return {...safeAdapter('ended'),rulesVersion:'original-pre-battle-switch-test',
  createInitialContext:()=>codec.restore(start),projectSnapshot:projectPreparation,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
  validateAction(c,seat,a){codec.validateAction(c,seat,a);if(['wait-actions','wait-target'].includes(c.decision.kind))validateCycleInput(c,seat,a);},
  advanceToDecision:(c,inputs)=>advancePreBattle(c,inputs,options)};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);assert.equal(await c.consume(c.snapshot),true);}}
const ack=pair=>{for(const c of pair)c.send(c.acks.shift());};
async function ready(pair){ack(pair);await pair[0].wait(m=>m.type==='syncStatus'&&m.revision===pair[0].snapshot.revision&&!m.blocked);}
const request=(c,a,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:id,action:a});
for(const seats of [[0],[1],[0,1]])test(`real WS original voluntary switch ${seats} restores each choice and return/swap/summon boundary without replaying inputs`,async()=>{
  const initial=await contextAt('switch-confirm',seats),adapter=adapterFor(initial);let expected=codec.restore(saved(initial)),f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId,revision=0;
    while(expected.decision.kind!=='wait-actions'){
      assert.ok(revision<35);const kind=expected.decision.kind,seat=expected.decision.requiredSeats[0],inputs=choosePreBattle(expected);
      let sent;if(kind==='continuing')ack(pair);else{
        await ready(pair);sent=request(pair[seat],inputs[seat],`choice-${revision}`);pair[seat].send(sent);
        assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);
      }
      const r=await referencePreBattle(expected,inputs);expected=r.context;await receive(pair,++revision);
      assert.deepEqual(f.rooms.get(id).checkpoint,saved(expected));
      for(const c of pair){assert.deepEqual(c.snapshot.events,r.events);assert.deepEqual(copy(adapter.projectSnapshot(c.model,c.identity.seat)),copy(adapter.projectSnapshot(expected,c.identity.seat)));}
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);
      if(sent){pair[seat].send(sent);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);
        assert.equal(f.rooms.get(id).revision,revision);assert.deepEqual(f.rooms.get(id).checkpoint,saved(expected));}
    }
    for(const seat of seats)assert.equal(expected.roster.field[seat],110+seat);
  }finally{await f.close();}
});
for(const branch of ['decline','cancel'])test(`real WS ${branch} keeps the active actor after restart and duplicate receipt`,async()=>{
  const initial=await contextAt(branch==='decline'?'switch-confirm':'switch-select',[1]),adapter=adapterFor(initial);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ready(pair);
    const input=choosePreBattle(initial,{accept:false,cancel:true})[1],sent=request(pair[1],input,branch);pair[1].send(sent);
    assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).accepted,true);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint.roster.field.slice(0,2),[100,101]);const committed=copy(f.rooms.get(id).checkpoint),store=f.store;
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);pair[1].send(sent);
    assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).accepted,true);assert.deepEqual(f.rooms.get(id).checkpoint,committed);
    pair[1].send({...sent,action:{...input,pokemonId:111}});assert.equal((await pair[1].wait(m=>m.type==='error')).code,'ACTION_ID_CONFLICT');
  }finally{await f.close();}
});
for(const stage of ['switch-confirm','switch-select','SwitchSummonPhase','switch-swap','summon-initialize','summon-finish'])
test(`real WS ${stage} result write failure keeps old decision and resumes original remaining method`,async()=>{
  const initial=await contextAt(stage),before=saved(initial),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;store.fail=true;
    const inputs=choosePreBattle(initial),seat=initial.decision.requiredSeats[0];
    if(initial.decision.kind==='continuing')ack(pair);else{store.fail=false;await ready(pair);store.fail=true;
      pair[seat].send(request(pair[seat],inputs[seat],'durable-choice'));assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);}
    assert.equal((await pair[seat??1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    assert.deepEqual(store.data.get(id).checkpoint,before);if(seat!==undefined)assert.deepEqual(store.data.get(id).inputs,inputs);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved((await referencePreBattle(codec.restore(before),inputs)).context));
  }finally{await f.close();}
});
test('real WS original callback task rejection resumes the durable choice once after repair',async()=>{
  const initial=await contextAt('switch-select'),before=saved(initial),fault={active:true},adapter=adapterFor(initial,{onChoiceBind:(_c,_p,_b,t,intent)=>{
    if(intent&&fault.active)t.add(Promise.reject(Error('callback-fault')));
  }});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ready(pair);
    const input=choosePreBattle(initial)[0];pair[0].send(request(pair[0],input,'failed-choice'));
    assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);assert.equal((await pair[0].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);const store=f.store;await f.close();fault.active=false;f=await formalFixture(adapter,store);
    pair=await connect(f,adapter,ids);ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved((await referencePreBattle(codec.restore(before),{0:input})).context));
  }finally{await f.close();}
});
test('real WS missing ACK, foreign actor, stale decision and other room cannot affect the current personal switch',async()=>{
  const initial=await contextAt('switch-select'),before=saved(initial),adapter=adapterFor(initial),f=await formalFixture(adapter);
  try{const a=await connect(f,adapter),b=await connect(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId,input=choosePreBattle(initial)[0];
    a[0].send(a[0].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&m.acked[0]&&!m.acked[1]);
    a[0].send(request(a[0],input,'blocked'));assert.equal((await a[0].wait(m=>m.type==='actionReceipt')).code,'SYNC_BLOCKED');
    a[1].send(a[1].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&!m.blocked);
    a[1].send(request(a[1],input,'wrong-seat'));assert.equal((await a[1].wait(m=>m.type==='actionReceipt')).code,'SEAT_NOT_REQUIRED');
    a[0].send(request(a[0],{kind:'switch-select',pokemonId:111},'foreign'));assert.equal((await a[0].wait(m=>m.type==='actionReceipt')).accepted,false);
    a[0].send({...request(a[0],input,'stale'),decisionId:'old-choice'});assert.equal((await a[0].wait(m=>m.type==='actionReceipt')).code,'STALE_DECISION');
    assert.deepEqual(f.rooms.get(aid).checkpoint,before);assert.deepEqual(f.rooms.get(aid).inputs,{});
    await ready(b);b[0].send(request(b[0],input,'other-room'));assert.equal((await b[0].wait(m=>m.type==='actionReceipt')).accepted,true);await receive(b,1);
    assert.deepEqual(f.rooms.get(aid).checkpoint,before);assert.notDeepEqual(f.rooms.get(bid).checkpoint,before);
  }finally{await f.close();}
});
