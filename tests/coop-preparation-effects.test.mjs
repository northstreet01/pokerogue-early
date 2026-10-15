import test from 'node:test';
import assert from 'node:assert/strict';
import {effectContext,executePreparation,optionAction,validateEffect} from './helpers/preparation-effects-model.mjs';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {types} from './helpers/modifier-model.mjs';
import {atPreparationEnd,projectPreparation,preparationClients as connect} from './helpers/preparation-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy,requireContract as check} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c)),act=operation=>({kind:'preparation',operation});
async function initial(){const c=await effectContext();for(const e of c.roster.entries)if(e.owner!==null)e.pokemon.hp=1;return c;}
function adapterFor(c,options={}){const start=saved(c);return {...safeAdapter('ended'),rulesVersion:'original-owned-preparation-effects-test',
  createInitialContext:()=>codec.restore(start),projectSnapshot:projectPreparation,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:safeCodec.collection(c.decision)}),
  validateAction:validateEffect,
  advanceToDecision(c,inputs){check(!atPreparationEnd(c),'NEXT_BATTLE_RUNNER_UNAVAILABLE');
    const [seat,a]=Object.entries(inputs)[0];return executePreparation(c,Number(seat),a,options);}};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function ack(pair){const revision=pair[0].snapshot.revision;for(const c of pair)c.send(c.acks.shift());
  if(pair[0].snapshot.shared.battle.decision.kind==='preparation')await pair[0].wait(m=>m.type==='syncStatus'&&m.revision===revision&&!m.blocked);}
const message=(c,a,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:id,action:a});
async function accept(pair,seat,a,id,revision){const request=message(pair[seat],a,id);pair[seat].send(request);
  const receipt=await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===id);assert.equal(receipt.accepted,true,receipt.code);
  await receive(pair,revision);return request;}
