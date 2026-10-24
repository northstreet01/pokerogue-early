import test,{before}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{buildCoopRuntime}from'../scripts/build-coop-runtime.mjs';import{createOriginalRuleHost}from'../server/original-rule-host.mjs';
let api;before(async()=>{await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();});
async function fixture(){const h=await createOriginalRuleHost({seed:'vs02b09-capture',identity:{trainerId:1,secretId:2}});try{const c=(await h.request('native-open-to-input',{parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}})).checkpoint;return{h,c};}catch(e){await h.close();throw e;}}
test('both original Teleports end the wild encounter, retain HP and safely enter the next wave after JSON restore',async()=>{
 const{h,c}=await fixture();try{
 for(const e of c.roster.entries.filter(e=>e.index===0||e.owner===null)){
 const m=structuredClone(e.pokemon.fields.moveset.find(Boolean));m.fields.moveId=e.owner===null?100:150;m.fields.ppUsed=0;
 e.pokemon.fields.moveset=[m];
 }for(const seat of [0,1])c.decision.options[seat]=[{kind:'fight',pokemonId:c.roster.field[seat],cursor:0,target:null}];
 const inputs=Object.fromEntries([0,1].map(seat=>[seat,c.decision.options[seat][0]]));
 let r=await h.request('native-submit',{checkpoint:c,inputs});let steps=0;
 while(r.checkpoint.decision.kind==='continuing'&&r.checkpoint.decision.reason!=='next-battle'){
 assert.ok(++steps<100);r=await h.request('native-step',JSON.parse(JSON.stringify(r.checkpoint)));
 }
 assert.equal(r.checkpoint.decision.reason,'next-battle');
 assert.ok(r.checkpoint.roster.entries.filter(e=>e.owner===null).every(e=>e.pokemon.fields.hp>0));
 assert.ok(r.checkpoint.roster.field.slice(2).every(id=>id===null));
 const next=await h.request('native-next',JSON.parse(JSON.stringify(r.checkpoint)));assert.equal(next.checkpoint.battle.waveIndex,2);
 }finally{await h.close();}
});
test('public projections expose every visible status enum without disclosing private status timers',async()=>{
 const{h,c}=await fixture();try{for(const effect of [1,2,3,4,5,6]){
 for(const e of c.roster.entries.filter(e=>e.owner===null||e.index===0)){const p=api.restorePokemonState(e.pokemon);p.status=new api.Status(effect,3,5);e.pokemon=api.capturePokemonState(p);}
 const view=await h.request('native-project',{checkpoint:c,seat:0});assert.ok(view.shared.pokemon.every(p=>p.status===effect));
 assert.ok(view.shared.pokemon.every(p=>!Object.hasOwn(p,'turnCount')&&!Object.hasOwn(p,'cureTurn')));
 }}finally{await h.close();}
});
