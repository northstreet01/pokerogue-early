import test from 'node:test';
import assert from 'node:assert/strict';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {levelUpContext,advanceLevelUp,referenceProgression,chooseProgression,atExperienceEnd} from './helpers/level-up-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

const checkpoint=c=>copy(codec.capture(c));
function adapterFor(initial,options={}){const saved=checkpoint(initial);return {...safeAdapter('ended'),rulesVersion:'native-original-level-up-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:safeCodec.collection(c.decision)}),
  advanceToDecision:(c,inputs)=>advanceLevelUp(c,inputs,options)};}
async function ready(pair){for(const c of pair)c.send(c.acks.shift());await pair[1].wait(m=>m.type==='syncStatus'&&m.reason==='READY'&&m.revision===pair[1].snapshot.revision);}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}
const message=(c,action,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,
  expectedRevision:c.snapshot.revision,actionId:id,action});

for(const options of [{seat:0,full:true},{seat:1,level:16,lastLevel:5,full:true},
  {seat:1,level:16,lastLevel:15,evolve:'cancel',pauseChoice:'pause'}])
test(`real WS original LevelUp and owned choices survive every restart ${JSON.stringify(options)}`,async()=>{
  const initial=await levelUpContext(options),adapter=adapterFor(initial);let reference=codec.restore(checkpoint(initial)),f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0,previous;
    const store=f.store;
    while(!atExperienceEnd(reference)){
      assert.ok(revision<60);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      const kind=reference.decision.kind,seat=reference.decision.requiredSeats[0];
      const inputs=chooseProgression(reference,{evolve:options.evolve,pause:options.pauseChoice});
      const expected=await referenceProgression(reference,inputs);
      if(kind==='continuing')await confirm(pair,++revision);
      else{
        await ready(pair);
        pair[1-seat].send(message(pair[1-seat],inputs[seat],`wrong-owner-${revision}`));
        assert.equal((await pair[1-seat].wait(m=>m.type==='actionReceipt')).code,'SEAT_NOT_REQUIRED');
        if(previous){pair[seat].send({...previous,actionId:`old-progression-${revision}`});
          assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).code,'STALE_DECISION');}
        const sent=message(pair[seat],inputs[seat],`progression-${revision}`);pair[seat].send(sent);
        assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);
        await receive(pair,++revision);previous=sent;
      }
      reference=expected.context;assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      for(const c of pair){assert.deepEqual(c.snapshot.events,copy(expected.events));
        assert.deepEqual(copy(adapter.projectSnapshot(c.model,c.identity.seat)),copy(adapter.projectSnapshot(reference,c.identity.seat)));}
    }
    const before=checkpoint(reference);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'UNSUPPORTED_RULE_PHASE');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
  }finally{await f.close();}
});

const stageOf=c=>c.continuation.currentPhase?.remaining??nextPostPhase(c)?.constructor.name;
async function stageContext(stage){let c=await levelUpContext(stage.startsWith('evolution')||stage==='EndEvolutionPhase'
  ?{level:16,lastLevel:15}:{full:true});let steps=0;
  while(stageOf(c)!==stage){assert.ok(++steps<20);c=(await advanceLevelUp(c,chooseProgression(c,{evolve:stage==='evolution-pause'?'cancel':'evolve'}))).context;}
  return c;}
for(const stage of ['LevelUpPhase','learn-apply','evolution-apply','evolution-pause','EndEvolutionPhase'])
test(`real WS ${stage} write failure keeps exact stats/moves/species and resumes once`,async()=>{
  const initial=await stageContext(stage),before=checkpoint(initial),inputs=chooseProgression(initial),expected=await referenceProgression(codec.restore(before),inputs),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    if(initial.decision.kind==='continuing'){store.fail=true;for(const c of pair)c.send(c.acks.shift());}
    else{await ready(pair);store.fail=true;const seat=initial.decision.requiredSeats[0];pair[seat].send(message(pair[seat],inputs[seat],'durable-progression'));
      assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);}
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    if(initial.decision.kind!=='continuing')assert.deepEqual(store.data.get(id).inputs,inputs);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));assert.deepEqual(pair[0].snapshot.events,copy(expected.events));
  }finally{await f.close();}
});

test('real WS failed original evolution task keeps species and durable intent for retry',async()=>{
  const initial=await stageContext('evolution-apply'),before=checkpoint(initial),fault={enabled:true};
  const adapter=adapterFor(initial,{onProgressionBind:(_c,_p,_b,tasks)=>{if(fault.enabled)tasks.add(Promise.reject(Error('evolution rule task')));}});
  let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,inputs=chooseProgression(initial);
    await ready(pair);pair[1].send(message(pair[1],inputs[1],'retry-evolution'));
    assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(f.store.data.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.enabled=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await referenceProgression(codec.restore(before),inputs);
    assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
  }finally{await f.close();}
});
