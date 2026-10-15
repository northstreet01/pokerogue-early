import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {replacementContext,advanceReplacement,referenceReplacement,chooseReplacementInputs} from './helpers/replacement-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {validateCycleInput} from './helpers/command-cycle-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

function adapterFor(initial,options={}){const saved=codec.capture(initial);return {...safeAdapter('ended'),rulesVersion:'native-owned-replacement-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
  validateAction(c,seat,action){codec.validateAction(c,seat,action);if(c.decision.kind!=='wait-switch')validateCycleInput(c,seat,action);},
  advanceToDecision:(c,inputs)=>advanceReplacement(c,inputs,options)};}
async function ready(pair){for(const c of pair)c.send(c.acks.shift());await pair[1].wait(m=>m.type==='syncStatus'&&m.revision===pair[1].snapshot.revision&&m.reason==='READY');}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}
const message=(c,action,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,
  expectedRevision:c.snapshot.revision,actionId:id,action});
const stageOf=c=>c.continuation.currentPhase?.remaining||nextPostPhase(c)?.constructor.name;
async function stageContext(stage){let c=await replacementContext({seat:1});
  while(stageOf(c)!==stage)c=(await advanceReplacement(c,chooseReplacementInputs(c))).context;return c;}

for(const options of [{seat:0},{seat:1},{seat:0,both:true}])test(`real WS replacement restores every original stage, seat=${options.seat}, both=${!!options.both}`,async()=>{
  const initial=await replacementContext(options),adapter=adapterFor(initial);let reference=codec.restore(codec.capture(initial)),f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0;
    const store=f.store;let previousInput;
    do{
      assert.ok(revision<65);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
      const kind=reference.decision.kind,seat=reference.decision.requiredSeats[0],inputs=chooseReplacementInputs(reference),expected=await referenceReplacement(reference,inputs);
      if(kind==='continuing')await confirm(pair,++revision);
      else{
        await ready(pair);
        if(previousInput){pair[seat].send({...previousInput,actionId:`stale-${revision}`});
          assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).code,'STALE_DECISION');}
        if(kind==='wait-switch'){
          pair[1-seat].send(message(pair[1-seat],inputs[seat],`wrong-owner-${revision}`));
          assert.equal((await pair[1-seat].wait(m=>m.type==='actionReceipt')).code,'SEAT_NOT_REQUIRED');
          pair[seat].send(message(pair[seat],{kind:'forced-switch',pokemonId:100+seat},`fainted-${revision}`));
          assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,false);
        }
        const sent=message(pair[seat],inputs[seat],`replacement-${revision}`);pair[seat].send(sent);
        assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);await receive(pair,++revision);previousInput=sent;
      }
      reference=expected.context;assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
      for(const client of pair){assert.deepEqual(client.snapshot.events,expected.events);
        assert.deepEqual(adapter.projectSnapshot(client.model,client.identity.seat),adapter.projectSnapshot(reference,client.identity.seat));}
    }while(!(reference.decision.kind==='wait-actions'&&reference.battle.turn===initial.battle.turn+(options.both?1:0)));
    assert.deepEqual(reference.decision.requiredSeats,[0]);
    assert.notEqual(reference.roster.field[options.seat],100+options.seat);
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(reference));
    if(options.both)for(const seat of [0,1])assert.equal(pair[seat].model.roster.entries.find(e=>e.pokemon.id===reference.roster.field[seat]).pokemon.moveset[0].ppUsed,1);
  }finally{await f.close();}
});

for(const stage of ['wait-switch','SwitchSummonPhase','summon-initialize','summon-finish','PostSummonPhase'])
test(`real WS ${stage} write failure retains switch inputs or remaining stage across restart`,async()=>{
  const initial=await stageContext(stage),before=codec.capture(initial),inputs=chooseReplacementInputs(initial),expected=await referenceReplacement(codec.restore(before),inputs);
  const adapter=adapterFor(initial),store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    if(stage==='wait-switch'){await ready(pair);store.fail=true;pair[1].send(message(pair[1],inputs[1],'durable-replacement'));
      assert.equal((await pair[1].wait(m=>m.type==='actionReceipt')).accepted,true);}
    else{store.fail=true;for(const c of pair)c.send(c.acks.shift());}
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    if(stage==='wait-switch')assert.deepEqual(store.data.get(id).inputs,inputs);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
    assert.deepEqual(pair[0].snapshot.events,expected.events);
  }finally{await f.close();}
});

test('real WS rejected summon resume tasks retain exchanged roster, RNG and remaining stage',async()=>{
  const initial=await stageContext('summon-finish'),before=codec.capture(initial),fault={enabled:true};
  const adapter=adapterFor(initial,{onSwitchBind:(_c,_p,_b,tasks)=>{if(fault.enabled)tasks.add(Promise.reject(Error('summon finish failed')));}});
  let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(f.store.data.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.enabled=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await referenceReplacement(codec.restore(before));
    assert.deepEqual(f.rooms.get(id).checkpoint,codec.capture(expected.context));
  }finally{await f.close();}
});