for(const seat of [0,1])test(`real WS owned shop/reroll seat ${seat} survives every restart without redrawing or charging twice`,async()=>{
  const c=await initial(),adapter=adapterFor(c);let f=await formalFixture(adapter),reference=codec.restore(saved(c));
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId,revision=0,first;
    const actions=[[seat,optionAction(c,seat,'buy','POTION',c.roster.entries.find(e=>e.owner===seat).pokemon.id)],
      [seat,act('reroll')],[seat,act('skip-reward')],[seat,act('ready')],[1-seat,act('skip-reward')],[1-seat,act('ready')]];
    for(const [s,a]of actions){const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);await ack(pair);
      const request=await accept(pair,s,a,`effect-${revision}`,++revision);first??=request;
      reference=(await executePreparation(reference,s,a,{reference:true})).context;assert.deepEqual(f.rooms.get(id).checkpoint,saved(reference));
      for(const x of pair)assert.deepEqual(copy(adapter.projectSnapshot(x.model,x.identity.seat)),copy(adapter.projectSnapshot(reference,x.identity.seat)));
    }
    pair[seat].send(first);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===first.actionId)).accepted,true);
    assert.equal(f.rooms.get(id).revision,revision);assert.ok(atPreparationEnd(reference));
    await ack(pair);assert.equal((await pair[1].wait(m=>m.type==='error')).code,'NEXT_BATTLE_RUNNER_UNAVAILABLE');
    assert.deepEqual(f.rooms.get(id).checkpoint,saved(reference));
  }finally{await f.close();}
});
for(const op of ['buy','reroll'])test(`real WS ${op} result write failure retains durable input, old money/effect and RNG until recovery`,async()=>{
  const c=await initial(),before=saved(c),a=op==='buy'?optionAction(c,0,'buy','POTION',100):act('reroll'),adapter=adapterFor(c);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ack(pair);store.fail=true;
    pair[0].send(message(pair[0],a,'durable-effect'));assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.equal((await pair[0].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(id).checkpoint,before);
    assert.deepEqual(store.data.get(id).checkpoint,before);assert.deepEqual(f.rooms.get(id).inputs[0],a);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);await ack(pair);await receive(pair,1);
    const expected=await executePreparation(codec.restore(before),0,a,{reference:true});assert.deepEqual(f.rooms.get(id).checkpoint,saved(expected.context));
  }finally{await f.close();}
});
test('real WS rejected original update task cannot publish HP or debit and repairs from the same accepted intent',async()=>{
  const c=await initial(),before=saved(c),fault={active:true},adapter=adapterFor(c,{updateInfo:()=>fault.active?Promise.reject(Error('display update')):Promise.resolve()});
  let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ack(pair);
    const a=optionAction(c,0,'buy','POTION',100);pair[0].send(message(pair[0],a,'update-fault'));
    assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);assert.equal((await pair[0].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);const store=f.store;await f.close();fault.active=false;
    f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);await ack(pair);await receive(pair,1);
    const expected=await executePreparation(codec.restore(before),0,a);assert.deepEqual(f.rooms.get(id).checkpoint,saved(expected.context));
  }finally{await f.close();}
});
test('real WS free original reward replay after restart cannot grant twice and keeps the partner inventory private',async()=>{
  const c=await initial(),type=types.modifierTypes.POKEBALL();type.id='POKEBALL';c.decision.players[0].rewards=[{id:'fixture-ball',type:types.captureModifierTypeState(type),cost:0}];
  const adapter=adapterFor(c);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),ids=pair.map(c=>c.identity),id=ids[0].roomId;await ack(pair);
    const a=optionAction(c,0,'reward','POKEBALL'),request=await accept(pair,0,a,'ball-once',1),expected=saved((await executePreparation(c,0,a)).context);
    assert.deepEqual(f.rooms.get(id).checkpoint,expected);const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);await ack(pair);
    pair[0].send(request);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId==='ball-once')).accepted,true);
    assert.deepEqual(f.rooms.get(id).checkpoint,expected);assert.equal(pair[1].snapshot.personal.preparation.rewards[0].id==='fixture-ball',false);
  }finally{await f.close();}
});
test('real WS invalid foreign target or unresolved voucher is rejected before buffering; legal shop remains usable',async()=>{
  const c=await initial(),type=types.modifierTypes.VOUCHER();type.id='VOUCHER';c.decision.players[0].rewards=[{id:'fixture-voucher',type:types.captureModifierTypeState(type),cost:0}];
  const adapter=adapterFor(c),f=await formalFixture(adapter);
  try{const pair=await connect(f,adapter),id=pair[0].identity.roomId;await ack(pair);
    for(const [a,code]of [[optionAction(c,0,'buy','POTION',101),'INVALID_PREPARATION_OWNER'],[optionAction(c,0,'reward','VOUCHER'),'COOP_VOUCHER_RULE_UNCONFIRMED']]){
      pair[0].send(message(pair[0],a,code));const receipt=await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===code);
      assert.equal(receipt.accepted,false);assert.equal(receipt.code,code);assert.deepEqual(f.rooms.get(id).inputs,{});
    }
    await accept(pair,0,optionAction(c,0,'buy','POTION',100),'legal-shop',1);assert.equal(f.rooms.get(id).revision,1);
  }finally{await f.close();}
});
test('real WS missing ACK blocks effects and two rooms keep independent money, menu RNG and pool tables',async()=>{
  const c=await initial(),adapter=adapterFor(c),before=saved(c),f=await formalFixture(adapter);
  try{const a=await connect(f,adapter),b=await connect(f,adapter),aid=a[0].identity.roomId,bid=b[0].identity.roomId;
    a[0].send(a[0].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&m.acked[0]&&!m.acked[1]);
    a[0].send(message(a[0],act('reroll'),'blocked'));assert.equal((await a[0].wait(m=>m.type==='actionReceipt')).code,'SYNC_BLOCKED');
    assert.deepEqual(f.rooms.get(aid).checkpoint,before);a[1].send(a[1].acks.shift());await a[0].wait(m=>m.type==='syncStatus'&&!m.blocked);
    await accept(a,0,act('reroll'),'a-reroll',1);assert.deepEqual(f.rooms.get(bid).checkpoint,before);
    await ack(b);await accept(b,0,act('reroll'),'b-reroll',1);assert.deepEqual(f.rooms.get(aid).checkpoint,f.rooms.get(bid).checkpoint);
  }finally{await f.close();}
});
