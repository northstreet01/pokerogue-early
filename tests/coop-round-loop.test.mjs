import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {moves} from './helpers/original-model.mjs';
import {roundContext,advanceRound,runRoundReference,resolveRoundFight} from './helpers/round-loop-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {appliedDecisionClients as connect} from './helpers/applied-decision-clients.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

function adapterFor(initial){const saved=codec.capture(initial);return {...safeAdapter('ended'),rulesVersion:'native-round-loop-test',
  createInitialContext:()=>codec.restore(saved),
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:c.decision.kind==='continuing'?'auto':'all'}),
  validateAction(c,seat,action){codec.validateAction(c,seat,action);resolveRoundFight(c,seat,action);},
  advanceToDecision:advanceRound};}
async function confirm(pair,revision){for(const c of pair)c.send(c.acks.shift());
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot'&&m.revision===revision);await c.consume(c.snapshot);}}
async function referenceSteps(initial){let c=codec.restore(codec.capture(initial));const steps=[];
  while(c.decision.kind==='continuing'){assert.ok(steps.length<50);const name=nextPostPhase(c).constructor.name,result=await runRoundReference(c);c=result.context;
    steps.push({name,checkpoint:codec.capture(c),events:result.events});}return steps;}
const submit=(c,action,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,
  decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:id,action});

for(const [seat,move]of [[0,moves.Moves.DOUBLE_SLAP],[1,moves.Moves.GROWL]])
test(`real WS original whole round restores through next input and persists one new action, owner=${seat}`,async()=>{
  const initial=roundContext({seat,move,seed:`ws-round-${seat}`}),steps=await referenceSteps(initial),adapter=adapterFor(initial);
  let f=await formalFixture(adapter);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    const restarted=new Set();
    for(let i=0;i<steps.length;i++){
      await confirm(pair,i+1);assert.deepEqual(f.rooms.get(id).checkpoint,steps[i].checkpoint);
      for(const c of pair){assert.deepEqual(c.snapshot.events,steps[i].events);
        assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(codec.restore(steps[i].checkpoint),c.identity.seat));}
      if(['MoveEffectPhase','DamagePhase','StatChangePhase','TurnEndPhase','TurnInitPhase'].includes(steps[i].name)&&!restarted.has(steps[i].name)){
        restarted.add(steps[i].name);const store=f.store;
        await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
        assert.equal(f.rooms.get(id).revision,i+1);assert.deepEqual(f.rooms.get(id).checkpoint,steps[i].checkpoint);
      }
    }
    const saved=copy(f.rooms.get(id).checkpoint),revision=steps.length;
    assert.equal(pair[0].model.decision.kind,'wait-actions');
    for(const c of pair)c.send(c.acks.shift());
    await pair[1].wait(m=>m.type==='syncStatus'&&m.reason==='READY');
    const action=pair[seat].model.decision.options[seat][0],sent=submit(pair[seat],action,'next-round-one');
    pair[seat].send(sent);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.deepEqual(f.store.data.get(id).inputs,{[seat]:action});assert.deepEqual(f.rooms.get(id).checkpoint,saved);
    const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    assert.equal(f.rooms.get(id).revision,revision);assert.deepEqual(f.rooms.get(id).inputs,{[seat]:action});
    // Receipt deduplication is valid before new ACKs, and cannot spend PP/RNG.
    pair[seat].send(sent);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt')).accepted,true);
    assert.deepEqual(f.rooms.get(id).checkpoint,saved);
  }finally{await f.close();}
});

for(const failPhase of ['TurnStartPhase','TurnEndPhase','TurnInitPhase'])
test(`real WS ${failPhase} write failure preserves original whole-round state`,async()=>{
  const initial=roundContext(),steps=await referenceSteps(initial),failRevision=steps.findIndex(s=>s.name===failPhase)+1,adapter=adapterFor(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},
    async save(room){if(this.fail&&room.revision===failRevision)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try{let pair=await connect(f,adapter),identities=pair.map(c=>c.identity),id=identities[0].roomId;
    for(let revision=1;revision<failRevision;revision++)await confirm(pair,revision);
    const before=copy(f.rooms.get(id).checkpoint);store.fail=true;for(const c of pair)c.send(c.acks.shift());
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(f.rooms.get(id).checkpoint,before);assert.deepEqual(store.data.get(id).checkpoint,before);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,adapter,identities);
    await confirm(pair,failRevision);assert.deepEqual(f.rooms.get(id).checkpoint,steps[failRevision-1].checkpoint);
    for(let revision=failRevision+1;revision<=steps.length;revision++)await confirm(pair,revision);
    assert.deepEqual(f.rooms.get(id).checkpoint,steps.at(-1).checkpoint);assert.equal(pair[0].model.battle.turn,2);
  }finally{await f.close();}
});
