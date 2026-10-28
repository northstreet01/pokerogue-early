import test,{before,after}from'node:test';
import assert from'node:assert/strict';import{createRequire}from'node:module';import fs from'node:fs/promises';import{resolve}from'node:path';
import{buildCoopRuntime}from'../scripts/build-coop-runtime.mjs';
import{originalPreparationFixture,growthItemFixture,member,reward}from'./helpers/growth-items-fixture.mjs';
import{openPreparationRoom,request,until,advance}from'./helpers/native-preparation-ws.mjs';import{FormalRoomStore}from'../server/formal-coop-service.mjs';
let api,fixture;
before(async()=>{await fs.mkdir('build/vs02b23',{recursive:true});await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();fixture=await originalPreparationFixture();});
after(async()=>fixture?.route.h.close());
for(const kind of ['TM_COMMON','EVOLUTION_ITEM','unpause'])for(const failWrite of [false,true])test(`${kind} original dual-model ACK/disk recovery and replay, injected write failure ${failWrite}`,async()=>{
 const f=growthItemFixture(api,fixture.base,kind==='unpause'?'EVOLUTION_ITEM':kind),c=f.c;
 if(kind==='unpause')member(c,0).pokemon.fields.pauseEvolutions=true;
 const action=kind==='unpause'?{kind:'preparation',operation:'unpause-evolution',pokemonId:f.id}:reward(f.option,f.id);
 const expected=await fixture.route.h.request('native-prepare-action',{checkpoint:structuredClone(c),seat:0,action});
 const directory=await fs.mkdtemp(resolve('build/vs02b23/growth-ws-')),base=new FormalRoomStore(directory);let fail=failWrite;
 const store={load:()=>base.load(),save:room=>{if(fail&&room.revision===1)throw Error('injected result write failure');return base.save(room);}};
 const settings={api,checkpoint:c};let env=await openPreparationRoom({...settings,store});
 try{
 let pair=env.pair,tokens=pair.map(p=>p.identity),roomId=tokens[0].roomId;
 const forbidden=request(pair[1],action);pair[1].send(forbidden);assert.equal((await pair[1].wait(m=>m.type==='actionReceipt'&&m.actionId===forbidden.actionId)).accepted,false);
 const input=request(pair[0],action);pair[0].send(input);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===input.actionId)).accepted,true);
 if(failWrite){await pair[0].wait(m=>m.type==='syncStatus'&&m.reason==='STORAGE_FAILED');assert.deepEqual(env.server.rooms.get(roomId).checkpoint.nativeCheckpoint,c);}
 else await until(()=>pair.every(p=>p.ready&&p.latest.revision===1),'committed original item and model ACKs');
 await env.close();fail=false;env=await openPreparationRoom({...settings,store:new FormalRoomStore(directory),old:tokens});pair=env.pair;
 await until(()=>pair.every(p=>p.ready&&p.latest.revision===1),'durable recovery of accepted item');
 const committed=structuredClone(env.server.rooms.get(roomId).checkpoint);
 assert.deepEqual(committed.nativeCheckpoint,expected.checkpoint);
 assert.equal(pair[1].latest.personal.decision.players.subdecision,null,'the partner does not receive the private choice');
 pair[0].send(input);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===input.actionId)).accepted,true);
 assert.deepEqual(env.server.rooms.get(roomId).checkpoint,committed);
 pair[0].send({...input,action:{...action,pokemonId:member(c,1).pokemon.fields.id}});
 assert.equal((await pair[0].wait(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT')).code,'ACTION_ID_CONFLICT');
 await pair[0].chain;assert.deepEqual(pair[0].errors,['ACTION_ID_CONFLICT']);pair[0].errors.length=0;
 if(kind!=='unpause'){
 const d=pair[0].latest.personal.decision.players.subdecision;
 assert.equal(d.kind,kind==='TM_COMMON'?'learn-move':'evolution');
 const choice=d.kind==='learn-move'?d.options[0].find(o=>o.slot===0):{kind:'evolution',pokemonId:f.id,choice:'evolve'};
 const choiceInput=await advance(pair,0,choice),after=structuredClone(env.server.rooms.get(roomId).checkpoint);
 assert.equal(after.nativeCheckpoint.decision.shared.rewardClaims.length,1);
 await env.close();env=await openPreparationRoom({...settings,store:new FormalRoomStore(directory),old:tokens});pair=env.pair;
 assert.deepEqual(env.server.rooms.get(roomId).checkpoint,after);
 pair[0].send(choiceInput);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===choiceInput.actionId)).accepted,true);
 assert.deepEqual(env.server.rooms.get(roomId).checkpoint,after);
 }
 }finally{await env.close();}
});
