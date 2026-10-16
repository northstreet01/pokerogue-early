import test from 'node:test';
import assert from 'node:assert/strict';
import {itemRoundContext,itemInputContext,addBattleItem,advanceBattleItems,referenceBattleItems,chooseBattleItems} from './helpers/battle-items-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {projectPreparation,preparationClients as connect} from './helpers/preparation-model.mjs';
import {safeAdapter} from './helpers/safe-model.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import {eggs} from './helpers/egg-model.mjs';
const saved=context=>copy(codec.capture(context));
function adapterFor(initial,options={}){const start=saved(initial);return {...safeAdapter('ended'),rulesVersion:'original-battle-items-test',
  createInitialContext:()=>codec.restore(start),projectSnapshot:projectPreparation,
  describeDecision:context=>({id:context.decision.id,requiredSeats:context.decision.requiredSeats,collection:context.decision.kind==='continuing'?'auto':'all'}),
  validateAction:(context,seat,action)=>codec.validateAction(context,seat,action),
  advanceToDecision:(context,inputs)=>advanceBattleItems(context,inputs,options)
};}
async function receive(pair,revision){for(const client of pair){client.snapshot=await client.wait(message=>message.type==='snapshot'&&message.revision===revision);assert.equal(await client.consume(client.snapshot),true);}}
function ack(pair){for(const client of pair)client.send(client.acks.shift());}
async function ready(pair){ack(pair);await pair[0].wait(message=>message.type==='syncStatus'&&message.revision===pair[0].snapshot.revision&&!message.blocked);}
const request=(client,action,id)=>({type:'submitAction',roomId:client.snapshot.roomId,runId:client.snapshot.runId,decisionId:client.snapshot.decisionId,expectedRevision:client.snapshot.revision,actionId:id,action});
async function pendingItem(name,seat=0){
  let context=await itemRoundContext();context.roster.entries[seat??2].pokemon.hp=10;addBattleItem(context,seat,'BERRY',{stack:2});
  context.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase:new originalPhases.TurnEndPhase({}),remaining:'start'}];
  for(let step=0;nextPostPhase(context)?.constructor!==originalPhases[name];step++){
    assert.ok(step<20);context=(await advanceBattleItems(context,chooseBattleItems(context))).context;
  }
  return context;
}

for(const seat of [0,1])for(const withEggs of [false,true])test(`real WS v${withEggs?7:6} item owner ${seat} survives both-client restart at every original phase and deduplicates real action input`,async()=>{
  const initial=await itemInputContext(seat);
  if(withEggs)initial.eggState={players:[[new eggs.Egg(28123456,0,3,1000)],[new eggs.Egg(28123567,1,7,2000)]]};
  const adapter=adapterFor(initial);let fixture=await formalFixture(adapter);
  try{
    let pair=await connect(fixture,adapter),reference={context:codec.restore(saved(initial))},revision=0;
    const identities=pair.map(client=>client.identity),roomId=identities[0].roomId,requests=[],startTurn=initial.battle.turn;
    while(reference.context.battle.turn===startTurn||reference.context.decision.kind!=='wait-actions'){
      assert.ok(revision<90);let inputs={};
      if(reference.context.decision.kind==='continuing')ack(pair);
      else{
        await ready(pair);inputs=chooseBattleItems(reference.context);
        for(const owner of reference.context.decision.requiredSeats){
          const message=request(pair[owner],inputs[owner],`item-input-${revision}-${owner}`);requests.push({owner,message});pair[owner].send(message);
          assert.equal((await pair[owner].wait(message=>message.type==='actionReceipt')).accepted,true);
        }
      }
      reference=await referenceBattleItems(reference.context,inputs);await receive(pair,++revision);
      assert.deepEqual(fixture.rooms.get(roomId).checkpoint,saved(reference.context));
      for(const client of pair){assert.deepEqual(client.snapshot.events,reference.events);
        const model=client.model.context??client.model;
        assert.equal(saved(model).version,withEggs?7:6);assert.equal(Object.hasOwn(model,'eggState'),withEggs);
        assert.deepEqual(copy(adapter.projectSnapshot(client.model,client.identity.seat)),copy(adapter.projectSnapshot(reference.context,client.identity.seat)));}
      const store=fixture.store;await fixture.close();fixture=await formalFixture(adapter,store);pair=await connect(fixture,adapter,identities);
      for(const old of requests){pair[old.owner].send(old.message);assert.equal((await pair[old.owner].wait(message=>message.type==='actionReceipt')).accepted,true);}
      assert.equal(fixture.rooms.get(roomId).revision,revision);assert.deepEqual(fixture.rooms.get(roomId).checkpoint,saved(reference.context));
    }
    assert.equal(reference.context.players[seat].modifiers.find(item=>item.type.id==='BERRY').stackCount,1);
    assert.ok(reference.context.roster.entries[seat].pokemon.hp>20);
  }finally{await fixture.close();}
});

