import test,{before}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';import{buildCoopRuntime}from'../scripts/build-coop-runtime.mjs';import{forcedCommandFixture}from'./helpers/native-forced-command.mjs';
let api;before(async()=>{await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();});
const owned=(c,seat)=>c.roster.entries.find(e=>e.owner===seat&&e.index===0).pokemon;
async function finish(h,c){for(let n=0;n<100&&c.decision.kind==='continuing';n++)c=(await h.request('native-step',JSON.parse(JSON.stringify(c)))).checkpoint;return c;}
test('original Hyper Beam generates its own recharge queue and the automatic rest turn charges no extra PP',async()=>{
 const{h,c}=await forcedCommandFixture(api,{});try{
 // Synthetic endurance targets keep the original hit/damage/attribute methods running.
 for(const entry of c.roster.entries.filter(e=>e.owner===null||e.index===0)){
 const p=api.restorePokemonState(entry.pokemon),m=p.getMoveset()[0];m.moveId=entry.owner===0?63:150;m.ppUsed=0;p.moveset=[m];
 if(entry.owner===null){p.stats[0]=5000;p.hp=5000;}entry.pokemon=api.capturePokemonState(p);
 }
 let next=(await h.request('native-step',c)).checkpoint,attempts=0;
 while(next.decision.requiredSeats.includes(0)&&attempts<5){
 const inputs=Object.fromEntries(next.decision.requiredSeats.map(seat=>[seat,next.decision.options[seat].find(o=>o.kind==='fight'&&(o.target===null||o.target>=2))]));
 next=await finish(h,(await h.request('native-submit',{checkpoint:next,inputs})).checkpoint);attempts++;
 }
 assert.deepEqual(next.decision.requiredSeats,[1]);const actor=api.restorePokemonState(owned(next,0));
 assert.equal(actor.getMoveQueue()[0].move,0,'the original move, not the fixture, enqueued NONE');assert.equal(actor.getMoveset()[0].ppUsed,attempts);
 assert.ok(next.roster.entries.some(e=>e.owner===null&&e.pokemon.fields.hp<5000));
 const partner=next.decision.options[1].find(o=>o.kind==='fight'&&o.target===null);
 next=await finish(h,(await h.request('native-submit',{checkpoint:next,inputs:{1:partner}})).checkpoint);
 assert.deepEqual(next.decision.requiredSeats,[0,1]);const rested=api.restorePokemonState(owned(next,0));
 assert.equal(rested.getMoveQueue().length,0);assert.equal(rested.getMoveset()[0].ppUsed,attempts);
 }finally{await h.close();}
});
