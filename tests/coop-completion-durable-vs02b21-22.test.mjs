import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {createOriginalRuleHost} from '../server/original-rule-host.mjs';
import {FormalRoomStore} from '../server/formal-coop-service.mjs';
import {canonical} from '../src/battle-core/coop-contract.mjs';
import {defaultTrainerRoute,progressDefault} from './helpers/native-default-trainer.mjs';
import {naturalConfig,naturalSelection} from './helpers/native-natural-learning.mjs';
import {openPreparationRoom,until,request,raw,advance} from './helpers/native-preparation-ws.mjs';
import {originalI18n} from './helpers/localization-model.mjs';
import {renderPresentationText} from '../src/system/presentation-text.mjs';
let api,shared,evolution,naturalEvents;
before(async()=>{
 await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
 const route=await defaultTrainerRoute();
 naturalEvents=route.trace.flatMap(step=>step.events);
 try{let c=route.initial;for(let n=0;n<80;n++){
  const front=(c.continuation.phaseQueuePrepend.at(-1)??c.continuation.phaseQueue[0])?.phase.type;
  if(c.decision.kind==='continuing'&&front==='SelectModifierPhase'){shared=(await route.h.request('native-preparation-shared',c)).checkpoint;break;}
  c=(await progressDefault(route.h,c)).checkpoint;
 }assert.ok(shared);}finally{await route.h.close();}
 const h=await createOriginalRuleHost(naturalConfig);
 try{const selection=structuredClone(naturalSelection);selection.starterSelections[0][0].speciesId=10;selection.starterSelections[0][0].moveset=null;
  let c=(await h.request('native-open-selected-to-input',selection)).checkpoint;
  for(let n=0;n<160&&c.decision.kind!=='evolution';n++)c=(await progressDefault(h,c)).checkpoint;
  assert.equal(c.decision.kind,'evolution');evolution=c;
 }finally{await h.close();}
});
const free=(client)=>({kind:'preparation',operation:'reward',optionId:client.latest.personal.decision.players.rewards.find(o=>['POKEBALL','GREAT_BALL','ULTRA_BALL','NUGGET','BIG_NUGGET'].includes(o.type.catalogId)).id,pokemonId:null,moveIndex:null,fusionId:null});
const roomCheckpoint=(env,pair)=>env.server.rooms.get(pair[0].identity.roomId).checkpoint;