for(const phaseName of ['BerryPhase','PokemonHealPhase'])for(const seat of [0,1,null])test(`real WS ${phaseName} owner ${seat} write failure retains committed items, HP and RNG for restart retry`,async()=>{
  const initial=await pendingItem(phaseName,seat),adapter=adapterFor(initial),before=saved(initial);
  const store={data:new Map(),fail:false,async load(){return [...this.data.values()].map(copy);},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,copy(room));}};
  let fixture=await formalFixture(adapter,store);
  try{
    let pair=await connect(fixture,adapter);const identities=pair.map(client=>client.identity),roomId=identities[0].roomId;
    store.fail=true;ack(pair);assert.equal((await pair[1].wait(message=>message.type==='error')).code,'STORAGE_FAILED');
    assert.deepEqual(fixture.rooms.get(roomId).checkpoint,before);assert.deepEqual(store.data.get(roomId).checkpoint,before);
    await fixture.close();store.fail=false;fixture=await formalFixture(adapter,store);pair=await connect(fixture,adapter,identities);
    ack(pair);await receive(pair,1);const reference=await referenceBattleItems(codec.restore(before));
    assert.deepEqual(fixture.rooms.get(roomId).checkpoint,saved(reference.context));assert.deepEqual(pair[0].snapshot.events,reference.events);
  }finally{await fixture.close();}
});

test('real WS failed original item update task cannot publish consumption and succeeds after both clients restart',async()=>{
  const initial=await pendingItem('BerryPhase',1),before=saved(initial),fault={active:true};
  const adapter=adapterFor(initial,{updateInfo:(_actor,seat)=>fault.active&&seat===1?Promise.reject(Error('item-update-fault')):Promise.resolve()});
  let fixture=await formalFixture(adapter);
  try{
    let pair=await connect(fixture,adapter);const identities=pair.map(client=>client.identity),roomId=identities[0].roomId;
    ack(pair);assert.equal((await pair[1].wait(message=>message.type==='error')).code,'RUNNER_FAILED');assert.deepEqual(fixture.rooms.get(roomId).checkpoint,before);
    const store=fixture.store;await fixture.close();fault.active=false;fixture=await formalFixture(adapter,store);pair=await connect(fixture,adapter,identities);
    ack(pair);await receive(pair,1);assert.deepEqual(fixture.rooms.get(roomId).checkpoint,saved((await referenceBattleItems(codec.restore(before))).context));
  }finally{await fixture.close();}
});

test('real WS two rooms isolate berry consumption, healing and RNG behind both client ACKs',async()=>{
  const initial=await pendingItem('BerryPhase',0),before=saved(initial),adapter=adapterFor(initial),fixture=await formalFixture(adapter);
  try{
    const first=await connect(fixture,adapter),second=await connect(fixture,adapter),firstId=first[0].identity.roomId,secondId=second[0].identity.roomId;
    first[0].send(first[0].acks.shift());await first[0].wait(message=>message.type==='syncStatus'&&message.acked[0]&&!message.acked[1]);
    assert.deepEqual(fixture.rooms.get(firstId).checkpoint,before);ack(second);await receive(second,1);
    assert.deepEqual(fixture.rooms.get(firstId).checkpoint,before);first[1].send(first[1].acks.shift());await receive(first,1);
    assert.deepEqual(fixture.rooms.get(firstId).checkpoint,fixture.rooms.get(secondId).checkpoint);
    const keep=copy(fixture.rooms.get(secondId).checkpoint);ack(first);await receive(first,2);assert.deepEqual(fixture.rooms.get(secondId).checkpoint,keep);
  }finally{await fixture.close();}
});
