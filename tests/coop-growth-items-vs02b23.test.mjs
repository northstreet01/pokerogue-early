import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {originalPreparationFixture,growthItemFixture,member,reward} from './helpers/growth-items-fixture.mjs';
let api,route,base;
before(async()=>{await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();const fixture=await originalPreparationFixture();route=fixture.route;base=fixture.base;});
after(async()=>route?.h.close());
const copy=x=>structuredClone(x),itemFixture=(kind,seat)=>growthItemFixture(api,base,kind,seat);
const act=(c,seat,action)=>route.h.request('native-prepare-action',{checkpoint:c,seat,action});

test('original generated TM callback learns on the own target, claims once and protects the partner',async()=>{
 const {c,option,id,type}=itemFixture('TM_COMMON'),before=copy(c);
 await route.h.request('native-validate-preparation',{checkpoint:c,seat:0,action:reward(option,id)});
 let r=await act(c,0,reward(option,id));
 assert.equal(r.checkpoint.decision.players[0].subdecision.kind,'learn-move');
 assert.equal(r.checkpoint.decision.players[0].ready,false);
 const learning=r.checkpoint.decision.players[0].subdecision;
 r=await act(copy(r.checkpoint),0,learning.options[0].find(o=>o.slot===0));
 const p=member(r.checkpoint,0).pokemon.fields;
 assert.ok(p.moveset.some(m=>m.fields.moveId===type.moveId));
 assert.deepEqual(member(r.checkpoint,1),member(before,1));assert.deepEqual(r.checkpoint.players,before.players);
 assert.equal(r.checkpoint.decision.players[0].ready,true);
 assert.deepEqual(r.checkpoint.decision.shared.rewardClaims,[{optionId:option.id,seat:0}]);
 await assert.rejects(()=>act(r.checkpoint,0,reward(option,id)),/PREPARATION_ALREADY_FINISHED/);
 assert.deepEqual(c,before);
});

test('original evolution-item callback suspends, restores and evolves using the original choice exactly once',async()=>{
 const {c,option,id}=itemFixture('EVOLUTION_ITEM',1),before=copy(c);
 let r=await act(c,1,reward(option,id)),next=r.checkpoint;
 assert.equal(next.decision.players[1].subdecision.kind,'evolution');assert.equal(next.decision.players[1].ready,false);
 assert.equal(member(next,1).pokemon.fields.species,133);
 r=await act(copy(next),1,{kind:'evolution',pokemonId:id,choice:'evolve'});next=r.checkpoint;
 assert.equal(member(next,1).pokemon.fields.species,136);assert.deepEqual(member(next,0),member(before,0));
 assert.ok(r.events.some(e=>e.kind==='evolution-display'&&e.scope===1));
 assert.ok(r.intents.some(e=>e.kind==='evolution-pending'));
});

test('TM decline consumes the selected reward once but does not replace any move',async()=>{
 const {c,option,id}=itemFixture('TM_COMMON'),moves=copy(member(c,0).pokemon.fields.moveset);
 let next=(await act(c,0,reward(option,id))).checkpoint;
 const choice=next.decision.players[0].subdecision.options[0].find(o=>o.slot===null);
 next=(await act(copy(next),0,choice)).checkpoint;
 assert.deepEqual(member(next,0).pokemon.fields.moveset,moves);assert.equal(next.decision.players[0].ready,true);
 assert.equal(next.decision.shared.rewardClaims.length,1);
});

