import test from 'node:test';
import assert from 'node:assert/strict';
import { trainerDecisionCodec as codec, initialDecision as initialUntrainedDecision, initialTrainer, continueDecision, modifierCodec } from './helpers/decision-model.mjs';
import { bindTrainerScene } from './helpers/trainer-model.mjs';
import { formalFixture } from './helpers/formal-ws.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';
import { resolveFightIntent } from '../src/battle-core/fight-command.mjs';
import { battler } from './helpers/original-model.mjs';

const fightRules = {fightCommand:0,noneMove:0,struggleMove:165,getEncoreTag:p=>p.getTag(battler.EncoreTag),getMoveTargets:()=>({targets:[2],multiple:false})};

function initialDecision() {
  const ctx = initialUntrainedDecision();
  ctx.battle.battleType = 1;
  ctx.battle.trainer = initialTrainer(2);
  for (const seat of [0,1]) {
    const pokemon = ctx.roster.entries[seat].pokemon;
    pokemon.summonData.moveQueue=[]; pokemon.summonData.disabledMove=0;
    const encore=battler.getBattlerTag('ENCORE',3,33,pokemon.id);encore.moveId=57;
    pokemon.summonData.tags=[encore];
    ctx.decision.options[seat]=[{kind:'fight',pokemonId:pokemon.id,cursor:0,target:null}];
  }
  return ctx;
}

const adapter = {
  rulesVersion:'m2-wait-action-test',contentHash:'test-catalog',
  createInitialContext:()=>initialDecision(), captureCheckpoint:codec.capture, validateCheckpoint:codec.validate, restoreCheckpoint:codec.restore,
  describeDecision:ctx=>({id:ctx.decision.id,requiredSeats:ctx.decision.requiredSeats}),
  validateAction(ctx,seat,action) {
    codec.validateAction(ctx,seat,action);
    const pokemon=ctx.roster.entries.find(e=>e.pokemon.id===ctx.roster.field[seat]).pokemon;
    resolveFightIntent(pokemon,seat,action,fightRules);
  },
  advanceToDecision(ctx) { const result=continueDecision(ctx); return {context:ctx,events:[result],grants:[]}; },
  projectSnapshot(ctx,seat) {
    const players=[0,1].map(()=>({money:0,pokeballCounts:{0:0,1:0,2:0,3:0,4:0},modifiers:[]}));
    const shared=codec.capture({...ctx,players}), p=ctx.players[seat];
    return {shared,personal:{resources:{money:p.money,pokeballCounts:copy(p.pokeballCounts),modifiers:p.modifiers.map(modifierCodec.capture)}}};
  }
};
async function clients(f,identities) {
  const list=[await f.client(),await f.client()];
  for(const [seat,c] of list.entries()) {
    c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}:seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',name:'B',roomId:list[0].identity.roomId});
    c.identity=await c.wait(m=>m.type==='welcome');
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.send(m),adapter:{
      applySnapshot(s) {
        const combined=copy(s.shared),p=s.personal.resources;
        const modifiers=p.modifiers.map(state=>{const id=combined.components.length;combined.components.push({kind:'modifier',state});return id;});
        combined.players[seat]={money:p.money,pokeballCounts:copy(p.pokeballCounts),modifiers};
        const candidate=codec.restore(combined); c.model=candidate;
      },captureAppliedState:()=>adapter.projectSnapshot(c.model,seat),async applyGrantsTransaction(grants){assert.deepEqual(grants,[]);}
    }});
  }
  for(const c of list) { c.snapshot=await c.wait(m=>m.type==='snapshot'); await c.consume(c.snapshot); }
  await list[0].wait(m=>m.type==='syncStatus'&&!m.blocked); return list;
}
const action=(c,id)=>({type:'submitAction',roomId:c.snapshot.roomId,runId:c.snapshot.runId,decisionId:c.snapshot.decisionId,expectedRevision:c.snapshot.revision,actionId:id,action:c.snapshot.shared.decision.options[c.identity.seat][0]});

