import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {enemyFaintContext,advanceEnemyFaint,referenceEnemyFaint,atVictoryBoundary} from './helpers/enemy-faint-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

const checkpoint=c=>copy(codec.capture(c));
function adapterFor(initial,options={}){const saved=checkpoint(initial);return {...safeAdapter('ended'),rulesVersion:'native-enemy-faint-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:'auto'}),
  advanceToDecision:c=>advanceEnemyFaint(c,options)};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}

for(const options of [{slot:2,held:true},{slot:3,held:true},{lethalRound:true,held:true}])
test(`real WS enemy faint resumes to unstarted Victory, slot=${options.slot??2}, lethal=${!!options.lethalRound}`,async()=>{
  const initial=enemyFaintContext(options),adapter=adapterFor(initial);let reference=codec.restore(checkpoint(initial)),f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0;
    const store=f.store;
    while(!atVictoryBoundary(reference)){
      assert.ok(revision<20);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      const expected=await referenceEnemyFaint(reference);reference=expected.context;await confirm(pair,++revision);
      assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      for(const c of pair){assert.deepEqual(c.snapshot.events,expected.events);
        assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(reference,c.identity.seat));
        if(c.model.battle.postBattleLoot.length)assert.equal(c.model.battle.postBattleLoot[0],c.model.enemyModifiers[0]);}
    }
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    const before=checkpoint(reference);assert.deepEqual(f.rooms.get(id).checkpoint,before);
    for(const c of pair)c.send(c.acks.shift());
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'UNSUPPORTED_RULE_PHASE');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    assert.equal(reference.battle.postBattleLoot.length,1);assert.equal(reference.battle.battleScore,40);
    assert.equal(reference.enemyModifiers[0].pokemonId,null);assert.deepEqual(reference.players,initial.players);
  }finally{await f.close();}
});

test('real WS enemy score/loot write failure preserves original holder, then commits once after restart',async()=>{
  const initial=enemyFaintContext({held:true}),before=checkpoint(initial),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    store.fail=true;for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await referenceEnemyFaint(codec.restore(before));
    assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
    assert.equal(pair[0].model.battle.battleScore,40);assert.equal(pair[1].model.battle.postBattleLoot.length,1);
  }finally{await f.close();}
});

test('real WS failed enemy faint tasks retain exact score, loot and RNG before retry',async()=>{
  const initial=enemyFaintContext({held:true}),before=checkpoint(initial),fault={enabled:true};
  const adapter=adapterFor(initial,{onEnemyBind:(_c,_p,_b,tasks,callbacks)=>{
    if(fault.enabled)callbacks.push(()=>tasks.add(Promise.reject(Error('enemy faint callback failed'))));
  }});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(f.store.data.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.enabled=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await referenceEnemyFaint(codec.restore(before));
    assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));assert.deepEqual(pair[0].snapshot.events,expected.events);
  }finally{await f.close();}
});

test('enemy loot and score remain isolated across two real WS rooms',async()=>{
  const initial=enemyFaintContext({held:true}),before=checkpoint(initial),adapter=adapterFor(initial),f=await formalFixture(adapter);
  try{const first=await connect(f,adapter),second=await connect(f,adapter),firstId=first[0].identity.roomId,secondId=second[0].identity.roomId;
    await confirm(first,1);assert.equal(first[0].model.battle.battleScore,40);
    assert.deepEqual(f.rooms.get(secondId).checkpoint,before);assert.equal(second[1].model.enemyModifiers[0].pokemonId,102);
    await confirm(second,1);assert.deepEqual(f.rooms.get(firstId).checkpoint,f.rooms.get(secondId).checkpoint);
    assert.notEqual(first[0].model.battle.postBattleLoot[0],second[0].model.battle.postBattleLoot[0]);
  }finally{await f.close();}
});
