import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {finalBossFixture,finalBossTrace} from './helpers/native-final-boss.mjs';
import {forcedProgressionHost} from './helpers/forced-progression-host.mjs';
import {steadyInput} from './helpers/native-steady-progression.mjs';
import {openPreparationRoom,request,until} from './helpers/native-preparation-ws.mjs';
import {FormalRoomStore} from '../server/formal-coop-service.mjs';
let api,fixture,trace;
before(async()=>{await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();fixture=await finalBossFixture(api);trace=await finalBossTrace(api,fixture.checkpoint);});
const boss=c=>c.roster.entries.find(e=>e.owner===null).pokemon.fields;
for(const stage of ['first','second','last'])for(const failWrite of [false,true])test(`single Boss ${stage}: dual WS/original ACK, accepted-input disk recovery, conflict and result write failure ${failWrite}`,async()=>{
 const battles=trace.boundaries.filter(c=>c.decision.kind==='wait-actions');
 const c=stage==='first'?battles[0]:stage==='second'?battles.find(c=>boss(c).formIndex===1):battles.at(-1);
 assert.ok(c,stage);
 const directory=await fs.mkdtemp(resolve('build/vs02b24/final-ws-')),base=new FormalRoomStore(directory);let fail=false;
 const store={load:()=>base.load(),save:room=>{if(fail&&room.revision===1)throw Error('TEST_FINAL_RESULT_WRITE_FAILED');return base.save(room);}};
 const settings={api,checkpoint:c,stage:'battle',hostFactory:forcedProgressionHost};let env=await openPreparationRoom({...settings,store});
 try{
  let pair=env.pair;const roomId=pair[0].identity.roomId,tokens=pair.map(p=>p.identity),initial=structuredClone(env.server.rooms.get(roomId).checkpoint);
  const inputs=steadyInput(api,c);assert.deepEqual(Object.keys(inputs),['0','1']);
  const messages=pair.map((p,seat)=>request(p,inputs[seat]));
  const other=c.roster.entries.find(e=>e.owner===1&&e.index===0).pokemon.fields.id;
  const forbidden=request(pair[0],{...inputs[0],pokemonId:other});pair[0].send(forbidden);
  assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===forbidden.actionId)).accepted,false);
  pair[0].send(messages[0]);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===messages[0].actionId)).accepted,true);
  assert.deepEqual(env.server.rooms.get(roomId).checkpoint,initial);
  const [disk]=await base.load();assert.deepEqual(Object.keys(disk.inputs),['0']);
  await env.close();env=await openPreparationRoom({...settings,store,old:tokens});pair=env.pair;
  assert.deepEqual(env.server.rooms.get(roomId).checkpoint,initial);
  assert.deepEqual(Object.keys(env.server.rooms.get(roomId).inputs),['0']);
  fail=failWrite;pair[1].send(messages[1]);assert.equal((await pair[1].wait(m=>m.type==='actionReceipt'&&m.actionId===messages[1].actionId)).accepted,true);
  if(failWrite){await pair[0].wait(m=>m.type==='syncStatus'&&m.reason==='STORAGE_FAILED');assert.deepEqual(env.server.rooms.get(roomId).checkpoint,initial);}
  else await until(()=>pair.every(p=>p.ready&&p.latest.revision===1),'committed Boss round and both original model ACKs');
  await env.close();fail=false;env=await openPreparationRoom({...settings,store:new FormalRoomStore(directory),old:tokens});pair=env.pair;
  await until(()=>pair.every(p=>p.ready&&p.latest.revision===1),'accepted Boss inputs replay from disk');
  const committed=structuredClone(env.server.rooms.get(roomId).checkpoint);
  assert.deepEqual(committed.nativeCheckpoint.battle.enemyParty,[boss(c).id]);
  for(const seat of [0,1])assert.ok(pair[seat].latest.shared.pokemon.filter(p=>p.owner===null).length<=1);
  for(const seat of [0,1]){pair[seat].send(messages[seat]);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===messages[seat].actionId)).accepted,true);}
  assert.deepEqual(env.server.rooms.get(roomId).checkpoint,committed);
  pair[0].send({...messages[0],action:{...inputs[0],pokemonId:other}});
  await pair[0].wait(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT');await pair[0].chain;pair[0].errors.length=0;
  assert.deepEqual(env.server.rooms.get(roomId).checkpoint,committed);
  if(stage==='last'){
   let last=[];
   for(let n=0;n<80&&env.server.rooms.get(roomId).checkpoint.nativeCheckpoint.decision.kind!=='ended';n++){
    const current=env.server.rooms.get(roomId).checkpoint.nativeCheckpoint,revision=pair[0].latest.revision;
    last=Object.entries(steadyInput(api,current)).map(([seat,action])=>({seat:Number(seat),message:request(pair[seat],action)}));
    for(const {seat,message}of last){pair[seat].send(message);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId)).accepted,true);}
    await until(()=>pair.every(p=>p.ready&&p.latest.revision>revision),'final owned choice');
   }
   const terminal=structuredClone(env.server.rooms.get(roomId).checkpoint);
   assert.equal(terminal.nativeCheckpoint.decision.victory,true);
   assert.deepEqual(terminal.intents.filter(i=>i.type==='completion-pending').map(i=>i.owner).sort(),[0,1]);
   assert.deepEqual(terminal.intents.filter(i=>i.type==='voucher-pending').map(i=>i.owner).sort(),[0,1]);
   await env.close();env=await openPreparationRoom({...settings,store:new FormalRoomStore(directory),old:tokens});pair=env.pair;
   assert.deepEqual(env.server.rooms.get(roomId).checkpoint,terminal);
   for(const {seat,message}of last){pair[seat].send(message);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId)).accepted,true);}
   assert.deepEqual(env.server.rooms.get(roomId).checkpoint,terminal);
  }
 }finally{await env.close();}
});

test('legacy two-Boss disk resume preserves both enemies; another room cannot consume its saved input',async()=>{
 const legacy=await finalBossFixture(api,{legacy:true}),c=legacy.checkpoint;
 const directory=await fs.mkdtemp(resolve('build/vs02b24/legacy-ws-'));
 const settings={api,checkpoint:c,stage:'battle'};let env=await openPreparationRoom({...settings,store:new FormalRoomStore(directory)}),other;
 try{
  const pair=env.pair,tokens=pair.map(p=>p.identity),roomId=tokens[0].roomId;
  const checkpoint=structuredClone(env.server.rooms.get(roomId).checkpoint),action=steadyInput(api,c)[0],message=request(pair[0],action);
  assert.equal(checkpoint.nativeCheckpoint.battle.enemyParty.length,2);
  pair[0].send(message);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId)).accepted,true);
  other=await openPreparationRoom({api,checkpoint:fixture.checkpoint,stage:'battle'});
  const second=request(other.pair[0],steadyInput(api,fixture.checkpoint)[0]);second.actionId=message.actionId;
  other.pair[0].send(second);assert.equal((await other.pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===second.actionId)).accepted,true);
  assert.deepEqual(env.server.rooms.get(roomId).checkpoint,checkpoint);
  await env.close();env=await openPreparationRoom({...settings,store:new FormalRoomStore(directory),old:tokens});
  assert.deepEqual(env.server.rooms.get(roomId).checkpoint,checkpoint);
  assert.deepEqual(Object.keys(env.server.rooms.get(roomId).inputs),['0']);
  assert.equal(env.pair[0].latest.shared.pokemon.filter(p=>p.owner===null).length,2);
 }finally{await env.close();if(other)await other.close();}
});
