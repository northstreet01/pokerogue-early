import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {moves} from './helpers/original-model.mjs';
import {mixedContext,advanceMixed,referenceMixed,chooseMixedInputs} from './helpers/mixed-command-model.mjs';
import {validateCycleInput} from './helpers/command-cycle-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

function adapterFor(initial,options={}){const saved=codec.capture(initial);return {...safeAdapter('ended'),rulesVersion:'native-mixed-command-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
  validateAction(c,seat,action){codec.validateAction(c,seat,action);validateCycleInput(c,seat,action);},
  advanceToDecision:(c,inputs)=>advanceMixed(c,inputs,options)};}
async function ready(pair){for(const c of pair)c.send(c.acks.shift());
  await pair[1].wait(m=>m.type==='syncStatus'&&m.revision===pair[1].snapshot.revision&&m.reason==='READY');}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}
const message=(c,action,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,
  expectedRevision:c.snapshot.revision,actionId:id,action});
async function input(pair,reference,revision,override){await ready(pair);const seat=reference.decision.requiredSeats[0],
  action=override||chooseMixedInputs(reference)[seat],sent=message(pair[seat],action,`mixed-${revision}`);
  pair[seat].send(sent);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);
  await receive(pair,revision);return sent;}

for(const [mode,move]of [['queued',moves.Moves.GROWL],['encore',moves.Moves.TACKLE]])
test(`real WS resumes original manual/forced order and target stops, ${mode}`,async()=>{
  const initial=(await advanceMixed(await mixedContext({mode,move}))).context,adapter=adapterFor(initial);
  let reference=codec.restore(codec.capture(initial)),f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0;
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));assert.equal(pair[0].model.continuation.currentPhase.remaining,'wait-actions');
    await ready(pair);pair[1].send(message(pair[1],chooseMixedInputs(reference)[0],'not-current-owner'));
    assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).code,'SEAT_NOT_REQUIRED');
    // ready() consumed the initial ACKs; submit the current seat directly.
    const firstInputs=chooseMixedInputs(reference),expected=await referenceMixed(reference,firstInputs);reference=expected.context;
    pair[0].send(message(pair[0],firstInputs[0],'owner-zero'));
    assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);await receive(pair,++revision);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
    let cancelled=false;
    while(!(reference.battle.turn===initial.battle.turn+1&&reference.decision.kind==='wait-actions')){
      let next;
      if(reference.decision.kind==='continuing'){
        next=await referenceMixed(reference);await confirm(pair,++revision);
      }else{
        assert.equal(reference.decision.kind,'wait-target');
        await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
        assert.equal(pair[1].model.continuation.currentPhase.remaining,'wait-target');
        const action=!cancelled?reference.decision.options[1].find(a=>a.target===-1):chooseMixedInputs(reference)[1];
        cancelled=true;const old=codec.restore(codec.capture(reference));next=await referenceMixed(reference,{1:action});
        await input(pair,old,++revision,action);
      }
      reference=next.context;assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
      for(const c of pair){assert.deepEqual(c.snapshot.events,next.events);
        assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(reference,c.identity.seat));}
    }
    assert.equal(reference.roster.entries[1].pokemon.moveset[0].ppUsed,1);
    assert.deepEqual(reference.decision.requiredSeats,[0]);assert.equal(reference.continuation.currentPhase.remaining,'wait-actions');
  }finally{await f.close();}
});

for(const stage of ['pause','command','target'])test(`real WS ${stage} storage failure restores the exact remaining stage`,async()=>{
  let initial=await mixedContext();
  if(stage!=='pause')initial=(await advanceMixed(initial)).context;
  if(stage==='target')initial=(await advanceMixed(initial,chooseMixedInputs(initial))).context;
  const actions=chooseMixedInputs(initial),before=codec.capture(initial),expected=await referenceMixed(codec.restore(before),actions),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    if(stage==='pause'){store.fail=true;for(const c of pair)c.send(c.acks.shift());}
    else{await ready(pair);store.fail=true;const seat=initial.decision.requiredSeats[0];
      pair[seat].send(message(pair[seat],actions[seat],'retry-input'));assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);}
    assert.equal((await pair[stage==='command'?0:1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    if(stage!=='pause')assert.deepEqual(store.data.get(id).inputs,actions);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{await f.close();}
});

test('real WS rejected resume tasks retain current Command and accepted input',async()=>{
  const initial=(await advanceMixed(await mixedContext())).context,before=codec.capture(initial),actions=chooseMixedInputs(initial),fault={enabled:true};
  const adapter=adapterFor(initial,{onBind:(_c,_p,_b,tasks,{resume}={})=>{
    if(fault.enabled&&resume)tasks.add(Promise.reject(Error('late suspended command failure')));
  }});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    await ready(pair);pair[0].send(message(pair[0],actions[0],'saved-resume'));
    assert.equal((await pair[0].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.equal((await pair[0].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(f.store.data.get(id).inputs,actions);
    const store=f.store;await f.close();fault.enabled=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await referenceMixed(codec.restore(before),actions);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{await f.close();}
});
