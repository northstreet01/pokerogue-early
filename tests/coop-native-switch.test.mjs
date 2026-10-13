import test from 'node:test';
import assert from 'node:assert/strict';
import {codec,modifierCodec} from './helpers/decision-model.mjs';
import {nativeSwitchContext,nativeSwitchStep} from './helpers/native-switch-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {createSnapshotConsumer} from '../src/battle-core/coop-client.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

async function connect(f,adapter,identities){
  const pair=[];
  for(const seat of [0,1]){
    const c=await f.client();pair.push(c);
    c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}
      :seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',name:'B',roomId:pair[0].identity.roomId});
    c.identity=await c.wait(m=>m.type==='welcome');c.acks=[];
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.acks.push(m),adapter:{
      applySnapshot(s){const saved=copy(s.shared),r=s.personal.resources;
        saved.players[seat]={money:r.money,pokeballCounts:copy(r.pokeballCounts),modifiers:r.modifiers.map(state=>{const id=saved.components.length;saved.components.push({kind:'modifier',state});return id;})};
        c.model=codec.restore(saved);
      },captureAppliedState:()=>adapter.projectSnapshot(c.model,seat),async applyGrantsTransaction(g){assert.deepEqual(g,[]);}
    }});
  }
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot');await c.consume(c.snapshot);}
  return pair;
}
for(const baton of [false,true])for(const seat of [0,1])test(`real WS native switch resumes every boundary after restart, baton=${baton}, owner=${seat}`,async()=>{
  const adapter={...safeAdapter('ended'),rulesVersion:'native-switch-stages-test',
    createInitialContext:()=>nativeSwitchContext(baton,seat),
    describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
    advanceToDecision:c=>nativeSwitchStep(c,seat)};
  let f=await formalFixture(adapter),reference=codec.restore(codec.capture(adapter.createInitialContext()));
  try{
    let pair=await connect(f,adapter),identities=pair.map(c=>c.identity);let revision=0;
    while(reference.decision.kind==='continuing'){
      const checkpoint=copy(f.rooms.get(identities[0].roomId).checkpoint);
      assert.deepEqual(checkpoint,codec.capture(reference));
      // No ACK survives restart; native queued work waits for BOTH restored models.
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.equal(f.rooms.get(identities[0].roomId).revision,revision);
      assert.notEqual(pair[0].model.continuation.currentPhase.phase,pair[1].model.continuation.currentPhase.phase);
      const expected=await nativeSwitchStep(reference,seat,false);reference=expected.context;
      pair[0].send(pair[0].acks.shift());await pair[0].wait(m=>m.type==='syncStatus'&&m.blocked);
      assert.equal(f.rooms.get(identities[0].roomId).revision,revision);
      pair[1].send(pair[1].acks.shift());revision++;
      for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);
        assert.deepEqual(c.snapshot.events,expected.events);
        assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(reference,c.identity.seat));}
      assert.deepEqual(f.rooms.get(identities[0].roomId).checkpoint,codec.capture(reference));
    }
  }finally{await f.close();}
});

test('automatic native stage waits for ACKs and failed durable commit keeps the prior queue for one replay',async()=>{
  const adapter={...safeAdapter('ended'),rulesVersion:'native-stage-fault-test',createInitialContext:()=>nativeSwitchContext(true,1),
    describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
    advanceToDecision:c=>nativeSwitchStep(c,1)};
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{
    let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    const before=copy(f.rooms.get(id).checkpoint),expected=await nativeSwitchStep(codec.restore(before),1,false);
    store.fail=true;for(const c of pair)c.send(c.acks.shift());
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.equal(f.rooms.get(id).revision,0);assert.deepEqual(f.rooms.get(id).checkpoint,before);
    assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.equal(f.rooms.get(id).revision,0);for(const c of pair)c.send(c.acks.shift());
    for(const c of pair){const snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===1);await c.consume(snapshot);assert.deepEqual(snapshot.events,expected.events);}
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{await f.close();}
});

test('corrupted applied native Phase cannot acknowledge or advance the automatic switch boundary',async()=>{
  const adapter={...safeAdapter('ended'),rulesVersion:'native-stage-model-fault-test',createInitialContext:()=>nativeSwitchContext(true,0),
    describeDecision:c=>({id:c.decision.id,requiredSeats:[],collection:'auto'}),advanceToDecision:c=>nativeSwitchStep(c,0)};
  const f=await formalFixture(adapter);
  try{
    const pair=await connect(f,adapter),c=pair[1],before=copy(f.rooms.get(c.identity.roomId).checkpoint);
    const faulty=createSnapshotConsumer({versions:f.versions,isCurrent:()=>true,send:m=>c.send(m),adapter:{
      applySnapshot(){c.model.continuation.currentPhase.phase.batonPass=false;},
      captureAppliedState:()=>adapter.projectSnapshot(c.model,1),async applyGrantsTransaction(){}
    }});
    await assert.rejects(faulty(c.snapshot),/MODEL_MISMATCH/);pair[0].send(pair[0].acks.shift());
    await pair[0].wait(m=>m.type==='syncStatus'&&m.blocked);
    assert.equal(f.rooms.get(c.identity.roomId).revision,0);assert.deepEqual(f.rooms.get(c.identity.roomId).checkpoint,before);
  }finally{await f.close();}
});
