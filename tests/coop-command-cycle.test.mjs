import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {cycleContext,advanceCycle,runCycleReference,chooseCycleInputs} from './helpers/command-cycle-model.mjs';
import {resolveRoundFight} from './helpers/round-loop-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

function adapterFor(initial,options={}){const saved=codec.capture(initial);return {...safeAdapter('ended'),rulesVersion:'native-command-cycle-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
  validateAction(c,seat,action){codec.validateAction(c,seat,action);resolveRoundFight(c,seat,action);},
  advanceToDecision:(c,inputs)=>advanceCycle(c,inputs,options)};}
async function ready(pair){for(const c of pair)c.send(c.acks.shift());
  await pair[1].wait(m=>m.type==='syncStatus'&&m.revision===pair[1].snapshot.revision&&m.reason==='READY');}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}
const message=(c,action,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,
  expectedRevision:c.snapshot.revision,actionId:id,action});
async function send(c,sent){c.send(sent);const receipt=await c.wait(m=>m.type==='actionReceipt'&&m.actionId===sent.actionId);assert.equal(receipt.accepted,true);}

for(const first of [0,1])test(`real WS two consecutive input rounds use original commands and enemy RNG, first=${first}`,async()=>{
  const initial=await cycleContext({seed:'ws-cycle'}),adapter=adapterFor(initial);let reference=codec.restore(codec.capture(initial));
  let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0;
    for(let round=0;round<2;round++){
      await ready(pair);const inputs=chooseCycleInputs(reference),before=copy(f.rooms.get(id).checkpoint);
      const sent=[0,1].map(seat=>message(pair[seat],inputs[seat],`round-${round}-seat-${seat}`));
      await send(pair[first],sent[first]);assert.deepEqual(f.rooms.get(id).checkpoint,before);
      // The first seat's input is durable while both original Command phases remain unstarted.
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);await ready(pair);
      assert.deepEqual(f.rooms.get(id).inputs,{[first]:inputs[first]});
      await send(pair[first],sent[first]); // Original receipt, no additional command execution.
      await send(pair[1-first],sent[1-first]);await receive(pair,++revision);
      let expected=await runCycleReference(reference,inputs);reference=expected.context;
      assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
      // Restart after commands commit and before native enemy choice. The next RNG draw must occur once.
      await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      while(reference.decision.kind==='continuing'){
        expected=await runCycleReference(reference);reference=expected.context;
        await confirm(pair,++revision);assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
        for(const c of pair){assert.deepEqual(c.snapshot.events,expected.events);
          assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(reference,c.identity.seat));}
      }
      assert.equal(reference.battle.turn,initial.battle.turn+round+1);
    }
  }finally{await f.close();}
});

for(const failRevision of [1,2])test(`real WS command/AI storage failure at revision ${failRevision} preserves inputs and RNG`,async()=>{
  const initial=await cycleContext(),adapter=adapterFor(initial),inputs=chooseCycleInputs(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===failRevision)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    await ready(pair);store.fail=failRevision===1;
    await send(pair[0],message(pair[0],inputs[0],'one'));await send(pair[1],message(pair[1],inputs[1],'two'));
    if(failRevision===2){await receive(pair,1);store.fail=true;for(const c of pair)c.send(c.acks.shift());}
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    let expected=await runCycleReference(codec.restore(codec.capture(initial)),inputs);
    const before=failRevision===1?codec.capture(initial):codec.capture(expected.context);
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    if(failRevision===1)assert.deepEqual(store.data.get(id).inputs,inputs);
    else expected=await runCycleReference(expected.context);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,failRevision);assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{await f.close();}
});

test('real WS failure in second original player command keeps both accepted inputs for recovery',async()=>{
  const initial=await cycleContext(),options={fail:true},adapter=adapterFor(initial,{onBind:(candidate,p)=>{
    if(options.fail&&p.constructor.name==='CommandPhase'&&p.fieldIndex===1){candidate.roster.entries[0].pokemon.hp--;throw Error('command provider failed');}
  }}),inputs=chooseCycleInputs(initial);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    await ready(pair);await send(pair[0],message(pair[0],inputs[0],'first'));await send(pair[1],message(pair[1],inputs[1],'second'));
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(initial));assert.deepEqual(f.store.data.get(id).inputs,inputs);
    const store=f.store;await f.close();options.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await runCycleReference(codec.restore(codec.capture(initial)),inputs);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{await f.close();}
});