test('evolution item cancellation and pause restore without evolution, then original party unpause changes only its flag',async()=>{
 const {c,option,id}=itemFixture('EVOLUTION_ITEM');
 let next=(await act(c,0,reward(option,id))).checkpoint;
 next=(await act(copy(next),0,{kind:'evolution',pokemonId:id,choice:'cancel'})).checkpoint;
 next=(await act(copy(next),0,{kind:'evolution',pokemonId:id,choice:'pause'})).checkpoint;
 assert.equal(member(next,0).pokemon.fields.species,133);assert.equal(member(next,0).pokemon.fields.pauseEvolutions,true);
 assert.equal(next.decision.players[0].ready,true);
 const before=copy(next),action={kind:'preparation',operation:'unpause-evolution',pokemonId:id};
 await route.h.request('native-validate-preparation',{checkpoint:next,seat:0,action});assert.deepEqual(next,before);
 const r=await act(copy(next),0,action);next=r.checkpoint;
 assert.equal(member(next,0).pokemon.fields.pauseEvolutions,false);assert.equal(next.decision.players[0].ready,true);
 const expected=copy(before);member(expected,0).pokemon.fields.pauseEvolutions=false;expected.decision.id=next.decision.id;
 assert.deepEqual(next,expected);assert.ok(r.events.some(e=>e.kind==='message'&&e.scope===0));
 await assert.rejects(()=>act(next,0,action),/INVALID_EVOLUTION_RESUME/);
 await assert.rejects(()=>act(before,1,action),/INVALID_PREPARATION_OWNER/);
 await assert.rejects(()=>act(before,0,{...action,ignorePP:true}),/INVALID_SAFE_DECISION/);
});

test('foreign and incompatible TM or evolution targets are rejected without taking shared stock',async()=>{
 for(const kind of ['TM_COMMON','EVOLUTION_ITEM']){
  const {c,option,id}=itemFixture(kind),before=copy(c);
  await assert.rejects(()=>act(c,1,reward(option,id)),/INVALID_PREPARATION_OWNER/);
  const target=member(c,0),runtime=api.createOriginalRuntime(c.scene.seed,{trainerId:1,secretId:2});
  const wrong=api.constructOriginalPokemon(runtime,129,5);wrong.id=id;target.pokemon=api.capturePokemonState(wrong);
  await assert.rejects(()=>act(c,0,reward(option,id)),/INVALID_PREPARATION_TARGET/);
  assert.deepEqual(c.decision.shared,before.decision.shared);
 }
});

test('two original TM learning choices coexist and partner shopping never replaces the other suspended phase',async()=>{
 const first=itemFixture('TM_COMMON',0),second=itemFixture('TM_COMMON',1),c=first.c;
 member(c,1).pokemon=copy(member(second.c,1).pokemon);
 const other={...copy(second.option),id:'fixture-second'};
 for(const row of c.decision.players)row.rewards.push(copy(other));
 let next=(await act(c,0,reward(first.option,first.id))).checkpoint;
 const phase=copy(next.pendingEffects.find(e=>e.id.startsWith('preparation-growth-0-'))),learn=copy(next.decision.players[0].subdecision);
 next=(await act(copy(next),1,reward(other,second.id))).checkpoint;
 assert.deepEqual(next.pendingEffects.find(e=>e.id.startsWith('preparation-growth-0-')),phase);
 assert.deepEqual(next.decision.players[0].subdecision,learn);assert.equal(next.decision.players[1].subdecision.kind,'learn-move');
 for(const seat of [1,0]){const d=next.decision.players[seat].subdecision;next=(await act(copy(next),seat,d.options[seat].find(o=>o.slot===0))).checkpoint;}
 assert.equal(next.decision.kind,'continuing');assert.equal(next.decision.reason,'next-battle');
 assert.ok(member(next,0).pokemon.fields.moveset.some(m=>m.fields.moveId===first.type.moveId));
 assert.ok(member(next,1).pokemon.fields.moveset.some(m=>m.fields.moveId===second.type.moveId));
});

test('original TM with an empty move slot needs no replacement confirmation',async()=>{
 const {c,option,id,type}=itemFixture('TM_COMMON'),p=api.restorePokemonState(member(c,0).pokemon);p.moveset=p.moveset.slice(0,2);member(c,0).pokemon=api.capturePokemonState(p);
 const next=(await act(c,0,reward(option,id))).checkpoint;
 assert.equal(next.decision.players[0].subdecision,null);assert.equal(next.decision.players[0].ready,true);
 assert.ok(member(next,0).pokemon.fields.moveset.some(m=>m.fields.moveId===type.moveId));
});

