import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {originalPreparationFixture,member,reward} from './helpers/growth-items-fixture.mjs';
import {progressDefault} from './helpers/native-default-trainer.mjs';
import {openPreparationRoom,request,until} from './helpers/native-preparation-ws.mjs';
import {FormalRoomStore} from '../server/formal-coop-service.mjs';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
let api,route,base;
before(async()=>{await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();const f=await originalPreparationFixture();({route,base}=f);});
after(async()=>route?.h.close());
const copy=structuredClone;
const typeFor=id=>api.modifierTypes[id]().withIdFromFunc(api.modifierTypes[id]);
function option(c,id,type=typeFor(id)){
 const value={id:'original-'+id,type:api.captureModifierTypeState(type),cost:0};
 for(const row of c.decision.players)row.rewards=[copy(value)];return value;
}
const act=(c,seat,action)=>route.h.request('native-prepare-action',{checkpoint:c,seat,action});
const modifiers=(c,seat)=>c.players[seat].modifiers.map(index=>api.restoreModifierState(c.components[index].state));
function attach(c,seat,modifier){c.players[seat].modifiers.push(c.components.length);c.components.push({kind:'modifier',state:api.captureModifierState(modifier)});}

test('original persistent item rewards retain ownership, checkpoint roundtrip and exactly one shared claim',async()=>{
 const held=['FOCUS_BAND','KINGS_ROCK','LEFTOVERS','SHELL_BELL','REVIVER_SEED','SOOTHE_BELL','GOLDEN_PUNCH'];
 for(const id of [...held,'CANDY_JAR','EXP_BALANCE','OVAL_CHARM','COIN_CASE','MEGA_BRACELET','DYNAMAX_BAND','TERA_ORB']){
  const c=copy(base),item=option(c,id),before=copy(c),pokemonId=held.includes(id)?member(c,0).pokemon.fields.id:null;
  const r=await act(c,0,reward(item,pokemonId)),next=r.checkpoint;
  assert.deepEqual(member(next,1),member(before,1),id);assert.deepEqual(next.players[1],before.players[1],id);
  assert.deepEqual(next.sceneRandom,before.sceneRandom,id);
  const restored=modifiers(next,0).find(m=>m.type.id===id);assert.ok(restored,id);
  const added=api.captureModifierState(restored);assert.deepEqual(api.captureModifierState(api.restoreModifierState(added)),added,id);
  if(held.includes(id))assert.equal(restored.pokemonId,pokemonId,id);
  assert.deepEqual(next.decision.shared.rewardClaims,[{optionId:item.id,seat:0}],id);
  await assert.rejects(()=>act(copy(next),0,reward(item,pokemonId)),/PREPARATION_ALREADY_FINISHED/);
  assert.deepEqual(c,before,id);
 }
});

test('Mega and Gigantamax use original generated items, transform only owner and emit durable original collection facts',async()=>{
 for(const access of ['MEGA_BRACELET','DYNAMAX_BAND']){
  const c=copy(base),runtime=api.createOriginalRuntime(c.scene.seed,{trainerId:1,secretId:2}),entry=member(c,0);
  const p=api.constructOriginalPokemon(runtime,6,5);p.id=entry.pokemon.fields.id;p.resetSummonData();p.resetTurnData();entry.pokemon=api.capturePokemonState(p);
  const prerequisite=typeFor(access).newModifier();runtime.scene.modifiers=[prerequisite];attach(c,0,prerequisite);
  const factory=api.modifierTypes.FORM_CHANGE_ITEM;
  const generated=api.withStarterRandomContext(runtime.context,()=>factory().withIdFromFunc(factory).generateType([p]));assert.ok(generated);
  const item=option(c,'FORM_CHANGE_ITEM',generated),before=copy(c);
  const r=await act(c,0,reward(item,p.id)),next=r.checkpoint,changed=api.restorePokemonState(member(next,0).pokemon);
  assert.ok(changed.formIndex>0,access);assert.match(changed.getFormKey(),access==='MEGA_BRACELET'?/mega/:/gigantamax/);
  assert.deepEqual(member(next,1),member(before,1));assert.deepEqual(next.players[1],before.players[1]);
  assert.ok(r.events.some(e=>e.kind==='form-change'&&e.pokemonId===p.id));
  assert.ok(r.intents.some(e=>e.kind==='evolution-pending'&&e.owner===0&&e.pokemon.fields.formIndex===changed.formIndex));
  assert.ok(r.intents.some(e=>e.kind==='achievement-approved'&&e.owner===0));
  await route.h.request('native-validate-checkpoint',next);
  let continued=(await act(copy(next),1,{kind:'preparation',operation:'skip-reward'})).checkpoint;
  for(let n=0;n<20&&continued.decision.kind!=='wait-actions';n++)continued=(await progressDefault(route.h,continued)).checkpoint;
  assert.equal(continued.decision.kind,'wait-actions');assert.ok(continued.battle.waveIndex>before.battle.waveIndex);
  assert.equal(api.restorePokemonState(member(continued,0).pokemon).formIndex,changed.formIndex);
 }
});

