import test from 'node:test';
import assert from 'node:assert/strict';
import {growthContext,growthIntent,growthChoice,executeGrowth,validateGrowth,projectGrowth,growthClients} from './helpers/preparation-growth-model.mjs';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {types} from './helpers/modifier-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c));
function adapterFor(c,options={}){const start=saved(c);return {...safeAdapter('ended'),rulesVersion:'original-preparation-growth-test',
  createInitialContext:()=>codec.restore(start),projectSnapshot:projectGrowth,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:safeCodec.collection(c.decision)}),
  validateAction:validateGrowth,
  advanceToDecision(c,inputs){const [seat,a]=Object.entries(inputs)[0];return executeGrowth(c,Number(seat),a,options);}};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);assert.equal(await c.consume(c.snapshot),true);}}
async function ack(pair){const revision=pair[0].snapshot.revision;for(const c of pair)c.send(c.acks.shift());await pair[0].wait(m=>m.type==='syncStatus'&&m.revision===revision&&!m.blocked);}
const message=(c,a,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,
  expectedRevision:c.snapshot.revision,actionId:id,action:a});
async function accept(pair,seat,a,id,revision){const request=message(pair[seat],a,id);pair[seat].send(request);
  const receipt=await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===id);assert.equal(receipt.accepted,true,receipt.code);
  await receive(pair,revision);return request;}