test('real native battle messages can render in either language without changing their checkpoint, parameters or RNG',async()=>{
 const before=canonical(shared),texts=naturalEvents.filter(e=>e.presentation&&['message','dialogue'].includes(e.kind));
 assert.ok(texts.length>10);assert.ok(texts.some(e=>e.presentation.key==='battle:useMove'));
 for(const e of texts){
  const wire=canonical(e.presentation),outputs={};
  for(const lng of ['en','zh-Hans']){
   outputs[lng]=renderPresentationText(e.presentation,(key,values)=>originalI18n.t(key,{...values,lng}),()=>undefined);
   assert.equal(typeof outputs[lng],'string');assert.doesNotMatch(outputs[lng],/\{\{|(?:battle|pokemon|move|earlyBattle|earlyDialogue):/u);
  }
  assert.equal(canonical(e.presentation),wire);
  if(e.presentation.key==='battle:useMove'){assert.match(outputs['zh-Hans'],/使用了/);assert.match(outputs.en,/used/);}
 }
 assert.equal(canonical(shared),before);
});

test('shared stock serializes simultaneous claims and rejects the loser again at the current revision',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'vs22-stock-')),env=await openPreparationRoom({api,checkpoint:shared,store:new FormalRoomStore(directory)});
 try{const pair=env.pair,initial=canonical(roomCheckpoint(env,pair)),messages=pair.map(c=>request(c,free(c)));
  const isolated=await env.connectPair(),isolatedBefore=canonical(roomCheckpoint(env,isolated));
  messages.forEach((m,i)=>pair[i].send(m));
  const receipts=await Promise.all(pair.map((c,i)=>c.wait(m=>m.type==='actionReceipt'&&m.actionId===messages[i].actionId)));
  assert.equal(receipts.filter(r=>r.accepted).length,1);
  assert.ok(['STALE_DECISION','SYNC_BLOCKED'].includes(receipts.find(r=>!r.accepted).code));
  await until(()=>pair.every(c=>c.ready&&c.latest.personal.decision.sharedMarket.finished.some(Boolean)),'one shared claim');
  const winner=receipts.findIndex(r=>r.accepted),loser=1-winner,committed=roomCheckpoint(env,pair);
  assert.deepEqual(committed.nativeCheckpoint.decision.shared.rewardClaims,[{optionId:messages[winner].action.optionId,seat:winner}]);
  assert.notEqual(canonical(committed),initial);
  const retry=request(pair[loser],messages[loser].action);pair[loser].send(retry);
  const rejected=await pair[loser].wait(m=>m.type==='actionReceipt'&&m.actionId===retry.actionId);
  assert.equal(rejected.accepted,false);assert.equal(rejected.code,'INVALID_ACTION');
  assert.equal(canonical(roomCheckpoint(env,isolated)),isolatedBefore);
  const before=pair[winner].latest.revision;pair[winner].send(messages[winner]);
  assert.equal((await pair[winner].wait(m=>m.type==='actionReceipt'&&m.actionId===messages[winner].actionId)).accepted,true);
  assert.equal(pair[winner].latest.revision,before);
  await advance(pair,loser,{kind:'preparation',operation:'skip-reward'});
  assert.notEqual(pair[0].latest.personal.decision.kind,'preparation');
  const questions=new Set();
  for(let guard=0;guard<8&&pair[0].latest.personal.decision.kind!=='wait-actions';guard++){
   for(const client of pair)for(const event of client.latest.events.filter(e=>e.messageKey==='battle:switchQuestion')){
    assert.equal(event.scope,client.latest.seat,'only the owner receives the actual native question');questions.add(client.latest.seat);
   }
   const owner=pair.findIndex(c=>c.latest.personal.decision.requiredSeats.includes(c.latest.seat));assert.ok(owner>=0);
   const option=pair[owner].latest.personal.decision.options.find(o=>o.accept===false||o.pokemonId===null);assert.ok(option);
   await advance(pair,owner,option);
  }
  assert.deepEqual([...questions].sort(),[0,1]);assert.equal(pair[0].latest.personal.decision.kind,'wait-actions');
  for(const c of pair)assert.ok(c.latest.events.every(e=>e.scope==='shared'||e.scope===c.latest.seat));
 }finally{await env.close();await rm(directory,{recursive:true,force:true});}
});

test('shared paid stock and personal charge roll back together on disk failure and recover exactly once',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'vs22-paid-'));
 class FailingStore extends FormalRoomStore{fail=true;async save(room){if(this.fail&&room.checkpoint.nativeCheckpoint?.decision.shared?.shopClaims.length){this.fail=false;throw Error('TEST_SHARED_RESULT_DISK_FAILED');}return super.save(room);}}
 const store=new FailingStore(directory);let env=await openPreparationRoom({api,checkpoint:shared,store});
 try{let pair=env.pair;
  const owner=pair.findIndex(c=>c.latest.personal.party.some(e=>e.pokemon.fields.hp>0&&e.pokemon.fields.hp<e.pokemon.fields.stats[0]));assert.ok(owner>=0);
  const before=structuredClone(roomCheckpoint(env,pair)),s=pair[owner].latest;
  const potion=s.personal.decision.players.shop.find(o=>o.type.catalogId==='POTION'),target=s.personal.party.find(e=>e.pokemon.fields.hp>0&&e.pokemon.fields.hp<e.pokemon.fields.stats[0]);assert.ok(potion);
  const message=await raw(pair[owner],{kind:'preparation',operation:'buy',optionId:potion.id,pokemonId:target.id,moveIndex:null,fusionId:null});
  await until(()=>pair.some(c=>c.errors.includes('STORAGE_FAILED')),'failed result save');
  const [failed]=await store.load();assert.deepEqual(failed.checkpoint,before);assert.equal(failed.inputs[owner].operation,'buy');
  const tokens=pair.map(c=>c.identity);await env.close();env=await openPreparationRoom({api,checkpoint:shared,store:new FormalRoomStore(directory),old:tokens});pair=env.pair;
  await until(()=>pair.every(c=>c.ready&&c.latest.personal.decision.sharedMarket.shopClaims.length===1),'recovered paid stock');
  const committed=structuredClone(roomCheckpoint(env,pair)),native=committed.nativeCheckpoint;
  assert.equal(native.players[owner].money,before.nativeCheckpoint.players[owner].money-potion.cost);
  assert.deepEqual(native.players[1-owner],before.nativeCheckpoint.players[1-owner]);
  assert.deepEqual(native.decision.shared.shopClaims,[{optionId:potion.id,seat:owner}]);
  pair[owner].send(message);assert.equal((await pair[owner].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId)).accepted,true);
  const tokens2=pair.map(c=>c.identity);await env.close();env=await openPreparationRoom({api,checkpoint:shared,store:new FormalRoomStore(directory),old:tokens2});
  assert.deepEqual(roomCheckpoint(env,env.pair),committed);
 }finally{await env.close();await rm(directory,{recursive:true,force:true});}
});

