import test from 'node:test';
import assert from 'node:assert/strict';
import { targetContext } from './helpers/target-model.mjs';
import { codec } from './helpers/decision-model.mjs';
import { formalFixture } from './helpers/formal-ws.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';
import { resolveTargetIntent, applyTargetSelection } from '../src/battle-core/target-command.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';
import { withOriginalRandom } from '../server/original-random-context.mjs';
import { ruleRandom } from '../src/battle-core/random-context.mjs';

const targets = () => ({targets:[2,3],multiple:false});
function initial() {
  const context = targetContext();
  // Protocol fixture has no personal rewards or balances to publish.
  context.players.forEach(p => {p.money=0;p.modifiers=[];Object.keys(p.pokeballCounts).forEach(k=>{p.pokeballCounts[k]=0;});});
  return context;
}
const adapter = {
  rulesVersion:'m2-target-test-v3',contentHash:'synthetic-catalog',createInitialContext:initial,
  captureCheckpoint:codec.capture,restoreCheckpoint:codec.restore,validateCheckpoint:codec.validate,
  describeDecision:ctx=>({id:ctx.decision.id,requiredSeats:ctx.decision.requiredSeats}),
  validateAction(ctx,seat,action) { codec.validateAction(ctx,seat,action); resolveTargetIntent(ctx,seat,action,targets); },
  async advanceToDecision(ctx,inputs) {
    return withOriginalRandom(ctx.sceneRandom, async () => {
      await Promise.resolve();
      const cursor = resolveTargetIntent(ctx,0,inputs[0],targets), events=[];
      applyTargetSelection(ctx.battle.turnCommands,0,cursor,{ballCommand:1,requeueCommand:index=>events.push({kind:'command',fieldIndex:index})});
      ctx.decision = {id:'next-input',kind:'wait-actions',requiredSeats:cursor===-1?[0,1]:[1],options:cursor===-1?{0:[{kind:'test-next',pokemonId:100}],1:[{kind:'test-next',pokemonId:101}]}:{1:[{kind:'test-next',pokemonId:101}]}};
      // A synthetic rule draw exercises the async-local stream through the
      // transport boundary; it is not damage/PP execution.
      events.push({kind:'test-draw',value:ruleRandom(()=>assert.fail()).integerInRange(0,99)});
      return {context:ctx,events,grants:[]};
    });
  },
  projectSnapshot:ctx=>({shared:codec.capture(ctx),personal:{}})
};
async function connect(f, identities, damageSeat = null) {
  const pair = [await f.client(),await f.client()];
  for(const [seat,c] of pair.entries()) {
    c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}:seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',roomId:pair[0].identity.roomId,name:'B'});
    c.identity=await c.wait(m=>m.type==='welcome');
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.send(m),adapter:{
      applySnapshot(s){c.model=codec.restore(s.shared);if(seat===damageSeat)c.model.roster.entries[0].pokemon.hp--;},
      captureAppliedState:()=>adapter.projectSnapshot(c.model),async applyGrantsTransaction(grants){assert.deepEqual(grants,[]);}
    }});
  }
  for(const c of pair) {c.snapshot=await c.wait(m=>m.type==='snapshot');await c.consume(c.snapshot);}
  if(damageSeat===null)await pair[0].wait(m=>m.type==='syncStatus'&&!m.blocked);
  return pair;
}
const input = (c, target) => ({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:'target-once',action:{kind:'target',pokemonId:100,target}});

test('real WS target stop restarts, preserves forced command and applies selection/cancel once after actual-model ACK',async()=>{
  for(const target of [-1,3]) {
    let f=await formalFixture(adapter);
    try {
      let pair=await connect(f), identities=pair.map(c=>c.identity), before=copy(f.rooms.get(identities[0].roomId).checkpoint);
      assert.notEqual(pair[0].model.roster.entries[0].pokemon,pair[1].model.roster.entries[0].pokemon);
      const store=f.store;await f.close();f=await formalFixture(adapter,store);pair=await connect(f,identities);
      const submitted=input(pair[0],target);pair[0].send(submitted);await pair[0].wait(m=>m.type==='actionReceipt'&&m.accepted);
      const expected=await adapter.advanceToDecision(codec.restore(before),{0:submitted.action});
      for(const c of pair) {
        const s=await c.wait(m=>m.type==='snapshot'&&m.revision===1);assert.deepEqual(s.events,expected.events);await c.consume(s);
        assert.deepEqual(codec.capture(c.model),codec.capture(expected.context));
      }
      pair[0].send(submitted);await pair[0].wait(m=>m.type==='actionReceipt'&&m.accepted);
      assert.equal(f.rooms.get(identities[0].roomId).revision,1);
    } finally {await f.close();}
  }
});

test('target transition disk failure retries saved command and room RNG without applying the choice twice',async()=>{
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let f=await formalFixture(adapter,store);
  try {
    let pair=await connect(f);const ids=pair.map(c=>c.identity),before=copy(f.rooms.get(ids[0].roomId).checkpoint);
    store.fail=true;pair[0].send(input(pair[0],3));await pair[0].wait(m=>m.type==='error'&&m.code==='STORAGE_FAILED');
    assert.deepEqual(store.data.get(ids[0].roomId).checkpoint,before);
    assert.equal(Object.keys(store.data.get(ids[0].roomId).inputs).length,1);
    await f.close();store.fail=false;f=await formalFixture(adapter,store);pair=await connect(f,ids);
    const expected=await adapter.advanceToDecision(codec.restore(before),{0:{kind:'target',pokemonId:100,target:3}});
    for(const c of pair){const s=await c.wait(m=>m.type==='snapshot'&&m.revision===1);await c.consume(s);assert.deepEqual(codec.capture(c.model),codec.capture(expected.context));}
  }finally{store.fail=false;await f.close();}
});
