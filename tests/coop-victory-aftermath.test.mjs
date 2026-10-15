import test from 'node:test';
import assert from 'node:assert/strict';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {aftermathContext,advanceAftermath,referenceAfterBattle,atEggBoundary,atBattleEnd} from './helpers/victory-aftermath-model.mjs';
import {enemyFaintContext} from './helpers/enemy-faint-model.mjs';
import {levelUpContext,chooseProgression} from './helpers/level-up-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

const checkpoint=c=>copy(codec.capture(c));
function adapterFor(initial,options={}){const saved=checkpoint(initial);return {...safeAdapter('ended'),rulesVersion:'native-victory-aftermath-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:safeCodec.collection(c.decision)}),
  advanceToDecision:(c,inputs)=>advanceAftermath(c,inputs,options)};}
async function ready(pair){for(const c of pair)c.send(c.acks.shift());await pair[1].wait(m=>m.type==='syncStatus'&&m.reason==='READY'&&m.revision===pair[1].snapshot.revision);}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}
const message=(c,action,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,
  expectedRevision:c.snapshot.revision,actionId:id,action});

for(const options of [{},{emptySeat:0,temporary:true,held:true},{lethalRound:true},{levelUp:true}])
test(`real WS Victory remainder and BattleEnd restore every original step ${JSON.stringify(options)}`,async()=>{
  const initial=options.lethalRound?enemyFaintContext({lethalRound:true}):options.levelUp?await levelUpContext({full:true}):await aftermathContext(options);
  const adapter=adapterFor(initial);let reference=codec.restore(checkpoint(initial)),f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0;
    const store=f.store;
    while(!atEggBoundary(reference)){
      assert.ok(revision<85);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      const kind=reference.decision.kind,seat=reference.decision.requiredSeats[0],inputs=chooseProgression(reference);
      const expected=await referenceAfterBattle(reference,inputs);
      if(kind==='continuing')await confirm(pair,++revision);
      else{await ready(pair);pair[seat].send(message(pair[seat],inputs[seat],`aftermath-choice-${revision}`));
        assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);await receive(pair,++revision);}
      reference=expected.context;assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      for(const c of pair){assert.deepEqual(c.snapshot.events,copy(expected.events));
        assert.deepEqual(copy(adapter.projectSnapshot(c.model,c.identity.seat)),copy(adapter.projectSnapshot(reference,c.identity.seat)));}
    }
    const before=checkpoint(reference);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'UNSUPPORTED_RULE_PHASE');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    if(options.emptySeat===0)assert.ok(pair[0].model.roster.entries.find(e=>e.owner===0&&e.index===0).pokemon.hp>0);
  }finally{await f.close();}
});

async function stageContext(stage){let c=await aftermathContext({emptySeat:1,temporary:true,held:true});
  if(stage==='battle-end')while(!atBattleEnd(c))c=(await advanceAftermath(c)).context;return c;}
for(const stage of ['victory','battle-end'])test(`real WS ${stage} write failure rolls back score, cleanup, recovery and exact queue`,async()=>{
  const initial=await stageContext(stage),before=checkpoint(initial),expected=await referenceAfterBattle(codec.restore(before)),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    store.fail=true;for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));assert.deepEqual(pair[0].snapshot.events,copy(expected.events));
  }finally{await f.close();}
});

test('real WS failed recovery task preserves the unhealed party and old BattleEnd for retry',async()=>{
  const initial=await stageContext('battle-end'),before=checkpoint(initial),fault={enabled:true};
  const adapter=adapterFor(initial,{onAftermathBind:(_c,_p,_b,tasks,info)=>{
    if(fault.enabled&&info.stage==='recovery')tasks.add(Promise.reject(Error('recovery task')));
  }});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(f.store.data.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.enabled=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await referenceAfterBattle(codec.restore(before));
    assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
    assert.equal(pair[0].snapshot.events.filter(e=>e.kind==='victory-recovery').length,1);
  }finally{await f.close();}
});

test('real WS score, lapsing items and personal recovery stay isolated between two rooms',async()=>{
  const initial=await stageContext('battle-end'),before=checkpoint(initial),adapter=adapterFor(initial),f=await formalFixture(adapter);
  try{const first=await connect(f,adapter),second=await connect(f,adapter),firstId=first[0].identity.roomId,secondId=second[0].identity.roomId;
    assert.notEqual(firstId,secondId);await confirm(first,1);
    assert.ok(f.rooms.get(firstId).checkpoint.scene.score>before.scene.score);
    assert.deepEqual(f.rooms.get(secondId).checkpoint,before);assert.deepEqual(f.store.data.get(secondId).checkpoint,before);
    await confirm(second,1);assert.deepEqual(f.rooms.get(firstId).checkpoint,f.rooms.get(secondId).checkpoint);
  }finally{await f.close();}
});
