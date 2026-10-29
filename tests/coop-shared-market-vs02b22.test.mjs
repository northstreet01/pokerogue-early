import test,{before} from 'node:test';
import {createRequire} from 'node:module';
import {openPreparationRoom,request,until} from './helpers/native-preparation-ws.mjs';
import assert from 'node:assert/strict';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {defaultTrainerRoute,progressDefault} from './helpers/native-default-trainer.mjs';
let route,initial;
before(async()=>{
 await buildCoopRuntime();route=await defaultTrainerRoute();let c=route.initial;
 for(let n=0;n<100;n++){
  const front=(c.continuation.phaseQueuePrepend.at(-1)??c.continuation.phaseQueue[0])?.phase.type;
  if(c.decision.kind==='continuing'&&front==='SelectModifierPhase'){initial=c;return;}
  c=(await progressDefault(route.h,c)).checkpoint;
 }
 assert.fail('natural first victory must queue original reward phase');
});
test.after(async()=>route?.h.close());
const skip=(checkpoint,seat)=>route.h.request('native-prepare-action',{checkpoint,seat,action:{kind:'preparation',operation:'skip-reward'}});
const open=async()=> (await route.h.request('native-preparation-shared',initial)).checkpoint;
const act=(checkpoint,seat,action)=>route.h.request('native-prepare-action',{checkpoint,seat,action});
const member=(c,seat)=>c.roster.entries.find(e=>e.owner===seat&&e.group==='party'&&e.index===0).pokemon.fields;
test('one original shared draw restores two owned menus and explicit skips automatically complete once',async()=>{
 let c=(await route.h.request('native-preparation-shared',initial)).checkpoint;
 assert.equal(c.decision.shared.version,1);assert.deepEqual(c.decision.players[0].rewards,c.decision.players[1].rewards);
 assert.deepEqual(c.decision.players[0].shop,c.decision.players[1].shop);
 c=(await skip(c,0)).checkpoint;assert.equal(c.decision.players[0].ready,true);
 await assert.rejects(()=>skip(c,0),/PREPARATION_ALREADY_FINISHED/);
 c=(await skip(c,1)).checkpoint;assert.equal(c.decision.kind,'continuing');assert.equal(c.decision.reason,'next-battle');
 assert.deepEqual(c.pendingEffects,[]);
});

test('original paid callback charges only purchaser, keeps one shared stock and rejects a second buyer',async()=>{
 let c=await open();const shop=c.decision.players[0].shop;
 const option=shop.find(o=>o.type.catalogId==='POTION');assert.ok(option);
 const buyer=[0,1].find(seat=>member(c,seat).hp>0&&member(c,seat).hp<member(c,seat).stats[0]);assert.notEqual(buyer,undefined);
 const original=structuredClone(c),target=member(c,buyer);
 const action={kind:'preparation',operation:'buy',optionId:option.id,pokemonId:target.id,moveIndex:null,fusionId:null};
 c=(await act(c,buyer,action)).checkpoint;
 assert.equal(c.players[buyer].money,original.players[buyer].money-option.cost);
 assert.deepEqual(c.players[1-buyer],original.players[1-buyer]);
 assert.ok(member(c,buyer).hp>target.hp);
 assert.deepEqual(c.decision.shared.shopClaims,[{optionId:option.id,seat:buyer}]);
 assert.deepEqual(c.decision.players[0].shop,shop);assert.deepEqual(c.decision.players[1].shop,shop);
 await assert.rejects(()=>act(structuredClone(c),1-buyer,{...action,pokemonId:member(c,1-buyer).id}),/SHARED_ITEM_UNAVAILABLE/);
 assert.equal(original.decision.shared.shopClaims.length,0);
});

test('shared original reroll pays original price once, copies one draw, and never replenishes paid stock',async()=>{
 let c=await open();const shop=structuredClone(c.decision.players[0].shop),cost=c.decision.players[0].rerollCost;
 const money=c.players.map(p=>p.money);
 c=(await act(c,1,{kind:'preparation',operation:'reroll'})).checkpoint;
 assert.equal(c.players[0].money,money[0]);assert.equal(c.players[1].money,money[1]-cost);
 assert.equal(c.decision.players[0].rerollCount,1);
 for(const key of ['rewards','rerollCost','rerollCount'])assert.deepEqual(c.decision.players[0][key],c.decision.players[1][key]);
 assert.deepEqual(c.decision.players[0].shop,shop);assert.deepEqual(c.decision.players[1].shop,shop);
 c=(await skip(c,0)).checkpoint;
 await assert.rejects(()=>act(c,1,{kind:'preparation',operation:'reroll'}),/SHARED_REWARD_POOL_LOCKED/);
 await assert.rejects(()=>act(c,1,{kind:'preparation',operation:'ready'}),/PREPARATION_AUTOMATIC_COMPLETION/);
});

test('free shared reward is claimed once and auto finishes only its recipient',async()=>{
 let c=await open();
 const option=c.decision.players[0].rewards.find(o=>['POKEBALL','GREAT_BALL','ULTRA_BALL','NUGGET','BIG_NUGGET'].includes(o.type.catalogId));
 assert.ok(option,JSON.stringify(c.decision.players[0].rewards.map(o=>o.type.catalogId)));
 const action={kind:'preparation',operation:'reward',optionId:option.id,pokemonId:null,moveIndex:null,fusionId:null};
 c=(await act(c,0,action)).checkpoint;
 assert.deepEqual(c.decision.shared.rewardClaims,[{optionId:option.id,seat:0}]);
 assert.equal(c.decision.players[0].ready,true);assert.equal(c.decision.players[1].ready,false);
 await assert.rejects(()=>act(c,1,action),/SHARED_ITEM_UNAVAILABLE/);
 const projected=await route.h.request('native-project',{checkpoint:c,seat:1});
 assert.deepEqual(projected.personal.decision.sharedMarket.finished,[true,false]);
 assert.equal(projected.personal.decision.sharedMarket.rerollLocked,true);
 assert.equal(projected.personal.decision.players.rewardResolved,false);
});

