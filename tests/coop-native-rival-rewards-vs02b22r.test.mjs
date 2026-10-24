import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {createOriginalRuleHost} from '../server/original-rule-host.mjs';
import {FormalRoomStore} from '../server/formal-coop-service.mjs';
import {trainerReserveFixture} from './helpers/native-trainer-reserve.mjs';
import {progressDefault} from './helpers/native-default-trainer.mjs';
import {openPreparationRoom,request,until} from './helpers/native-preparation-ws.mjs';

let api,route;
const front=c=>(c.continuation.phaseQueuePrepend.at(-1)??c.continuation.phaseQueue[0])?.phase.type;
const inventory=(c,seat)=>c.players[seat].modifiers.map(id=>c.components[id].state);
const count=(c,seat,id)=>inventory(c,seat).filter(m=>m.fields.type.value.catalogId===id)
  .reduce((sum,m)=>sum+m.fields.stackCount.value,0);
async function victory(trainerType=375,variant=0){
  // Explicit synthetic low-HP Trainer fixture using the original constructor,
  // party generator and attacks; no live user checkpoint is committed here.
  const r=await trainerReserveFixture({trainerType,variant,frontHp:1});
  let c=r.c,beforeVictory;
  try{
    for(let n=0;n<100;n++){
      if(c.decision.kind==='wait-actions')beforeVictory=structuredClone(c);
      const result=await progressDefault(r.h,c);c=result.checkpoint;
      if(front(c)==='SelectModifierPhase')return {...r,c,beforeVictory};
    }
    assert.fail('original rival victory must reach its ordinary reward menu');
  }finally{await r.h.close();}
}
before(async()=>{
  await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
  route=await victory();
});

function assertRewards(c,before,ids=['EXP_SHARE','SUPER_EXP_CHARM']){
  for(const seat of [0,1])for(const id of ids)assert.equal(count(c,seat,id),count(before,seat,id)+1);
}