test('original Tera Shard replaces the prior type and preserves its ten-wave duration',async()=>{
 let c=copy(base);const runtime=api.createOriginalRuntime(c.scene.seed,{trainerId:1,secretId:2}),p=api.restorePokemonState(member(c,0).pokemon);
 for(const teraType of [10,11]){
  const factory=api.modifierTypes.TERA_SHARD,type=api.withStarterRandomContext(runtime.context,()=>factory().withIdFromFunc(factory).generateType([p],[teraType]));
  c.decision.players.forEach(row=>{row.ready=false;row.rewardResolved=false;});c.decision.shared.rewardClaims=[];
  const item=option(c,'TERA_SHARD',type),r=await act(c,0,reward(item,p.id));c=r.checkpoint;
  const shards=modifiers(c,0).filter(m=>m.constructor.name==='TerastallizeModifier');
  assert.equal(shards.length,1);assert.equal(shards[0].teraType,teraType);assert.equal(shards[0].battlesLeft,10);
 }
});

test('Leftovers runs the original turn-end heal in a real Worker and leaves partner modifiers unchanged',async()=>{
 let c=copy(route.initial);const own=member(c,0),p=api.restorePokemonState(own.pokemon);p.hp=Math.max(1,p.getMaxHp()-1);own.pokemon=api.capturePokemonState(p);
 attach(c,0,typeFor('LEFTOVERS').newModifier(p));
 const peerBefore=copy(c.players[1].modifiers),events=[];let healed=false;
 for(let n=0;n<30;n++){
  const r=await progressDefault(route.h,c);events.push(...r.events);c=r.checkpoint;
  if(events.some(e=>e.kind==='message'&&/吃剩的东西|Leftovers/.test(e.text))){healed=true;break;}
  if(c.battle.turn>1)break;
 }
 assert.ok(healed,'original item heal message: '+JSON.stringify(events.filter(e=>e.text||e.phase).map(e=>({kind:e.kind,text:e.text,phase:e.phase}))));assert.deepEqual(c.players[1].modifiers,peerBefore);
 assert.ok(events.some(e=>e.kind==='pokemon-hp'&&e.pokemonId===p.id));
});

test('own-party fusion transfers original items, retires only the donor, restores learning and unfuses without reviving donor',async()=>{
 for(const baseIndex of [0,1]){
  let c=copy(base);const basePokemon=api.restorePokemonState(member(c,0,baseIndex).pokemon),donor=api.restorePokemonState(member(c,0,1-baseIndex).pokemon);
  attach(c,0,typeFor('LUCKY_EGG').newModifier(donor));
  const item=option(c,'DNA_SPLICERS'),before=copy(c),action={...reward(item,basePokemon.id),fusionId:donor.id};
  const r=await act(c,0,action);c=r.checkpoint;
  assert.equal(c.roster.entries.filter(e=>e.owner===0&&e.group==='party').length,1);
  const fused=api.restorePokemonState(member(c,0).pokemon);
  assert.equal(fused.id,basePokemon.id);assert.equal(fused.fusionSpecies.speciesId,donor.species.speciesId);
  assert.ok(c.roster.retiredIds.includes(donor.id));assert.deepEqual(member(c,1),member(before,1));
  if(baseIndex===0){
    const projection=await route.h.request('native-project',{checkpoint:c,seat:1});
    const publicBase=projection.shared.pokemon.find(p=>p.id===basePokemon.id);
    assert.equal(publicBase.fusion.speciesId,donor.species.speciesId);assert.equal(publicBase.fusion.abilityIndex,undefined);
  }
  const egg=modifiers(c,0).find(m=>m.type.id==='LUCKY_EGG');assert.equal(egg.pokemonId,basePokemon.id);
  assert.ok(r.intents.some(e=>e.kind==='statistics'&&e.owner===0&&e.values.pokemonFused===1));
  for(let n=0;n<12&&c.decision.players[0].subdecision;n++){
    const choice=c.decision.players[0].subdecision;assert.equal(choice.kind,'learn-move');
    c=(await act(copy(c),0,choice.options[0].find(o=>o.slot===null))).checkpoint;
  }
  assert.equal(c.decision.players[0].subdecision,null);
  c.decision.players[0].rewardResolved=false;c.decision.players[0].ready=false;c.decision.shared.rewardClaims=[];
  const reverse=option(c,'REVERSE_DNA_SPLICERS');c=(await act(copy(c),0,reward(reverse,basePokemon.id))).checkpoint;
  assert.equal(api.restorePokemonState(member(c,0).pokemon).fusionSpecies,undefined);
  assert.equal(c.roster.entries.filter(e=>e.owner===0&&e.group==='party').length,1);
  assert.ok(c.roster.retiredIds.includes(donor.id));
  const oldWave=c.battle.waveIndex;c=(await act(copy(c),1,{kind:'preparation',operation:'skip-reward'})).checkpoint;
  for(let n=0;n<20&&c.decision.kind!=='wait-actions';n++)c=(await progressDefault(route.h,c)).checkpoint;
  assert.equal(c.decision.kind,'wait-actions');assert.ok(c.battle.waveIndex>oldWave);assert.equal(c.roster.field[0],basePokemon.id);
 }
});