test('targeted item reservation survives restore, blocks peer and reroll, cancels without payment, then applies once',async()=>{
 let c=await open();const option=c.decision.players[0].shop.find(o=>o.type.catalogId==='POTION');assert.ok(option);
 const buyer=[0,1].find(seat=>member(c,seat).hp>0&&member(c,seat).hp<member(c,seat).stats[0]);assert.notEqual(buyer,undefined);
 const reserve={kind:'preparation',operation:'reserve-item',optionId:option.id},money=c.players.map(p=>p.money);
 c=(await act(c,buyer,reserve)).checkpoint;
 assert.deepEqual(c.players.map(p=>p.money),money);
 c=JSON.parse(JSON.stringify(c));
 const projected=await route.h.request('native-project',{checkpoint:c,seat:1-buyer});
 assert.deepEqual(projected.personal.decision.sharedMarket.reservations,[{optionId:option.id,seat:buyer}]);
 assert.equal(projected.shared.activities[buyer],'item-target');
 await assert.rejects(()=>act(c,1-buyer,reserve),/SHARED_ITEM_UNAVAILABLE/);
 await assert.rejects(()=>act(c,1-buyer,{kind:'preparation',operation:'reroll'}),/SHARED_REWARD_POOL_LOCKED/);
 c=(await act(c,buyer,{kind:'preparation',operation:'cancel-selection'})).checkpoint;
 assert.equal(c.decision.players[buyer].selection,null);assert.deepEqual(c.players.map(p=>p.money),money);
 c=(await act(c,buyer,reserve)).checkpoint;
 c=(await act(c,buyer,{kind:'preparation',operation:'buy',optionId:option.id,pokemonId:member(c,buyer).id,moveIndex:null,fusionId:null})).checkpoint;
 assert.equal(c.decision.players[buyer].selection,null);
 assert.equal(c.players[buyer].money,money[buyer]-option.cost);
 assert.deepEqual(c.decision.shared.shopClaims,[{optionId:option.id,seat:buyer}]);
});


test('remote both players use separate shared candies and retain independent original growth through restore',async()=>{
 let c=await open();const api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
 const type=api.captureModifierTypeState(api.modifierTypes.RARE_CANDY().withIdFromFunc(api.modifierTypes.RARE_CANDY));
 for(const player of c.decision.players)player.rewards=[0,1].map(i=>({id:'candy-'+i,type:structuredClone(type),cost:0}));
 const levels=[0,1].map(seat=>member(c,seat).level);
 for(const seat of [0,1]){
 c=(await act(JSON.parse(JSON.stringify(c)),seat,{kind:'preparation',operation:'reward',optionId:'candy-'+seat,pokemonId:member(c,seat).id,moveIndex:null,fusionId:null})).checkpoint;
 }
 assert.deepEqual([0,1].map(seat=>member(c,seat).level),levels.map(n=>n+1));
 if(c.decision.kind==='preparation')assert.equal(c.decision.shared.rewardClaims.length,2);
 else assert.equal(c.decision.reason,'next-battle');
});
test('remote concurrent claim accepts only one owner, rejects the stale peer, then lets the peer finish and advance',async()=>{
 const c=await open(),api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
 const env=await openPreparationRoom({api,checkpoint:c,stage:'preparation',provisioning:{seed:'learning-natural-2',identities:route.profiles.map(p=>p.trainer),sharedPreparation:true}});
 try{const pair=env.pair;const option=pair[0].latest.personal.decision.players.rewards.find(o=>['POKEBALL','GREAT_BALL','ULTRA_BALL','NUGGET','BIG_NUGGET'].includes(o.type.catalogId));assert.ok(option);
 const a={kind:'preparation',operation:'reward',optionId:option.id,pokemonId:null,moveIndex:null,fusionId:null};
 const messages=pair.map(client=>request(client,a));pair.forEach((client,i)=>client.send(messages[i]));
 const receipts=await Promise.all(pair.map((client,i)=>client.wait(m=>m.type==='actionReceipt'&&m.actionId===messages[i].actionId)));
 assert.equal(receipts.filter(r=>r.accepted).length,1);assert.ok(['STALE_DECISION','SYNC_BLOCKED','SHARED_ITEM_UNAVAILABLE'].includes(receipts.find(r=>!r.accepted).code));
 await until(()=>pair.every(p=>p.ready&&p.latest.revision>0),'both models recovered after contested stock');
 assert.deepEqual(env.failures,[]);const loser=receipts.findIndex(r=>!r.accepted),message=request(pair[loser],{kind:'preparation',operation:'skip-reward'});pair[loser].send(message);
 assert.equal((await pair[loser].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId)).accepted,true);
 await until(()=>pair.every(p=>p.ready&&p.latest.shared.waveIndex===2),'next encounter after peer recovery');assert.deepEqual(env.failures,[]);
 }finally{await env.close();}
});
