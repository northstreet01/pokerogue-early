import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {experienceContext,advanceExperience,referenceExperience,atExperienceEnd} from './helpers/experience-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

const checkpoint=c=>copy(codec.capture(c));
function adapterFor(initial,options={}){const saved=checkpoint(initial);return {...safeAdapter('ended'),rulesVersion:'native-coop-experience-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:[],collection:'auto'}),
  advanceToDecision:c=>advanceExperience(c,options)};}
async function receive(pair,revision){for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());await receive(pair,revision);}

for(const options of [{},{share:true,bonuses:true},{emptySeat:true},{levelUp:true}])
test(`real WS original coop experience survives every phase restart ${JSON.stringify(options)}`,async()=>{
  const initial=await experienceContext(options),adapter=adapterFor(initial);let reference=codec.restore(checkpoint(initial)),f=await formalFixture(adapter);
  const stopped=c=>options.levelUp?nextPostPhase(c).constructor===originalPhases.LevelUpPhase:atExperienceEnd(c);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId,revision=0;const store=f.store;
    while(!stopped(reference)){
      assert.ok(revision<15);await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
      assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      const expected=await referenceExperience(reference);reference=expected.context;await confirm(pair,++revision);
      assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(reference));
      for(const c of pair){assert.deepEqual(c.snapshot.events,expected.events);
        assert.deepEqual(copy(adapter.projectSnapshot(c.model,c.identity.seat)),copy(adapter.projectSnapshot(reference,c.identity.seat)));}
    }
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);const before=checkpoint(reference);
    assert.deepEqual(f.rooms.get(id).checkpoint,before);
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'UNSUPPORTED_RULE_PHASE');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    if(options.levelUp)assert.equal(pair[1].model.roster.entries[1].pokemon.level,6);
    else assert.equal(reference.continuation.phaseQueue[0].remaining,'victory-aftermath');
  }finally{await f.close();}
});

async function stageContext(stage){let c=await experienceContext({share:true,bonuses:true});
  if(stage!=='queue')c=(await advanceExperience(c)).context;
  if(stage==='bar')while(nextPostPhase(c).constructor!==originalPhases.ShowPartyExpBarPhase)c=(await advanceExperience(c)).context;
  return c;}
for(const stage of ['queue','apply','bar'])test(`real WS ${stage} experience storage failure retains exact XP/friendship and queued remainder`,async()=>{
  const initial=await stageContext(stage),before=checkpoint(initial),expected=await referenceExperience(codec.restore(before)),adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    store.fail=true;for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));assert.deepEqual(pair[0].snapshot.events,expected.events);
  }finally{await f.close();}
});

test('real WS failed experience apply tasks preserve pending Victory and already-queued owned EXP',async()=>{
  const initial=await stageContext('apply'),before=checkpoint(initial),fault={enabled:true};
  const adapter=adapterFor(initial,{onExperienceBind:(_c,_p,_b,tasks,info)=>{
    if(fault.enabled&&info.stage==='apply')tasks.add(Promise.reject(Error('experience apply failed')));
  }});let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    for(const c of pair)c.send(c.acks.shift());assert.equal((await pair[1].wait(m=>m.type==='error')).code,'RUNNER_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(f.store.data.get(id).checkpoint,before);
    const store=f.store;await f.close();fault.enabled=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,1);const expected=await referenceExperience(codec.restore(before));assert.deepEqual(f.rooms.get(id).checkpoint,checkpoint(expected.context));
  }finally{await f.close();}
});
