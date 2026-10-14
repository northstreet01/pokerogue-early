import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {cleanupContext,advanceCleanup,runCleanupReference} from './helpers/turn-end-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

const adapterFor=seat=>({...safeAdapter('ended'),rulesVersion:'native-cleanup-test',
  createInitialContext:()=>cleanupContext(seat,{disabledTurns:1,fieldEffects:true}),
  describeDecision:c=>({id:c.decision.id,requiredSeats:[],collection:c.decision.id==='cleanup-2'?'all':'auto'}),
  advanceToDecision:advanceCleanup});
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}

for(const seat of [0,1])test(`real WS restart between original MoveEnd and TurnEnd matches reference, owner=${seat}`,async()=>{
  const adapter=adapterFor(seat);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    const first=await runCleanupReference(adapter.createInitialContext());await confirm(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(first.context));
    const expected=await runCleanupReference(first.context),store=f.store;
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.equal(f.rooms.get(id).revision,1);await confirm(pair,2);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
    for(const c of pair){assert.deepEqual(c.snapshot.events,expected.events);
      assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(expected.context,c.identity.seat));
      assert.equal(c.model.battle.turn,2);assert.equal(c.model.continuation.phaseQueue[0].phase.constructor.name,'MessagePhase');}
    const saved=copy(f.rooms.get(id).checkpoint);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved);assert.equal(pair[0].model.battle.turn,2);
  }finally{await f.close();}
});

test('TurnEnd storage failure retains commands/RNG/disabled state; restart increments turn once',async()=>{
  const adapter=adapterFor(0),store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===2)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;await confirm(pair,1);
    const before=copy(f.rooms.get(id).checkpoint),expected=await runCleanupReference(codec.restore(before));
    store.fail=true;for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);await confirm(pair,2);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{await f.close();}
});
