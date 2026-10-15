import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {faintContext,advanceFaint,referenceFaint} from './helpers/faint-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

function adapterFor(initial,options={}){const saved=codec.capture(initial);return {...safeAdapter('ended'),rulesVersion:'native-player-faint-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
  validateAction:(c,seat,action)=>codec.validateAction(c,seat,action),
  advanceToDecision:(c,inputs)=>advanceFaint(c,inputs,options)};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}

for(const [seat,reserves]of [[0,1],[1,2],[0,0],[1,0]])test(`real WS player ${seat} faint recovers every phase to ${reserves?'switch':'partner input'}`,async()=>{
  const initial=faintContext({seat,reserves}),adapter=adapterFor(initial);let reference=codec.restore(codec.capture(initial)),f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0;
    const store=f.store;
    while(reference.decision.kind==='continuing'){
      assert.ok(revision<20);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
      const expected=await referenceFaint(reference);reference=expected.context;await confirm(pair,++revision);
      assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
      for(const client of pair){assert.deepEqual(client.snapshot.events,expected.events);
        assert.deepEqual(adapter.projectSnapshot(client.model,client.identity.seat),adapter.projectSnapshot(reference,client.identity.seat));}
    }
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
    assert.deepEqual(reference.decision.requiredSeats,[reserves?seat:1-seat]);
    assert.equal(pair[seat].model.continuation.currentPhase.remaining,reserves?'wait-switch':'wait-actions');
    assert.equal(pair[1-seat].model.roster.field[1-seat],101-seat);
  }finally{await f.close();}
});

for(const stage of ['faint','switch'])test(`real WS ${stage} write failure leaves old checkpoint and retries once after restart`,async()=>{
  let initial=faintContext({seat:1});if(stage==='switch')while(nextPostPhase(initial).constructor!==originalPhases.SwitchPhase)initial=(await advanceFaint(initial)).context;
  const before=codec.capture(initial),adapter=adapterFor(initial),expected=await referenceFaint(codec.restore(before));
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    store.fail=true;for(const c of pair)c.send(c.acks.shift());
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
    assert.equal(pair[1].model.roster.entries[1].pokemon.friendship,expected.context.roster.entries[1].pokemon.friendship);
  }finally{await f.close();}
});

test('real WS failed faint task retains model, RNG and events until retry',async()=>{
  const initial=faintContext(),before=codec.capture(initial),fault={enabled:true};
  const adapter=adapterFor(initial,{onFaintBind:(_c,_p,_b,tasks,callbacks)=>{
    if(fault.enabled)callbacks.push(()=>tasks.add(Promise.reject(Error('faint callback failure'))));
  }});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(f.store.data.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.enabled=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await referenceFaint(codec.restore(before));
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));assert.deepEqual(pair[0].snapshot.events,expected.events);
  }finally{await f.close();}
});
