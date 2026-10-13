import test from 'node:test';
import assert from 'node:assert/strict';
import { codec } from './helpers/decision-model.mjs';
import { learningContext } from './helpers/learn-model.mjs';
import { switchContext } from './helpers/switch-model.mjs';
import { resolveLearnIntent } from '../src/battle-core/learn-command.mjs';
import { resolveForcedSwitchIntent } from '../src/battle-core/switch-command.mjs';
import { formalFixture } from './helpers/formal-ws.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';

function adapterFor(make,resolve) {
  return {
    rulesVersion:'m2-interaction-state-test',contentHash:'synthetic-catalog',
    createInitialContext(){const c=make();c.players.forEach(p=>{p.money=0;p.modifiers=[];Object.keys(p.pokeballCounts).forEach(k=>{p.pokeballCounts[k]=0;});});return c;},
    captureCheckpoint:codec.capture,restoreCheckpoint:codec.restore,validateCheckpoint:codec.validate,
    describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats}),
    validateAction(c,seat,action){codec.validateAction(c,seat,action);resolve(c,seat,action);},
    // Test-only continuation descriptors: no fake summoning/evolution execution.
    advanceToDecision(c,inputs){const events=Object.entries(inputs).map(([seat,a])=>resolve(c,Number(seat),a));c.decision.id+='-validated';return {context:c,events,grants:[]};},
    projectSnapshot:c=>({shared:codec.capture(c),personal:{}})
  };
}
async function connect(f,adapter,identities) {
  const pair=[await f.client(),await f.client()];
  for(const [seat,c] of pair.entries()) {
    c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}:seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',roomId:pair[0].identity.roomId,name:'B'});
    c.identity=await c.wait(m=>m.type==='welcome');
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.send(m),adapter:{applySnapshot:s=>{c.model=codec.restore(s.shared);},captureAppliedState:()=>adapter.projectSnapshot(c.model),async applyGrantsTransaction(g){assert.deepEqual(g,[]);}}});
  }
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot');await c.consume(c.snapshot);}
  await pair[0].wait(m=>m.type==='syncStatus'&&!m.blocked);return pair;
}
const submit=(c)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:'once-'+c.identity.seat,action:c.model.decision.options[c.identity.seat][0]});

test('real WS learning decision restores original model on both clients and validates the same pending move',async()=>{
  const adapter=adapterFor(learningContext,(c,s,a)=>resolveLearnIntent(c,s,a,id=>id===57));
  let f=await formalFixture(adapter);
  try {
    let pair=await connect(f,adapter);const ids=pair.map(c=>c.identity),store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);
    assert.notEqual(pair[0].model.roster.entries[0].pokemon,pair[1].model.roster.entries[0].pokemon);
    pair[0].send(submit(pair[0]));await pair[0].wait(m=>m.type==='actionReceipt'&&m.accepted);
    for(const c of pair){const s=await c.wait(m=>m.type==='snapshot'&&m.revision===1);assert.deepEqual(s.events,[{kind:'forget-and-relearn',pokemonId:100,slot:0,moveId:57}]);await c.consume(s);assert.deepEqual(codec.capture(c.model),s.shared);}
  }finally{await f.close();}
});

test('real WS forced replacement keeps the first seat choice through restart and never accepts a partner-owned replacement',async()=>{
  const adapter=adapterFor(switchContext,resolveForcedSwitchIntent);let f=await formalFixture(adapter);
  try {
    let pair=await connect(f,adapter);const ids=pair.map(c=>c.identity),store=f.store,first=submit(pair[0]);pair[0].send(first);await pair[0].wait(m=>m.type==='actionReceipt'&&m.accepted);
    await f.close();f=await formalFixture(adapter,store);pair=await connect(f,adapter,ids);
    assert.deepEqual(store.data.get(ids[0].roomId).inputs[0],first.action);
    const wrong=submit(pair[1]);wrong.action=copy(first.action);wrong.actionId='wrong-owner';pair[1].send(wrong);assert.equal((await pair[1].wait(m=>m.type==='actionReceipt'&&m.actionId==='wrong-owner')).accepted,false);
    pair[0].send(first);await pair[0].wait(m=>m.type==='actionReceipt'&&m.accepted);
    pair[1].send(submit(pair[1]));await pair[1].wait(m=>m.type==='actionReceipt'&&m.accepted);
    for(const c of pair){const s=await c.wait(m=>m.type==='snapshot'&&m.revision===1);assert.deepEqual(s.events.map(e=>e.pokemonId),[110,111]);await c.consume(s);assert.deepEqual(codec.capture(c.model),s.shared);}
  }finally{await f.close();}
});
