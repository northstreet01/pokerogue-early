import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {originalPreparationFixture,member,reward} from './helpers/growth-items-fixture.mjs';
import {progressDefault} from './helpers/native-default-trainer.mjs';
import {openPreparationRoom,request,until,advance,raw} from './helpers/native-preparation-ws.mjs';
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

// Explicit original-catalog fixtures, not natural item drops or player saves.
function formFixture(source=base,{species=6,item=14,index=0,active=false}={}){
 const c=copy(source),runtime=api.createOriginalRuntime(c.scene.seed,{trainerId:1,secretId:2}),entry=member(c,0,index);
 const p=api.constructOriginalPokemon(runtime,species,5);p.id=entry.pokemon.fields.id;p.resetSummonData();p.resetTurnData();entry.pokemon=api.capturePokemonState(p);
 const factory=api.modifierTypes.FORM_CHANGE_ITEM,type=factory().withIdFromFunc(factory).generateType([p],[item]);
 const modifier=type.newModifier(p);modifier.active=active;attach(c,0,modifier);
 return {c,id:p.id,item,action:{kind:'form-toggle',pokemonId:p.id,item,active:!active}};
}

test('owned form toggles use original phases, preserve resources and restore Mega/Gmax after disabling',async()=>{
 for(const item of [14,57])for(const index of [0,1]){
  let {c,action}=formFixture(base,{item,index}),before=copy(c);
  const changed=await act(c,0,action);c=changed.checkpoint;
  assert.match(api.restorePokemonState(member(c,0,index).pokemon).getFormKey(),item===14?/mega-x/:/gigantamax/);
  assert.deepEqual(c.decision.players,before.decision.players);assert.deepEqual(c.decision.shared,before.decision.shared);
  for(const key of ['sceneRandom','battle','eggState','continuation'])assert.deepEqual(c[key],before[key],key);
  assert.deepEqual(c.players,before.players);assert.deepEqual(member(c,1),member(before,1));
  assert.equal(modifiers(c,0).find(m=>m.formChangeItem===item).active,true);
  assert.ok(changed.events.some(e=>e.kind==='form-change'&&e.pokemonId===action.pokemonId));
  assert.ok(changed.intents.some(e=>e.kind==='evolution-pending'&&e.owner===0));
  await route.h.request('native-validate-checkpoint',c);
  const restored=(await act(JSON.parse(JSON.stringify(c)),0,{...action,active:false})).checkpoint;
  assert.equal(member(restored,0,index).pokemon.fields.formIndex,0);
  assert.deepEqual(member(restored,0,index).pokemon.fields.moveset,member(before,0,index).pokemon.fields.moveset);
  assert.deepEqual(c,changed.checkpoint);assert.deepEqual(before,formFixture(base,{item,index}).c);
 }
});

test('form toggle rejects foreign, stale, unavailable and selected-item requests without changing its source',async()=>{
 const {c,action}=formFixture(),before=copy(c);
 for(const bad of [{...action,pokemonId:member(c,1).pokemon.fields.id},{...action,item:15},{...action,active:false},{...action,item:-1},{...action,extra:true}])
  await assert.rejects(()=>act(c,0,bad),/INVALID_FORM|STALE_FORM/);
 assert.deepEqual(c,before);
 const next=(await act(c,0,action)).checkpoint;
 await assert.rejects(()=>act(next,0,action),/STALE_FORM_ITEM/);
 // Another held form item is invisible until the active one is disabled.
 const runtime=api.createOriginalRuntime(c.scene.seed,{trainerId:1,secretId:2}),p=api.restorePokemonState(member(next,0).pokemon);p.scene=runtime.scene;
 const f=api.modifierTypes.FORM_CHANGE_ITEM,other=f().withIdFromFunc(f).generateType([p],[15]).newModifier(p);other.active=false;attach(next,0,other);
 await assert.rejects(()=>act(next,0,{...action,item:15}),/STALE_FORM_ITEM/);
 const off=(await act(next,0,{...action,active:false})).checkpoint;
 const y=(await act(off,0,{...action,item:15})).checkpoint;
 assert.match(api.restorePokemonState(member(y,0).pokemon).getFormKey(),/mega-y/);
});

