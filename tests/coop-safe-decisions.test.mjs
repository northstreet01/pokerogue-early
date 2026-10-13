import test from 'node:test';
import assert from 'node:assert/strict';
import {codec,modifierCodec} from './helpers/decision-model.mjs';
import {safeAdapter,safeContext} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {createSnapshotConsumer} from '../src/battle-core/coop-client.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

async function clients(f,adapter,identities){
  const pair=[await f.client(),await f.client()];
  for(const [seat,c]of pair.entries()){
    c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}:seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',name:'B',roomId:pair[0].identity.roomId});
    c.identity=await c.wait(m=>m.type==='welcome');
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.send(m),adapter:{
      applySnapshot(snapshot){
        const checkpoint=copy(snapshot.shared),p=snapshot.personal.resources;
        checkpoint.players[seat]={money:p.money,pokeballCounts:copy(p.pokeballCounts),modifiers:p.modifiers.map(state=>{const id=checkpoint.components.length;checkpoint.components.push({kind:'modifier',state});return id;})};
        const candidate=codec.restore(checkpoint);c.model=candidate;
      },captureAppliedState:()=>adapter.projectSnapshot(c.model,seat),async applyGrantsTransaction(grants){assert.deepEqual(grants,[]);}
    }});
  }
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot');await c.consume(c.snapshot);}
  await pair[0].wait(m=>m.type==='syncStatus'&&!m.blocked);return pair;
}
const message=(c,action,actionId)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId,action});
async function accept(pair,seat,action,id,revision){
  const m=message(pair[seat],action,id);pair[seat].send(m);const receipt=await pair[seat].wait(v=>v.type==='actionReceipt'&&v.actionId===id);assert.equal(receipt.accepted,true,receipt.code);
  for(const c of pair){c.snapshot=await c.wait(v=>v.type==='snapshot'&&v.revision===revision);await c.consume(c.snapshot);}
  await pair[0].wait(v=>v.type==='syncStatus'&&v.revision===revision&&!v.blocked);return m;
}

test('real WS map persists disagreement, restart and changed choice; one input commits without waiting for the partner',async()=>{
  const adapter=safeAdapter('map');let f=await formalFixture(adapter);
  try {
    let pair=await clients(f,adapter);const identities=pair.map(c=>c.identity),store=f.store;
    const reference=adapter.createInitialContext();const expected=await adapter.advanceToDecision(reference,{0:{kind:'map',biome:1}});
    const first=await accept(pair,0,{kind:'map',biome:1},'map-a',1);assert.deepEqual(f.rooms.get(identities[0].roomId).checkpoint,codec.capture(expected.context));
    await accept(pair,1,{kind:'map',biome:2},'map-b',2);assert.deepEqual(pair[0].model.decision.choices,[1,2]);
    await f.close();f=await formalFixture(adapter,store);pair=await clients(f,adapter,identities);
    pair[0].send(first);assert.equal((await pair[0].wait(v=>v.type==='actionReceipt'&&v.actionId==='map-a')).accepted,true);assert.equal(f.rooms.get(identities[0].roomId).revision,2);
    await accept(pair,0,{kind:'map',biome:2},'map-change-a',3);assert.equal(pair[0].model.decision.id,'battle-after-map');assert.equal(pair[1].model.arena.biomeType,2);
    assert.notEqual(pair[0].model.continuation.phaseQueuePrepend[0].phase,pair[1].model.continuation.phaseQueuePrepend[0].phase);
    assert.equal(pair[0].model.continuation.phaseQueuePrepend[0].phase.nextBiome,2);
  }finally{await f.close();}
});

test('real WS independent preparation restores one ready player and original reward effects; costs stay personal',async()=>{
  const adapter=safeAdapter('preparation');let f=await formalFixture(adapter);
  try {
    let pair=await clients(f,adapter);const identities=pair.map(c=>c.identity),store=f.store;
    assert.equal(pair[0].model.players[1].money,0);assert.equal(pair[1].model.players[0].money,0);
    await accept(pair,0,{kind:'preparation',operation:'skip-reward'},'skip-a',1);
    await accept(pair,0,{kind:'preparation',operation:'ready'},'ready-a',2);
    await f.close();f=await formalFixture(adapter,store);pair=await clients(f,adapter,identities);
    assert.equal(pair[0].model.decision.players[0].ready,true);assert.equal(pair[1].model.decision.players[1].ready,false);
    await accept(pair,1,{kind:'preparation',operation:'reward',optionId:'reward-potion',pokemonId:101,moveIndex:null,fusionId:null},'reward-b',3);
    assert.equal(pair[1].model.roster.entries[1].pokemon.hp,30);
    await accept(pair,1,{kind:'preparation',operation:'buy',optionId:'shop-potion',pokemonId:101,moveIndex:null,fusionId:null},'buy-b',4);
    assert.equal(pair[0].model.players[0].money,1000);assert.equal(pair[1].model.players[1].money,900);
    await accept(pair,1,{kind:'preparation',operation:'ready'},'ready-b',5);assert.equal(pair[0].model.decision.id,'battle-after-preparation');
  }finally{await f.close();}
});

