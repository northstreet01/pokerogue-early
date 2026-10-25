import {forcedCommandFixture} from './helpers/native-forced-command.mjs';
import test,{before}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{buildCoopRuntime}from'../scripts/build-coop-runtime.mjs';import{createOriginalRuleHost}from'../server/original-rule-host.mjs';
let api;before(async()=>{await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();});
const clone=x=>JSON.parse(JSON.stringify(x));
const fixture=(queues,moves)=>forcedCommandFixture(api,queues,moves);
const field=(c,seat)=>c.roster.entries.find(e=>e.pokemon.fields.id===c.roster.field[seat]).pokemon.fields;
const fight=(c,seat)=>c.decision.options[seat].find(o=>o.kind==='fight'&&(o.target===null||o.target>=2));
async function drive(h,c){const events=[];for(let n=0;n<100&&c.decision.kind==='continuing';n++){const r=await h.request('native-step',clone(c));events.push(...r.events);c=r.checkpoint;}return{c,events};}
for(const seat of[0,1])test('only the manual partner supplies input when recharge belongs to seat '+seat,async()=>{
 const{h,c}=await fixture({[seat]:[{move:0,targets:[]}]});try{
 let next=(await h.request('native-step',c)).checkpoint;assert.deepEqual(next.decision.requiredSeats,[1-seat]);assert.equal(field(next,seat).summonData.fields.moveQueue.length,1);
 const ownPP=clone(field(next,seat).moveset);const before=clone(next);await h.request('native-project',{checkpoint:next,seat});const action=fight(next,1-seat);assert.ok(action);await h.request('native-validate',{checkpoint:next,seat:1-seat,action});assert.deepEqual(next,before);
 await assert.rejects(h.request('native-validate',{checkpoint:next,seat,action:{...action,pokemonId:field(next,seat).id}}));
 const r=await h.request('native-submit',{checkpoint:next,inputs:{[1-seat]:action}});assert.equal(r.checkpoint.battle.turnCommands[seat].object.cursor.value,-1);
 const done=await drive(h,r.checkpoint);assert.equal(done.c.decision.kind,'wait-actions');assert.ok(!field(done.c,seat).summonData.fields.moveQueue.length);assert.deepEqual(field(done.c,seat).moveset,ownPP);
 assert.ok(done.events.some(e=>e.kind==='phase-start'&&e.phase==='TurnStartPhase'));
 }finally{await h.close();}
});
test('both recharge turns execute original commands without an empty-seat waiting decision',async()=>{
 const{h,c}=await fixture({0:[{move:0,targets:[]}],1:[{move:0,targets:[]}]});try{
 const start=(await h.request('native-step',c)).checkpoint;assert.equal(start.decision.kind,'continuing');
 const done=await drive(h,start);assert.equal(done.c.decision.kind,'wait-actions');assert.deepEqual(done.c.decision.requiredSeats,[0,1]);
 assert.equal(done.events.filter(e=>e.kind==='phase-start'&&e.phase==='CommandPhase').length,2);
 for(const seat of[0,1])assert.equal(field(done.c,seat).summonData.fields.moveQueue.length,0);
 }finally{await h.close();}
});
test('original unusable queue head is pruned before manual options, without executing or charging PP',async()=>{
 const{h,c}=await fixture({0:[{move:165,targets:[2]}]});try{const before=clone(field(c,0).moveset);const next=(await h.request('native-step',c)).checkpoint;
 assert.deepEqual(next.decision.requiredSeats,[0,1]);assert.equal(field(next,0).summonData.fields.moveQueue.length,0);assert.deepEqual(field(next,0).moveset,before);
 }finally{await h.close();}
});
test('a previously rejected entry seed runs original ability and stat phases before player input',async()=>{
 const h=await createOriginalRuleHost({seed:'remote-teleport-regression',identity:{trainerId:1,secretId:2}});try{
 const r=await h.request('native-open-to-input',{parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}});assert.equal(r.checkpoint.decision.kind,'wait-actions');
 for(const phase of['ShowAbilityPhase','StatChangePhase','TurnInitPhase'])assert.ok(r.events.some(e=>e.kind==='phase-start'&&e.phase===phase));
 }finally{await h.close();}
});