for(const seat of [0,1])test(`real WS candy seat ${seat} restores each personal learning stop and never grants twice`,async()=>{
  const c=await growthContext({seat,full:true,all:true}),adapter=adapterFor(c);let expected=c,f=await formalFixture(adapter);
  try{let pair=await growthClients(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId,revision=0;await ack(pair);
    for(let step=0;step<10;step++){
      const a=step===0?growthIntent(expected,seat):growthChoice(expected,seat),request=await accept(pair,seat,a,`growth-${step}`,++revision);
      expected=(await executeGrowth(expected,seat,a,{reference:true})).context;assert.deepEqual(f.rooms.get(id).checkpoint,saved(expected));
      for(const x of pair)assert.deepEqual(copy(adapter.projectSnapshot(x.model,x.identity.seat)),copy(adapter.projectSnapshot(expected,x.identity.seat)));
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await growthClients(f,adapter,ids);await ack(pair);
      pair[seat].send(request);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===`growth-${step}`)).accepted,true);
      assert.equal(f.rooms.get(id).revision,revision);assert.deepEqual(f.rooms.get(id).checkpoint,saved(expected));
      if(expected.decision.players[seat].subdecision===null)break;
    }
    assert.equal(expected.decision.players[seat].subdecision,null);assert.equal(expected.pendingEffects.length,2);
  }finally{await f.close();}
});
test('real WS candy evolution cancel and pause restart on the saved original method, keeping menus readyable',async()=>{
  let expected=await growthContext({level:15});const adapter=adapterFor(expected);let f=await formalFixture(adapter);
  try{let pair=await growthClients(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId,revision=0;await ack(pair);
    for(const stage of ['candy','cancel','pause']){
      const a=stage==='candy'?growthIntent(expected):growthChoice(expected,0,{evolve:'cancel',pause:'pause'});
      await accept(pair,0,a,stage,++revision);expected=(await executeGrowth(expected,0,a,{reference:true})).context;
      assert.deepEqual(f.rooms.get(id).checkpoint,saved(expected));const store=f.store;await f.close();f=await formalFixture(adapter,store);
      pair=await growthClients(f,adapter,ids);await ack(pair);
    }
    assert.equal(expected.roster.entries[0].pokemon.pauseEvolutions,true);assert.equal(expected.roster.entries[0].pokemon.species.speciesId,1);
    for(const [seat,a]of [[1,{kind:'preparation',operation:'skip-reward'}],[0,{kind:'preparation',operation:'ready'}],[1,{kind:'preparation',operation:'ready'}]]){
      await accept(pair,seat,a,`ready-${revision}`,++revision);expected=(await executeGrowth(expected,seat,a)).context;await ack(pair);
    }
    assert.equal(f.rooms.get(id).checkpoint.decision.reason,'next-battle');
  }finally{await f.close();}
});
for(const stage of ['candy','learn','evolution','pause'])test(`real WS ${stage} result write failure retains old levels, choices and saved input then resumes once`,async()=>{
  let c=await growthContext({full:stage==='learn',level:['evolution','pause'].includes(stage)?15:5});
  if(stage!=='candy')c=(await executeGrowth(c,0,growthIntent(c))).context;
  if(stage==='pause')c=(await executeGrowth(c,0,growthChoice(c,0,{evolve:'cancel'}))).context;
  const before=saved(c),a=stage==='candy'?growthIntent(c):growthChoice(c,0),adapter=adapterFor(c);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await growthClients(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ack(pair);store.fail=true;
    pair[0].send(message(pair[0],a,'durable-growth'));assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.equal((await pair[0].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    assert.deepEqual(store.data.get(id).checkpoint,before);assert.deepEqual(f.rooms.get(id).inputs[0],a);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await growthClients(f,adapter,ids);await ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved((await executeGrowth(codec.restore(before),0,a,{reference:true})).context));
  }finally{await f.close();}
});
test('real WS original growth task failure publishes no level or menu change and repairs durable candy after restart',async()=>{
  const c=await growthContext(),before=saved(c),fault={active:true};
  const adapter=adapterFor(c,{onProgressionBind:(_c,_p,_b,tasks)=>{if(fault.active)tasks.add(Promise.reject(Error('growth')));}});let f=await formalFixture(adapter);
  try{let pair=await growthClients(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ack(pair);
    pair[0].send(message(pair[0],growthIntent(c),'failed-level'));assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.equal((await pair[0].wait(m=>m.type==='error')).code,'RUNNER_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.active=false;f=await formalFixture(adapter,store);pair=await growthClients(f,adapter,ids);await ack(pair);await receive(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved((await executeGrowth(c,0,growthIntent(c))).context));
  }finally{await f.close();}
});
test('real WS two personal evolution stops stay private while the other player completes and readies independently',async()=>{
  let c=await growthContext({level:15});const pk=c.roster.entries.find(e=>e.owner===1&&e.index===0).pokemon;pk.level=15;pk.exp=3375;pk.levelExp=0;
  const t=types.modifierTypes.RARE_CANDY();t.id='RARE_CANDY';c.decision.players[1].rewards=[{id:'other-candy',type:types.captureModifierTypeState(t),cost:0}];
  const adapter=adapterFor(c);let f=await formalFixture(adapter);
  try{let pair=await growthClients(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId,revision=0;await ack(pair);
    for(const seat of [0,1]){const a=growthIntent(c,seat);await accept(pair,seat,a,`candy-${seat}`,++revision);c=(await executeGrowth(c,seat,a)).context;await ack(pair);}
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await growthClients(f,adapter,ids);await ack(pair);
    for(const seat of [0,1]){assert.equal(pair[seat].snapshot.shared.battle.decision.players[1-seat].subdecision,null);
      assert.ok(pair[seat].snapshot.personal.growth.every(e=>e.phase.scope===seat));}
    let a=growthChoice(c,1);await accept(pair,1,a,'evolve-one',++revision);c=(await executeGrowth(c,1,a)).context;await ack(pair);
    a={kind:'preparation',operation:'ready'};await accept(pair,1,a,'ready-one',++revision);c=(await executeGrowth(c,1,a)).context;await ack(pair);
    assert.equal(c.decision.players[0].subdecision.kind,'evolution');assert.equal(c.decision.players[1].ready,true);
    a=growthChoice(c,0);await accept(pair,0,a,'evolve-zero',++revision);c=(await executeGrowth(c,0,a)).context;
    assert.deepEqual(f.rooms.get(id).checkpoint,saved(c));
  }finally{await f.close();}
});
test('real WS growth foreign and invalid choices reject before buffering; missing ACK and other rooms remain isolated',async()=>{
  let c=await growthContext({full:true});c=(await executeGrowth(c,0,growthIntent(c))).context;const adapter=adapterFor(c),before=saved(c),f=await formalFixture(adapter);
  try{const a=await growthClients(f,adapter),b=await growthClients(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId;
    a[0].send(a[0].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&m.acked[0]&&!m.acked[1]);
    a[0].send(message(a[0],growthChoice(c,0),'blocked'));assert.equal((await a[0].wait(m=>m.type==='actionReceipt')).code,'SYNC_BLOCKED');
    a[1].send(a[1].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&!m.blocked);
    for(const [seat,choice]of [[1,growthChoice(c,0)],[0,growthChoice(c,0,{slot:4})]]){
      const id=`bad-${seat}`;a[seat].send(message(a[seat],choice,id));assert.equal((await a[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===id)).accepted,false);
      assert.deepEqual(f.rooms.get(aid).inputs,{});assert.deepEqual(f.rooms.get(aid).checkpoint,before);
    }
    await accept(a,0,growthChoice(c,0),'room-a',1);assert.deepEqual(f.rooms.get(bid).checkpoint,before);
    await ack(b);await accept(b,0,growthChoice(c,0),'room-b',1);assert.deepEqual(f.rooms.get(aid).checkpoint,f.rooms.get(bid).checkpoint);
  }finally{await f.close();}
});