test('original rival fixed rewards complete for each owner and remain exact across every phase restart',async()=>{
  assertRewards(route.c,route.beforeVictory);
  let h=await createOriginalRuleHost(route.config),c=route.beforeVictory,events=[],sawFirstOnly=false;
  try{
    c=(await progressDefault(h,c)).checkpoint;
    for(let n=0;n<160&&front(c)!=='SelectModifierPhase';n++){
      await h.close();h=await createOriginalRuleHost(route.config);
      const result=await h.request('native-step',JSON.parse(JSON.stringify(c)));c=result.checkpoint;events.push(...result.events);
      if(count(c,0,'SUPER_EXP_CHARM')===1&&count(c,1,'SUPER_EXP_CHARM')===0){
        sawFirstOnly=true;
        assert.ok([...c.continuation.phaseQueue,...c.continuation.phaseQueuePrepend]
          .some(d=>d.phase.type==='ModifierRewardPhase'&&d.phase.scope===1));
      }
    }
    assert.equal(front(c),'SelectModifierPhase');assert.ok(sawFirstOnly);
    assertRewards(c,route.beforeVictory);
    const semantic=value=>{const copy=structuredClone(value);for(const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'])for(const d of copy.continuation[key])delete d.phaseId;return copy;};
    assert.deepEqual(semantic(c),semantic(route.c));
    assert.equal(events.filter(e=>e.kind==='phase-start'&&e.phase==='TrainerVictoryPhase').length,1);
    assert.equal(events.filter(e=>e.kind==='phase-start'&&e.phase==='ModifierRewardPhase').length,4);
    for(const seat of [0,1])assert.equal(events.filter(e=>e.kind==='message'&&e.scope===seat&&e.presentation?.key==='battle:rewardGain').length,2);
    const shared=(await h.request('native-preparation-shared',c)).checkpoint;
    assert.equal(shared.decision.shared.version,1);assert.deepEqual(shared.decision.shared.rewardClaims,[]);
    assertRewards(shared,route.beforeVictory);
  }finally{await h.close();}
});

for(const [trainerType,variant,ids] of [[375,1,['EXP_SHARE','SUPER_EXP_CHARM']],[376,0,['EXP_SHARE']]])
test(`original rival config ${trainerType} variant ${variant} grants only its configured fixed rewards`,async()=>{
  const r=await victory(trainerType,variant);assertRewards(r.c,r.beforeVictory,ids);
  if(trainerType===376)for(const seat of [0,1])assert.equal(count(r.c,seat,'SUPER_EXP_CHARM'),count(r.beforeVictory,seat,'SUPER_EXP_CHARM'));
});

test('unowned and unconfigured original fixed rewards cannot grant arbitrary items',async()=>{
  const h=await createOriginalRuleHost(route.config);
  try{
    const c=structuredClone(route.beforeVictory);
    c.decision={id:'native-5-999',kind:'continuing',requiredSeats:[],reason:'effects'};
    const type=api.captureModifierTypeState(api.modifierTypes.EXP_SHARE().withIdFromFunc(api.modifierTypes.EXP_SHARE));
    c.continuation={currentPhase:null,standbyPhase:null,phaseQueue:[],phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1};
    const descriptor={kind:'original-phase',phaseId:999,remaining:'start',phase:{version:1,type:'ModifierRewardPhase',scope:null,presentation:{},fields:{modifierType:{presence:'value',value:{state:type}}}}};
    c.continuation.phaseQueue=[descriptor];const before=structuredClone(c);
    await assert.rejects(h.request('native-run-to-boundary',c),/INVALID_TRAINER_REWARD_SCOPE/);assert.deepEqual(c,before);
    descriptor.phase.scope=0;
    descriptor.phase.fields.modifierType.value={state:api.captureModifierTypeState(api.modifierTypes.EXP_CHARM().withIdFromFunc(api.modifierTypes.EXP_CHARM))};
    const forged=structuredClone(c);
    await assert.rejects(h.request('native-run-to-boundary',c),/UNSUPPORTED_NATIVE_TRAINER_REWARD/);assert.deepEqual(c,forged);
  }finally{await h.close();}
});

test('real WS rival victory disk failure retains both actions and grants fixed items once after restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'rival-reward-'));
  class FailingStore extends FormalRoomStore{
    fail=true;
    async save(room){const c=room.checkpoint.nativeCheckpoint;if(this.fail&&c&&count(c,0,'EXP_SHARE')>count(route.beforeVictory,0,'EXP_SHARE')){this.fail=false;throw Error('TEST_RIVAL_RESULT_SAVE_FAILED');}return super.save(room);}
  }
  const store=new FailingStore(directory);let env=await openPreparationRoom({api,checkpoint:route.beforeVictory,store,stage:'battle'});
  try{
    let pair=env.pair;const original=structuredClone(env.server.rooms.get(pair[0].identity.roomId).checkpoint);
    const actions=pair.map((client,seat)=>request(client,client.latest.personal.decision.options.find(o=>o.kind==='fight'&&(o.target===null||o.target>=2))));
    // Submit legal original attacks, without changing HP at the service seam.
    for(const [seat,client] of pair.entries())actions[seat].action=route.beforeVictory.decision.options[seat]
      .find(o=>o.kind==='fight'&&(o.target===null||o.target>=2)&&o.cursor===2)
      ??actions[seat].action;
    actions.forEach((action,seat)=>pair[seat].send(action));
    await until(()=>pair.some(c=>c.errors.includes('STORAGE_FAILED')),'rival result save failure');
    const [saved]=await store.load();assert.deepEqual(saved.checkpoint,original);assert.equal(Object.keys(saved.inputs).length,2);
    const tokens=pair.map(c=>c.identity);await env.close();env=await openPreparationRoom({api,checkpoint:route.beforeVictory,store:new FormalRoomStore(directory),old:tokens,stage:'battle'});pair=env.pair;
    await until(()=>pair.every(c=>c.ready)&&pair[0].latest.personal.decision.kind==='preparation','recovered rival victory');
    const committed=structuredClone(env.server.rooms.get(pair[0].identity.roomId).checkpoint);assertRewards(committed.nativeCheckpoint,route.beforeVictory);
    for(const client of pair)for(const e of client.latest.events.filter(e=>e.kind==='message'&&e.presentation?.key==='battle:rewardGain'))assert.equal(e.scope,client.latest.seat);
    for(const [seat,action] of actions.entries()){pair[seat].send(action);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===action.actionId)).accepted,true);}
    assert.deepEqual(env.server.rooms.get(pair[0].identity.roomId).checkpoint,committed);
  }finally{await env.close();await rm(directory,{recursive:true,force:true});}
});