for(const autoSeat of[0,1])test('charged original move restores target stop and preserves partner input, seat '+autoSeat,async()=>{
 const{h,c}=await fixture({[autoSeat]:[{move:130,targets:[2],ignorePP:true}]},{[autoSeat]:130});try{
 let next=(await h.request('native-step',c)).checkpoint;assert.deepEqual(next.decision.requiredSeats,[1-autoSeat]);
 const partner=fight(next,1-autoSeat),pp=field(next,1-autoSeat).moveset[partner.cursor].fields.ppUsed;
 next=(await h.request('native-submit',{checkpoint:next,inputs:{[1-autoSeat]:partner}})).checkpoint;
 assert.equal(next.decision.kind,'wait-target');assert.deepEqual(next.decision.requiredSeats,[autoSeat]);
 const saved=clone(next);for(const seat of[0,1]){const view=await h.request('native-project',{checkpoint:saved,seat});assert.equal(JSON.stringify(view.shared).includes('nativeIntent'),false);}
 const choice=next.decision.options[autoSeat].find(o=>o.target>=2);assert.ok(choice);
 const resolved=await h.request('native-submit',{checkpoint:clone(next),inputs:{[autoSeat]:choice}});
 assert.equal(resolved.checkpoint.decision.kind,'continuing');
 assert.equal(resolved.checkpoint.battle.turnCommands[1-autoSeat].object.cursor.value,partner.cursor);
 const done=await drive(h,resolved.checkpoint);assert.equal(done.c.decision.kind,'wait-actions');
 assert.equal(field(done.c,autoSeat).moveset[0].fields.ppUsed,1,'charged follow-up preserves original ignorePP');
 assert.equal(field(done.c,1-autoSeat).moveset[partner.cursor].fields.ppUsed,pp+1,'partner command executes once');
 assert.deepEqual(saved,next);
 }finally{await h.close();}
});
test('cancelled forced target creates a fresh owned target stop without replaying partner choice',async()=>{
 const{h,c}=await fixture({0:[{move:130,targets:[2],ignorePP:true}]},{0:130});try{
 let next=(await h.request('native-step',c)).checkpoint;const partner=fight(next,1);next=(await h.request('native-submit',{checkpoint:next,inputs:{1:partner}})).checkpoint;
 const cancel=next.decision.options[0].find(o=>o.target===-1);assert.ok(cancel);
 next=(await h.request('native-submit',{checkpoint:clone(next),inputs:{0:cancel}})).checkpoint;
 assert.equal(next.decision.kind,'wait-target');assert.deepEqual(next.decision.requiredSeats,[0]);
 }finally{await h.close();}
});


test('stored partner command rejects trusted-argument injection and foreign owners before projection',async()=>{
 const{h,c}=await fixture({0:[{move:130,targets:[2],ignorePP:true}]},{0:130});try{
 let next=(await h.request('native-step',c)).checkpoint;const partner=fight(next,1);next=(await h.request('native-submit',{checkpoint:next,inputs:{1:partner}})).checkpoint;
 const phase=next.continuation.phaseQueue.find(d=>d.phase.type==='CommandPhase'&&d.phase.fields.nativeIntent);
 assert.ok(phase);const original=clone(next);
 for(const text of['not-json',JSON.stringify({...partner,ignorePP:true}),JSON.stringify({...partner,pokemonId:field(next,0).id})]){
  const bad=clone(next),p=bad.continuation.phaseQueue.find(d=>d.phase.type==='CommandPhase'&&d.phase.fields.nativeIntent);p.phase.fields.nativeIntent.value=text;
  await assert.rejects(h.request('native-validate-checkpoint',bad),/INVALID_STORED_COMMAND/);
 }assert.deepEqual(next,original);
 }finally{await h.close();}
});

test('original Encore constrains fight options while preserving ordinary party choices',async()=>{
 const{h,c}=await fixture({});try{
 for(const e of c.roster.entries.filter(e=>e.owner===null||e.index===0)){
 const p=api.restorePokemonState(e.pokemon),move=p.getMoveset()[0];move.moveId=e.owner===null&&e.index===0?227:150;move.ppUsed=0;p.moveset=[move];
 if(e.owner!==null){const second=api.restorePokemonState(e.pokemon).getMoveset()[0];second.moveId=106;second.ppUsed=0;p.moveset.push(second);}
 e.pokemon=api.capturePokemonState(p);
 }
 let next=(await h.request('native-step',c)).checkpoint,encored=false;
 for(let n=0;n<10&&!encored;n++){
 const inputs=Object.fromEntries(next.decision.requiredSeats.map(seat=>[seat,next.decision.options[seat].find(o=>o.kind==='fight'&&o.cursor===0&&(o.target===null||o.target>=2))]));
 next=(await h.request('native-submit',{checkpoint:next,inputs})).checkpoint;next=(await drive(h,next)).c;
 for(const seat of[0,1]){const current=next.roster.entries.find(e=>e.owner===seat&&e.index===0),restored=api.restorePokemonState(current.pokemon);
 if(restored.summonData.tags.some(tag=>tag.constructor.name==='EncoreTag')){
 encored=true;assert.ok(next.decision.options[seat].filter(o=>o.kind==='fight').every(o=>o.cursor===0));assert.ok(next.decision.options[seat].some(o=>o.kind==='switch'));
 await assert.rejects(h.request('native-validate',{checkpoint:next,seat,action:{kind:'fight',pokemonId:current.pokemon.fields.id,cursor:1,target:null}}),/INVALID_ACTION|FORCED_MOVE_REQUIRED/);
 }}
 }assert.ok(encored,'original enemy Encore must actually apply');
 }finally{await h.close();}
});