test('fusion rejects foreign donor and self fusion before changing stock',async()=>{
 const c=copy(base),item=option(c,'DNA_SPLICERS'),own=member(c,0).pokemon.fields.id,peer=member(c,1).pokemon.fields.id,before=copy(c);
 for(const fusionId of [peer,own])await assert.rejects(()=>act(c,0,{...reward(item,own),fusionId}),/INVALID_PREPARATION_OWNER|INVALID_ACTION/);
 assert.deepEqual(c,before);
});

test('Memory Mushroom recalls an original level move beyond slot four and rejects stale indices',async()=>{
 const c=copy(base),runtime=api.createOriginalRuntime(c.scene.seed,{trainerId:1,secretId:2}),entry=member(c,0),p=api.constructOriginalPokemon(runtime,6,50);
 p.id=entry.pokemon.fields.id;p.moveset=[];const learnable=p.getLearnableLevelMoves();assert.ok(learnable.length>4);
 entry.pokemon=api.capturePokemonState(p);const item=option(c,'MEMORY_MUSHROOM'),action={...reward(item,p.id),moveIndex:4};
 await assert.rejects(()=>act(c,0,{...action,moveIndex:999}),/INVALID_PREPARATION_MOVE/);
 let next=(await act(c,0,action)).checkpoint;
 assert.ok(api.restorePokemonState(member(next,0).pokemon).moveset.some(m=>m.moveId===learnable[4]));
 assert.equal(next.decision.players[0].ready,true);
});

test('fusion survives formal disk failure, host restart, model ACK and same-action replay without consuming twice',async()=>{
 const c=copy(base),item=option(c,'DNA_SPLICERS'),source=member(c,0).pokemon.fields.id,donor=member(c,0,1).pokemon.fields.id;
 const action={...reward(item,source),fusionId:donor},expected=await act(c,0,action);
 await mkdir('build/code-review/original-item-ws',{recursive:true});const directory=await mkdtemp(resolve('build/code-review/original-item-ws/run-'));
 const baseStore=new FormalRoomStore(directory);let fail=true;
 const store={load:()=>baseStore.load(),save:room=>{if(fail&&room.revision===1)throw Error('injected item commit failure');return baseStore.save(room);}};
 let env=await openPreparationRoom({api,checkpoint:c,store});
 try{
  let pair=env.pair;const tokens=pair.map(p=>p.identity),roomId=tokens[0].roomId,input=request(pair[0],action);
  pair[0].send(input);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===input.actionId)).accepted,true);
  await pair[0].wait(m=>m.type==='syncStatus'&&m.reason==='STORAGE_FAILED');
  assert.deepEqual(env.server.rooms.get(roomId).checkpoint.nativeCheckpoint,c);
  await env.close();fail=false;env=await openPreparationRoom({api,checkpoint:c,store:new FormalRoomStore(directory),old:tokens});pair=env.pair;
  await until(()=>pair.every(p=>p.ready&&p.latest.revision===1),'fusion recovered and model applied');
  const committed=copy(env.server.rooms.get(roomId).checkpoint);assert.deepEqual(committed.nativeCheckpoint,expected.checkpoint);
  pair[0].send(input);assert.equal((await pair[0].wait(m=>m.type==='actionReceipt'&&m.actionId===input.actionId)).accepted,true);
  assert.deepEqual(env.server.rooms.get(roomId).checkpoint,committed);
 }finally{await env.close();}
});

test('original interest and damage money credit only the owning seat',async()=>{
 let c=copy(route.c);c.battle.waveIndex=10;c.players[0].money=1000;c.players[1].money=2000;attach(c,0,typeFor('COIN_CASE').newModifier());
 for(let n=0;n<20&&c.decision.kind!=='wait-actions';n++)c=(await progressDefault(route.h,c)).checkpoint;
 assert.equal(c.battle.waveIndex,11);assert.equal(c.players[0].money,1100);assert.equal(c.players[1].money,2000);
 c=copy(route.initial);const owner=api.restorePokemonState(member(c,0).pokemon);attach(c,0,typeFor('GOLDEN_PUNCH').newModifier(owner));
 const before=c.players.map(p=>p.money),turn=c.battle.turn;
 for(let n=0;n<30;n++){c=(await progressDefault(route.h,c)).checkpoint;if(c.battle.turn>turn)break;}
 assert.ok(c.players[0].money>before[0]);assert.equal(c.players[1].money,before[1]);
});
