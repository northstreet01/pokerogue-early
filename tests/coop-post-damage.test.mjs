import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {moves} from './helpers/original-model.mjs';
import {postEffectContext,advancePostDamage,runPostDamageReference,nextPostPhase} from './helpers/post-damage-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

const runnable=c=>['DamagePhase','StatChangePhase','MoveEffectPhase'].includes(nextPostPhase(c)?.constructor.name);
function adapterFor(initial){const saved=codec.capture(initial);return {...safeAdapter('ended'),rulesVersion:'native-post-damage-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:[],collection:runnable(c)?'auto':'all'}),
  advanceToDecision:advancePostDamage};}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}

for(const seat of [0,1])test(`real WS restarts at every multi-hit/Damage boundary, owner=${seat}`,async()=>{
  const initial=await postEffectContext(seat,moves.Moves.DOUBLE_SLAP),adapter=adapterFor(initial);
  let f=await formalFixture(adapter),reference=codec.restore(codec.capture(initial));
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0,displays=0;
    while(runnable(reference)){
      assert.ok(revision<16);const kind=nextPostPhase(reference).constructor.name,hp=reference.roster.entries[2].pokemon.hp;
      const expected=await runPostDamageReference(reference);reference=expected.context;
      await confirm(pair,++revision);
      assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
      for(const c of pair){assert.deepEqual(c.snapshot.events,expected.events);
        assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(reference,c.identity.seat));
        if(kind==='DamagePhase')assert.equal(c.model.roster.entries[2].pokemon.hp,hp);}
      if(kind==='DamagePhase')displays++;
      const store=f.store,saved=copy(f.rooms.get(id).checkpoint);
      await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.equal(f.rooms.get(id).revision,revision);assert.deepEqual(f.rooms.get(id).checkpoint,saved);
    }
    assert.ok(displays>=2);assert.equal(reference.roster.entries[seat].pokemon.turnData.hitsLeft,0);
  }finally{await f.close();}
});

test('real WS Growl restores its pending StatChange and applies stage once',async()=>{
  const initial=await postEffectContext(1,moves.Moves.GROWL),adapter=adapterFor(initial);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,store=f.store;
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    const expected=await runPostDamageReference(codec.restore(codec.capture(initial)));await confirm(pair,1);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    for(const c of pair)assert.equal(c.model.roster.entries[2].pokemon.summonData.battleStats[0],-1);
    assert.equal(f.rooms.get(id).revision,1);
  }finally{await f.close();}
});

for(const [label,move,failRevision]of [['Damage',moves.Moves.TACKLE,1],['StatChange',moves.Moves.GROWL,1],['next hit',moves.Moves.DOUBLE_SLAP,2]])
test(`real WS ${label} storage failure retains checkpoint and retries exactly once`,async()=>{
  const initial=await postEffectContext(0,move),adapter=adapterFor(initial),store={data:new Map(),fail:false,
    async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===failRevision)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    if(failRevision===2)await confirm(pair,1);
    const before=copy(f.rooms.get(id).checkpoint),expected=await runPostDamageReference(codec.restore(before));
    store.fail=true;for(const c of pair)c.send(c.acks.shift());
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,failRevision);assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
    for(const c of pair)assert.deepEqual(c.snapshot.events,expected.events);
  }finally{await f.close();}
});

test('real WS lethal Damage commits display then retains Faint decision boundary across restart',async()=>{
  const initial=await postEffectContext(0,moves.Moves.DOUBLE_SLAP,{faint:true}),adapter=adapterFor(initial);let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    await confirm(pair,1);assert.equal(nextPostPhase(pair[0].model).constructor.name,'FaintPhase');
    const saved=copy(f.rooms.get(id).checkpoint),store=f.store;
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved);assert.equal(f.rooms.get(id).revision,1);
    for(const c of pair){assert.equal(nextPostPhase(c.model).constructor.name,'FaintPhase');assert.equal(c.model.roster.entries[2].pokemon.hp,0);}
  }finally{await f.close();}
});