test('wait-action real WS restart retains one input, both RNG streams and private resources without double cost',async()=>{
  let f=await formalFixture(adapter);
  try {
    const original=initialDecision(), expectedEvent=continueDecision(original);
    let pair=await clients(f); const ids=pair.map(c=>c.identity), roomId=ids[0].roomId;
    assert.notEqual(pair[0].model.battle.trainer, pair[1].model.battle.trainer);
    for (const c of pair) {
      const trainer = bindTrainerScene(c.model.battle.trainer);
      assert.deepEqual(trainer.getPartyLevels(50), bindTrainerScene(initialTrainer(2)).getPartyLevels(50));
      assert.equal(Object.hasOwn(trainer, 'name'), false);
    }
    assert.ok(pair[0].snapshot.shared.players.every(p=>p.money===0&&p.modifiers.length===0));
    assert.equal(pair[0].model.players[1].money,0); // Teammate inventory was not sent.
    const pending=action(pair[0],'once'); pair[0].send(pending); await pair[0].wait(m=>m.type==='actionReceipt'&&m.accepted);
    const store=f.store; await f.close(); f=await formalFixture(adapter,store); pair=await clients(f,ids);
    pair[0].send(pending); await pair[0].wait(m=>m.type==='actionReceipt'&&m.accepted);
    pair[1].send(action(pair[1],'finish')); await pair[1].wait(m=>m.type==='actionReceipt'&&m.accepted);
    for(const c of pair) { const s=await c.wait(m=>m.type==='snapshot'&&m.revision===1); assert.deepEqual(s.events,[expectedEvent]); await c.consume(s); assert.deepEqual(adapter.projectSnapshot(c.model,c.identity.seat),adapter.projectSnapshot(original,c.identity.seat)); }
    assert.deepEqual(f.rooms.get(roomId).checkpoint,codec.capture(original));
    pair[0].send(pending); await pair[0].wait(m=>m.type==='actionReceipt'); assert.equal(f.rooms.get(roomId).revision,1);
  } finally {await f.close();}
});

test('unknown persisted Trainer config blocks recovery without overwriting the room', async () => {
  let f = await formalFixture(adapter);
  try {
    const pair = await clients(f), identity = pair[0].identity, store = f.store;
    await f.close();
    const room = store.data.get(identity.roomId);
    room.checkpoint.components.find(c => c.kind === 'trainer').state.configId = 999;
    const before = copy(room);
    f = await formalFixture(adapter, store);
    const c = await f.client();
    c.send({type:'resumeSeat',roomId:identity.roomId,resumeToken:identity.resumeToken});
    assert.equal((await c.wait(m => m.type === 'error')).code, 'UNKNOWN_TRAINER_CONFIG');
    assert.deepEqual(store.data.get(identity.roomId), before);
    assert.equal(c.messages.some(m => m.type === 'snapshot'), false);
  } finally { await f.close(); }
});
test('wait-action transition write failure leaves both accepted inputs and exact random state for retry',async()=>{
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  const f=await formalFixture(adapter,store);
  try {
    const pair=await clients(f),roomId=pair[0].identity.roomId,before=copy(f.rooms.get(roomId).checkpoint);
    store.fail=true;
    for(const [index,c] of pair.entries()){c.send(action(c,`input-${index}`));await c.wait(m=>m.type==='actionReceipt'&&m.accepted);}
    assert.equal((await pair[1].wait(m=>m.type==='error')).code,'STORAGE_FAILED');assert.deepEqual(f.rooms.get(roomId).checkpoint,before);assert.equal(Object.keys(store.data.get(roomId).inputs).length,2);
    store.fail=false;
    for(const c of pair)c.messages=[];
    pair[0].send({type:'requestSnapshot',roomId,runId:pair[0].snapshot.runId,knownRevision:0,reason:'retry'});
    for(const c of pair)await c.consume(await c.wait(m=>m.type==='snapshot'));
    await pair[0].wait(m=>m.type==='snapshot'&&m.revision===1);
    const expected=codec.restore(before);continueDecision(expected);assert.deepEqual(f.rooms.get(roomId).checkpoint,codec.capture(expected));
  } finally {store.fail=false;await f.close();}
});
test('corrupt persisted action is rejected at restore before publication or rewriting the save',async()=>{
  let f=await formalFixture(adapter);
  try {
    const pair=await clients(f),identity=pair[0].identity; pair[0].send(action(pair[0],'pending'));await pair[0].wait(m=>m.type==='actionReceipt');
    const store=f.store;await f.close();store.data.get(identity.roomId).inputs[0].pokemonId=101;
    const before=copy(store.data.get(identity.roomId));f=await formalFixture(adapter,store);
    const c=await f.client();c.send({type:'resumeSeat',roomId:identity.roomId,resumeToken:identity.resumeToken});assert.equal((await c.wait(m=>m.type==='error')).code,'INVALID_ACTION');assert.deepEqual(store.data.get(identity.roomId),before);
  } finally {await f.close();}
});
