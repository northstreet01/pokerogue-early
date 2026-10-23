import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {FormalRoomStore} from '../server/formal-coop-service.mjs';
import {defaultTrainerRoute,progressDefault} from './helpers/native-default-trainer.mjs';
import {openPreparationRoom,until,request,raw,advance} from './helpers/native-preparation-ws.mjs';

let api,checkpoint;
before(async()=>{
  await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
  const route=await defaultTrainerRoute();
  try{let c=route.initial;for(let n=0;n<70&&c.decision.kind!=='preparation';n++)c=(await progressDefault(route.h,c)).checkpoint;
    assert.equal(c.decision.kind,'preparation');checkpoint=c;
    for(const seat of [0,1])checkpoint.decision.players[seat].rewards[0].type=api.captureModifierTypeState(api.modifierTypes.LUCKY_EGG().withIdFromFunc(api.modifierTypes.LUCKY_EGG));
  }finally{await route.h.close();}
});
const action=client=>({kind:'preparation',operation:'reward',optionId:client.latest.personal.decision.players.rewards[0].id,
  pokemonId:client.latest.personal.party[0].id,moveIndex:null,fusionId:null});
const privateState=p=>JSON.stringify({...p,decision:{...p.decision,id:null}});

for(const seat of [0,1])test(`formal native held reward seat ${seat}: result disk rollback, accepted-only restart, dedupe/conflict and later FIGHT`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vs18-persistent-'));
  class FailingStore extends FormalRoomStore{
    fail=false;
    async save(room){if(this.fail&&room.checkpoint.nativeCheckpoint.players[seat].modifiers.length){this.fail=false;throw Error('TEST_PERSISTENT_RESULT_DISK_FAILED');}return super.save(room);}
  }
  const store=new FailingStore(directory);let env=await openPreparationRoom({api,checkpoint,store});
  try{
    let pair=env.pair;const before=pair[seat].latest,peer=privateState(pair[1-seat].latest.personal);
    store.fail=true;const message=await raw(pair[seat],action(pair[seat]));
    await until(()=>pair.some(c=>c.errors.includes('STORAGE_FAILED')),'persistent result disk failure');
    assert.deepEqual(pair[seat].latest.personal.resources.modifiers,[]);
    const [saved]=await store.load();assert.equal(saved.inputs[seat].operation,'reward');assert.deepEqual(saved.checkpoint.nativeCheckpoint.players[seat].modifiers,[]);
    const tokens=pair.map(c=>c.identity);await env.close();env=await openPreparationRoom({api,checkpoint,store:new FormalRoomStore(directory),old:tokens});pair=env.pair;
    await until(()=>pair.every(c=>c.latest.revision>before.revision&&c.ready),'recovered original reward');
    assert.equal(pair[seat].latest.personal.resources.modifiers.length,1);
    assert.equal(privateState(pair[1-seat].latest.personal),peer);
    assert.equal(pair[seat].model.applied.personal.resources.modifiers[0].stackCount,1);
    const revision=pair[seat].latest.revision;
    pair[seat].send(message);const replay=await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId);
    assert.equal(replay.accepted,true);assert.equal(pair[seat].latest.revision,revision);
    pair[seat].send({...message,action:{kind:'preparation',operation:'skip-reward'}});
    const conflict=await pair[seat].wait(m=>m.type==='error'&&m.code==='ACTION_ID_CONFLICT');
    assert.equal(conflict.code,'ACTION_ID_CONFLICT');await pair[seat].chain;
    assert.deepEqual(pair[seat].errors.splice(0),['ACTION_ID_CONFLICT']);
    for(const owner of [0,1]){
      if(!pair[owner].latest.personal.decision.players.rewardResolved)await advance(pair,owner,{kind:'preparation',operation:'skip-reward'});
      await advance(pair,owner,{kind:'preparation',operation:'ready'});
    }
    for(let n=0;n<20&&pair[0].latest.personal.decision.kind!=='wait-actions';n++){
      const owner=pair.findIndex(c=>c.latest.personal.decision.requiredSeats.includes(c.latest.seat));
      await advance(pair,owner,pair[owner].latest.personal.decision.options.find(o=>o.accept===false||o.pokemonId===null));
    }
    const turn=pair[0].latest.revision;
    for(const client of pair){const s=client.latest,moves=s.personal.party[0].pokemon.fields.moveset;
      const options=s.personal.decision.options.filter(o=>o.kind==='fight'&&(o.target===null||o.target>=2));
      await raw(client,options.find(o=>[52,55,22,670].includes(moves[o.cursor]?.fields.moveId))??options[0]);}
    await until(()=>pair.every(c=>c.latest.revision>turn&&c.ready)||pair.some(c=>c.errors.length),'later fight with real held modifier');
    assert.deepEqual(pair.flatMap(c=>c.errors),[],env.failures.join(', '));
  }finally{await env.close();await rm(directory,{recursive:true,force:true});}
});

test('formal native persistent reward requires both model ACKs and isolates two active rooms',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vs18-rooms-')),env=await openPreparationRoom({api,checkpoint,store:new FormalRoomStore(directory)});
  try{
    const first=env.pair,second=await env.connectPair(null,1),firstRoom=env.server.rooms.get(first[0].identity.roomId);
    const before=structuredClone(firstRoom.checkpoint),message=request(second[0],action(second[0]));second[0].send(message);
    const rejected=await second[0].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId);assert.equal(rejected.accepted,false);assert.equal(rejected.code,'SYNC_BLOCKED');
    second[1].holdAck=false;for(const ack of second[1].acks.splice(0))second[1].send(ack);
    await until(()=>second.every(c=>c.ready),'both true model ACKs');await advance(second,1,action(second[1]));
    assert.deepEqual(env.server.rooms.get(first[0].identity.roomId).checkpoint,before);
    assert.deepEqual(first[0].latest.personal.resources.modifiers,[]);assert.deepEqual(second[0].latest.personal.resources.modifiers,[]);
    assert.equal(second[1].latest.personal.resources.modifiers.length,1);
  }finally{await env.close();await rm(directory,{recursive:true,force:true});}
});