test('Rayquaza item alone cannot bypass the original Dragon Ascent condition',async()=>{
 const {c,action}=formFixture(base,{species:384,item:38});
 const r=await act(c,0,action);
 assert.equal(member(r.checkpoint,0).pokemon.fields.formIndex,0);
 assert.equal(r.events.some(e=>e.kind==='form-change'),false);
 assert.equal(modifiers(r.checkpoint,0).find(m=>m.formChangeItem===38).active,true);
 const learned=copy(c),p=api.restorePokemonState(member(learned,0).pokemon);
 p.moveset=[new p.moveset[0].constructor(620)];member(learned,0).pokemon=api.capturePokemonState(p);
 const transformed=await act(learned,0,action);
 assert.match(api.restorePokemonState(member(transformed.checkpoint,0).pokemon).getFormKey(),/mega/);
});

test('Gigantamax Toxtricity returns to its nature form and learned Secret Sword changes Keldeo without an evolution prompt',async()=>{
 for(const nature of [0,1]){
  const {c,action}=formFixture(base,{species:849,item:57}),p=api.restorePokemonState(member(c,0).pokemon);
  p.nature=nature;p.formIndex=nature===1?1:0;member(c,0).pokemon=api.capturePokemonState(p);
  const changed=(await act(c,0,action)).checkpoint;
  assert.match(api.restorePokemonState(member(changed,0).pokemon).getFormKey(),/gigantamax/);
  const restored=(await act(changed,0,{...action,active:false})).checkpoint;
  assert.equal(member(restored,0).pokemon.fields.formIndex,nature===1?1:0);
 }
 const c=copy(base),runtime=api.createOriginalRuntime(c.scene.seed,{trainerId:1,secretId:2}),p=api.constructOriginalPokemon(runtime,647,5);
 p.id=member(c,0).pokemon.fields.id;p.moveset=[];member(c,0).pokemon=api.capturePokemonState(p);
 const item=option(c,'MEMORY_MUSHROOM'),moveIndex=p.getLearnableLevelMoves().indexOf(548);assert.ok(moveIndex>=0);
 const result=await act(c,0,{...reward(item,p.id),moveIndex});
 assert.equal(api.restorePokemonState(member(result.checkpoint,0).pokemon).getFormKey(),'resolute');
 assert.equal(result.checkpoint.decision.players[0].subdecision,null);
 assert.ok(result.events.some(e=>e.kind==='form-change'));
 await route.h.request('native-validate-checkpoint',result.checkpoint);
});

test('battle form updates commit immediately, clear earlier peer choices and survive failed disk writes/restart/replay',async()=>{
 const {c,action}=formFixture(route.initial),expected=await act(c,0,action);
 await mkdir('build/code-review/form-ws',{recursive:true});const directory=await mkdtemp(resolve('build/code-review/form-ws/run-'));
 const disk=new FormalRoomStore(directory);let fail=true;
 const store={load:()=>disk.load(),save:room=>{if(fail&&room.revision===1)throw Error('injected form write failure');return disk.save(room);}};
 let env=await openPreparationRoom({api,checkpoint:c,store,stage:'battle'});
 try{
  let pair=env.pair;const tokens=pair.map(p=>p.identity),roomId=tokens[0].roomId;
  const prior=await raw(pair[1],pair[1].latest.personal.decision.options.find(o=>o.kind==='fight'));
  const input=await raw(pair[0],action);
  await pair[0].wait(m=>m.type==='syncStatus'&&m.reason==='STORAGE_FAILED');
  assert.deepEqual(env.server.rooms.get(roomId).checkpoint.nativeCheckpoint,c);
  await env.close();fail=false;env=await openPreparationRoom({api,checkpoint:c,store:new FormalRoomStore(directory),old:tokens,stage:'battle'});pair=env.pair;
  await until(()=>pair.every(p=>p.ready&&p.latest.revision===1),'immediate form after durable retry');
  const saved=copy(env.server.rooms.get(roomId));assert.deepEqual(saved.checkpoint.nativeCheckpoint,expected.checkpoint);
  assert.deepEqual(saved.inputs,{});assert.equal(saved.checkpoint.nativeCheckpoint.battle.turn,c.battle.turn);
  assert.ok(saved.events.some(e=>e.presentation?.key==='coop:formToggleBattleSaved'));
  for(const [seat,message] of [[0,input],[1,prior]]){
   pair[seat].send(message);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId)).accepted,true);
   assert.deepEqual(env.server.rooms.get(roomId).checkpoint,saved.checkpoint);
  }
  await advance(pair,0,{...action,active:false});
  assert.equal(member(env.server.rooms.get(roomId).checkpoint.nativeCheckpoint,0).pokemon.fields.formIndex,0);
 }finally{await env.close();}
});

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