test('natural evolution commits once across disk failure and restart, and private growth data never reaches the other seat',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'vs22-evolve-'));
 class FailingStore extends FormalRoomStore{fail=true;async save(room){const p=room.checkpoint.nativeCheckpoint?.roster.entries.find(e=>e.owner===0&&e.group==='party'&&e.index===0);if(this.fail&&p?.pokemon.fields.species===11){this.fail=false;throw Error('TEST_EVOLUTION_RESULT_DISK_FAILED');}return super.save(room);}}
 const store=new FailingStore(directory);let env=await openPreparationRoom({api,checkpoint:evolution,store,stage:'learning'});
 try{let pair=env.pair;const before=structuredClone(roomCheckpoint(env,pair)),s=pair[0].latest;
  assert.equal(s.personal.decision.kind,'evolution');assert.equal(pair[1].latest.personal.decision.options,null);assert.equal(pair[1].latest.personal.decision.evolution,undefined);
  const message=await raw(pair[0],{kind:'evolution',pokemonId:evolution.decision.pokemonId,choice:'evolve'});
  await until(()=>pair.some(c=>c.errors.length),'failed evolution save');
  assert.ok(pair.some(c=>c.errors.includes('STORAGE_FAILED')),JSON.stringify({errors:pair.map(c=>c.errors),failures:env.failures}));
  const [failed]=await store.load();assert.deepEqual(failed.checkpoint,before);assert.equal(failed.inputs[0].kind,'evolution');
  const tokens=pair.map(c=>c.identity);await env.close();env=await openPreparationRoom({api,checkpoint:evolution,store:new FormalRoomStore(directory),old:tokens,stage:'learning'});pair=env.pair;
  await until(()=>pair.every(c=>c.ready)&&pair[0].latest.personal.party[0].pokemon.fields.species===11,'recovered original evolution');
  const committed=structuredClone(roomCheckpoint(env,pair));
  assert.ok(committed.intents.some(i=>i.type==='evolution-pending'));
  assert.deepEqual(pair[1].latest.personal.party.map(e=>e.pokemon.fields.species),before.nativeCheckpoint.roster.entries.filter(e=>e.owner===1&&e.group==='party').sort((a,b)=>a.index-b.index).map(e=>e.pokemon.fields.species));
  for(const client of pair)for(const e of client.latest.events){assert.ok(e.scope==='shared'||e.scope===client.latest.seat);if(['pokemon-progress','level-stats','evolution-display'].includes(e.kind))assert.equal(e.scope,client.latest.seat);}
  pair[0].send(message);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId)).accepted,true);
  assert.deepEqual(roomCheckpoint(env,pair),committed);
  const tokens2=pair.map(c=>c.identity);await env.close();env=await openPreparationRoom({api,checkpoint:evolution,store:new FormalRoomStore(directory),old:tokens2,stage:'learning'});
  assert.deepEqual(roomCheckpoint(env,env.pair),committed);
 }finally{await env.close();await rm(directory,{recursive:true,force:true});}
});
