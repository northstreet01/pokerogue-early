import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {advanceAction,runAction,moveRules} from './helpers/move-execution-model.mjs';
import {moves} from './helpers/original-model.mjs';
import {actionEffectContext,runEffect,advanceEffect} from './helpers/move-effect-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

const adapterFor=seat=>({...safeAdapter('ended'),rulesVersion:'native-action-effect-test',
  createInitialContext:()=>actionEffectContext(seat),
  describeDecision:c=>({id:c.decision.id,requiredSeats:[],collection:c.decision.id.endsWith(':effect')?'all':'auto'}),
  advanceToDecision:c=>c.decision.id==='action-before'?advanceAction(c):advanceEffect(c)});
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}

for(const seat of [0,1])test(`real WS native action then damage restores at the effect boundary, owner=${seat}`,async()=>{
  const adapter=adapterFor(seat);let f=await formalFixture(adapter);
  try{
    let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    const reference=runAction(codec.restore(codec.capture(adapter.createInitialContext())),{reference:true,clone:false});reference.context.decision.id='action-before:move';
    await confirm(pair,1);assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference.context));
    const expected=await runEffect(reference.context,{reference:true,clone:false});expected.context.decision.id='action-before:move:effect';
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.equal(f.rooms.get(id).revision,1);await confirm(pair,2);
    for(const c of pair){assert.deepEqual(c.snapshot.events,expected.events);assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(expected.context,c.identity.seat));
      const p=c.model.roster.entries[seat].pokemon;assert.equal(p.moveset[0].ppUsed,1);
      assert.equal(p.battleSummonData.moveHistory[0].targets,c.model.battle.turnCommands[seat].move.targets);}
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
    assert.ok(pair[0].model.roster.entries[2].pokemon.hp<17);
    const committed=copy(f.rooms.get(id).checkpoint);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.deepEqual(f.rooms.get(id).checkpoint,committed);assert.equal(pair[seat].model.roster.entries[seat].pokemon.moveset[0].ppUsed,1);
    assert.notEqual(pair[0].model.continuation.phaseQueuePrepend[0].phase,pair[1].model.continuation.phaseQueuePrepend[0].phase);
  }finally{await f.close();}
});

test('damage commit failure retains already-spent PP and pre-hit HP/RNG; restart applies one identical hit',async()=>{
  const adapter=adapterFor(0),store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===2)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{
    let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;await confirm(pair,1);
    const before=copy(f.rooms.get(id).checkpoint),expected=await advanceEffect(codec.restore(before));
    store.fail=true;for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);await confirm(pair,2);
    for(const c of pair)assert.deepEqual(c.snapshot.events,expected.events);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{await f.close();}
});

test('real WS rejected attribute pauses at pre-hit checkpoint; restored service applies the repaired effect once',async()=>{
  const adapter=adapterFor(0);let f=await formalFixture(adapter);
  const attrs=moveRules.allMoves[moves.Moves.TACKLE].attrs,attr=new moveRules.MoveEffectAttr(false,moveRules.MoveEffectTrigger.POST_APPLY);
  attr.apply=(_user,target)=>{target.hp-=1;return Promise.reject(Error('attribute failure'));};
  try{
    let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;await confirm(pair,1);
    const before=copy(f.rooms.get(id).checkpoint),expected=await advanceEffect(codec.restore(before));
    attrs.push(attr);for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.equal(f.rooms.get(id).revision,1);assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(f.store.data.get(id).checkpoint,before);
    attrs.splice(attrs.indexOf(attr),1);const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,2);assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{if(attrs.includes(attr))attrs.splice(attrs.indexOf(attr),1);await f.close();}
});