test('resuming an original paused Caterpie allows Rare Candy to run its level-seven evolution queue',async()=>{
 const c=copy(base),runtime=api.createOriginalRuntime(c.scene.seed,{trainerId:1,secretId:2}),entry=member(c,0),p=api.constructOriginalPokemon(runtime,10,6);p.id=entry.pokemon.fields.id;p.pauseEvolutions=true;entry.pokemon=api.capturePokemonState(p);
 const option={id:'candy-after-resume',type:api.captureModifierTypeState(api.modifierTypes.RARE_CANDY().withIdFromFunc(api.modifierTypes.RARE_CANDY)),cost:0};for(const row of c.decision.players)row.rewards=[copy(option)];
 const action={kind:'preparation',operation:'unpause-evolution',pokemonId:p.id};
 let next=(await act(c,0,action)).checkpoint;next=(await act(next,0,reward(option,p.id))).checkpoint;
 for(let n=0;n<10&&next.decision.players[0].subdecision?.kind==='learn-move';n++){const d=next.decision.players[0].subdecision;next=(await act(next,0,d.options[0].find(o=>o.slot===null))).checkpoint;}
 assert.equal(next.decision.players[0].subdecision?.kind,'evolution');
 next=(await act(copy(next),0,{kind:'evolution',pokemonId:p.id,choice:'evolve'})).checkpoint;
 assert.equal(member(next,0).pokemon.fields.level,7);assert.equal(member(next,0).pokemon.fields.species,11);
});

test('legacy personal preparation admits TM without changing its manual ready policy',async()=>{
 const {c,option,id}=itemFixture('TM_COMMON');delete c.decision.shared;
 let next=(await act(c,0,reward(option,id))).checkpoint;const d=next.decision.players[0].subdecision;
 next=(await act(copy(next),0,d.options[0].find(o=>o.slot===null))).checkpoint;
 assert.equal(next.decision.players[0].rewardResolved,true);assert.equal(next.decision.players[0].ready,false);
 assert.equal(next.decision.kind,'preparation');
});

test('naturally drawn TM after two affordable original rerolls learns through the real reward callback',async()=>{
 let c=copy(base);
 for(let n=0;n<2;n++)c=(await act(c,0,{kind:'preparation',operation:'reroll'})).checkpoint;
 assert.equal(c.players[0].money,250,'original 250 + 500 reroll charges from the real starting 1000');
 const option=c.decision.players[0].rewards.find(o=>o.type.recipe==='tm');assert.ok(option,'unchanged original seed draws a TM');
 let target;
 for(const entry of c.roster.entries.filter(e=>e.owner!==null&&e.group==='party')){
  try{await route.h.request('native-validate-preparation',{checkpoint:c,seat:entry.owner,action:reward(option,entry.pokemon.fields.id)});target=entry;break;}
  catch(error){assert.match(error.code,/INVALID_PREPARATION_TARGET/);}
 }
 assert.ok(target);const seat=target.owner,id=target.pokemon.fields.id,peer=copy(c.roster.entries.filter(e=>e.owner===1-seat));
 c=(await act(copy(c),seat,reward(option,id))).checkpoint;
 for(let n=0;n<5&&c.decision.players[seat].subdecision;n++){const d=c.decision.players[seat].subdecision;assert.equal(d.kind,'learn-move');c=(await act(copy(c),seat,d.options[seat].find(o=>o.slot===0))).checkpoint;}
 assert.ok(c.roster.entries.find(e=>e.pokemon.fields.id===id).pokemon.fields.moveset.some(m=>m.fields.moveId===option.type.args[0]));
 assert.deepEqual(c.roster.entries.filter(e=>e.owner===1-seat),peer);assert.equal(c.decision.players[seat].ready,true);
});