test('real WS preparation preserves partner readiness through restored evolution cancel and pause',async()=>{
  const adapter={...safeAdapter('preparation'),createInitialContext(){
    const c=safeContext('preparation'),e=safeContext('evolution');c.roster.entries[0].pokemon=e.roster.entries[0].pokemon;
    c.decision.players[0].rewardResolved=true;c.decision.players[0].subdecision=e.decision;return c;
  }};
  let f=await formalFixture(adapter);
  try{
    let pair=await clients(f,adapter),identities=pair.map(c=>c.identity);
    await accept(pair,1,{kind:'preparation',operation:'skip-reward'},'skip',1);
    await accept(pair,1,{kind:'preparation',operation:'ready'},'ready',2);
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await clients(f,adapter,identities);
    await accept(pair,0,{kind:'evolution',pokemonId:100,choice:'cancel'},'cancel',3);
    assert.equal(pair[1].model.decision.players[1].ready,true);
    await accept(pair,0,{kind:'evolution',pokemonId:100,choice:'pause'},'pause',4);
    assert.equal(pair[0].model.roster.entries[0].pokemon.pauseEvolutions,true);
    assert.equal(pair[0].model.decision.players[0].subdecision,null);
    await accept(pair,0,{kind:'preparation',operation:'ready'},'ready-a',5);
    assert.equal(pair[1].model.decision.id,'battle-after-preparation');
  }finally{await f.close();}
});

for(const kind of ['starter-ready','evolution','ended'])test(`real WS ${kind} restores applied original models and same safe-boundary results`,async()=>{
  const adapter=safeAdapter(kind);let f=await formalFixture(adapter);
  try {
    let pair=await clients(f,adapter);const identities=pair.map(c=>c.identity),store=f.store;
    if(kind==='starter-ready')await accept(pair,0,{kind,ready:true},'first-ready',1);
    await f.close();f=await formalFixture(adapter,store);pair=await clients(f,adapter,identities);
    if(kind==='starter-ready')await accept(pair,1,{kind,ready:true},'second-ready',2);
    else if(kind==='evolution'){
      const reference=await adapter.advanceToDecision(adapter.createInitialContext(),{0:{kind,pokemonId:100,choice:'evolve'}});
      await accept(pair,0,{kind,pokemonId:100,choice:'evolve'},'evolve',1);
      for(const c of pair){assert.deepEqual(c.snapshot.events,reference.events);assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(reference.context,c.identity.seat));}
    } else {
      pair[0].send(message(pair[0],{kind:'test-continue'},'invalid-ended'));
      assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).code,'SEAT_NOT_REQUIRED');assert.equal(f.rooms.get(identities[0].roomId).revision,0);
    }
    assert.notEqual(pair[0].model.roster.entries[0].pokemon,pair[1].model.roster.entries[0].pokemon);
  }finally{await f.close();}
});

test('incremental decision result write failure retains one accepted input; restart replays exactly once',async()=>{
  const adapter=safeAdapter('preparation'),store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try {
    let pair=await clients(f,adapter);const identities=pair.map(c=>c.identity),roomId=identities[0].roomId,before=copy(f.rooms.get(roomId).checkpoint);
    store.fail=true;const action={kind:'preparation',operation:'reroll'},sent=message(pair[0],action,'reroll-once');pair[0].send(sent);
    assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);assert.equal((await pair[0].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(roomId).checkpoint,before);assert.equal(Object.keys(store.data.get(roomId).inputs).length,1);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await clients(f,adapter,identities);
    const expected=await adapter.advanceToDecision(codec.restore(before),{0:action});
    for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===1);await c.consume(c.snapshot);assert.deepEqual(c.snapshot.events,expected.events);}
    assert.deepEqual(f.rooms.get(roomId).checkpoint,codec.capture(expected.context));
    pair[0].send(sent);await pair[0].wait(m=>m.type==='actionReceipt');assert.equal(f.rooms.get(roomId).revision,1);assert.equal(pair[0].model.players[0].money,750);
  }finally{store.fail=false;await f.close();}
});
