import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {createOriginalRuleHost} from '../server/original-rule-host.mjs';
import {steadyRoute,steadyInput} from './helpers/native-steady-progression.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FormalRoomStore} from '../server/formal-coop-service.mjs';
import {openPreparationRoom,request,until} from './helpers/native-preparation-ws.mjs';

let api,route;
const transitions=new Map();
const front=c=>(c.continuation.phaseQueuePrepend.at(-1)??c.continuation.phaseQueue[0])?.phase.type;
before(async()=>{
 await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();
 route=await steadyRoute({untilWave:25,onStep:(_step,saved)=>{
  const c=saved.nativeCheckpoint;
  if([10,20].includes(c.battle.waveIndex)&&c.decision.kind!=='continuing')transitions.set(c.battle.waveIndex,structuredClone(saved));
 }});
 assert.equal(route.error,undefined);assert.equal(route.saved.nativeCheckpoint.battle.waveIndex,25);
});

test('natural gym voucher facts remain separate owned pending interfaces, without spendable gacha balances',()=>{
 const saved=route.milestones.get(21),claims=saved.intents.filter(i=>i.type==='voucher-pending');
 assert.equal(claims.length,2);assert.deepEqual(claims.map(i=>i.owner).sort(),[0,1]);
 assert.equal(new Set(claims.map(i=>i.id)).size,2);
 for(const claim of claims){assert.equal(claim.status,'pending');assert.equal(claim.payload.count,1);assert.equal(claim.payload.resolve,'original-unlock-or-repeat');}
 assert.ok(saved.nativeCheckpoint.players.every(p=>!Object.hasOwn(p,'voucherCounts')));
});

for(const wave of [10,20])test(`real dual WS/owned models: original map ${wave+1} commits once after disk failure and restart`,async()=>{
 const savedSource=transitions.get(wave),source=savedSource.nativeCheckpoint,directory=await mkdtemp(join(tmpdir(),'boss-biome-'));
 const fixture={api,checkpoint:source,stage:savedSource.stage,provisioning:savedSource.provisioning,intents:savedSource.intents};
 class FailingStore extends FormalRoomStore{
  fail=true;
  async save(room){if(this.fail&&room.checkpoint.nativeCheckpoint?.battle.waveIndex===wave+1){this.fail=false;throw Error('TEST_BIOME_SAVE_FAILED');}return super.save(room);}
 }
 const store=new FailingStore(directory);let env=await openPreparationRoom({...fixture,store});
 try{
  let pair=env.pair;const original=structuredClone(env.server.rooms.get(pair[0].identity.roomId).checkpoint);
  const inputs=steadyInput(api,source),actions=Object.entries(inputs).map(([seat,action])=>({seat:Number(seat),message:request(pair[seat],action)}));
  actions.forEach(({seat,message})=>pair[seat].send(message));
  await until(()=>pair.some(c=>c.errors.includes('STORAGE_FAILED')),'biome save rejection');
  const [failed]=await store.load();assert.deepEqual(failed.checkpoint,original);assert.equal(Object.keys(failed.inputs).length,actions.length);
  const tokens=pair.map(c=>c.identity);await env.close();
  env=await openPreparationRoom({...fixture,store:new FormalRoomStore(directory),old:tokens});pair=env.pair;
  await until(()=>pair.every(c=>c.ready&&c.latest.shared.waveIndex===wave+1),'restored map and both original model ACKs');
  const committed=structuredClone(env.server.rooms.get(pair[0].identity.roomId).checkpoint);
  assert.equal(committed.nativeCheckpoint.battle.waveIndex,wave+1);
  for(const {seat,message}of actions){pair[seat].send(message);assert.equal((await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId)).accepted,true);}
  assert.deepEqual(env.server.rooms.get(pair[0].identity.roomId).checkpoint,committed);
 }finally{await env.close();await rm(directory,{recursive:true,force:true});}
});

test('default collection and legal inputs naturally pass original milestone fights 10/20, biome 11/21 and same-seed trainer 12',()=>{
 for(const wave of [10,11,12,20,21,25])assert.ok(route.milestones.has(wave),`natural wave ${wave} must accept real actions`);
 const wildBoss=route.milestones.get(10).nativeCheckpoint;
 const bosses=wildBoss.roster.entries.filter(e=>e.owner===null);
 assert.ok(bosses.some(e=>e.pokemon.fields.bossSegments>=2));
 for(const entry of bosses){
  // Original double-wild BST balancing can reduce one enemy to a single segment.
  assert.ok(entry.pokemon.fields.bossSegments>=1);
  assert.equal(entry.pokemon.fields.bossSegmentIndex,entry.pokemon.fields.bossSegments-1);
 }
 const trainerBoss=api.originalDecisionStateCodec.restore(route.milestones.get(20).nativeCheckpoint);
 assert.equal(trainerBoss.battle.battleType,1);assert.equal(trainerBoss.battle.trainer.config.isBoss,true);
 for(const wave of [11,21]){
  const c=route.milestones.get(wave).nativeCheckpoint;
  assert.equal(new Set(c.roster.entries.map(e=>e.pokemon.fields.id)).size,c.roster.entries.length);
 }
 const phases=route.trace.flatMap(s=>s.phases??[]);
 for(const name of ['SelectBiomePhase','PartyHealPhase','SwitchBiomePhase','NewBiomeEncounterPhase','LevelCapPhase'])assert.ok(phases.includes(name),name);
});

test('Boss original phase effects and random streams match continuous execution after every phase restart',async()=>{
 const saved=route.milestones.get(10),c=saved.nativeCheckpoint,config={seed:saved.provisioning.seed,identity:saved.provisioning.identities[0]};
 let h=await createOriginalRuleHost(config);
 try{
  let input=(await h.request('native-submit',{checkpoint:c,inputs:steadyInput(api,c)})).checkpoint;
  const expected=(await h.request('native-run-to-boundary',input)).checkpoint;
  const semantic=value=>{
   const copy=structuredClone(value);delete copy.decision.id;
   for(const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'])for(const d of copy.continuation[key])delete d.phaseId;
   if(copy.continuation.currentPhase)delete copy.continuation.currentPhase.phaseId;
   return copy;
  };
  for(let n=0;n<160&&input.decision.kind==='continuing'&&front(input)!=='SelectModifierPhase';n++){
   await h.close();h=await createOriginalRuleHost(config);
   input=(await h.request('native-step',JSON.parse(JSON.stringify(input)))).checkpoint;
  }
  assert.deepEqual(semantic(input),semantic(expected));
 }finally{await h.close();}
});

test('same-seed original trainer keeps generated stats and personality while only duplicate co-op ids change',async()=>{
 const saved=route.milestones.get(12),c=api.originalDecisionStateCodec.restore(saved.nativeCheckpoint);
 const runtime=api.createOriginalRuntime(saved.provisioning.seed,saved.provisioning.identities[0]);
 // Install production display ports in this module graph, then independently
 // run the original trainer constructor path without the co-op identity port.
 await api.executeRuntimeOperation(runtime,'native-open-to-input',{parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}});
 const scene=runtime.scene;Object.assign(scene,c.scene,{currentBattle:c.battle,arena:c.arena,party:[],modifiers:[],enemyModifiers:[],
  addFieldSprite:()=>({setOrigin(){return this;},setPipeline(){return this;},setVisible(){return this;}})});
 c.arena.scene=scene;c.battle.trainer.scene=scene;
 assert.equal(c.battle.trainer.config.useSameSeedForAllMembers,true);
 const expected=c.battle.enemyParty;c.battle.enemyParty=[];
 api.withStarterRandomContext(c,()=>{
  for(const index of c.battle.enemyLevels.keys()){
   const raw=c.battle.trainer.genPartyMember(index);c.battle.enemyParty.push(raw);
   const a=api.capturePokemonState(raw).fields,b=api.capturePokemonState(expected[index]).fields;
   for(const key of ['species','ivs','nature','gender','abilityIndex','formIndex','shiny','moveset','stats','level','exp'])assert.deepEqual(b[key],a[key],key);
  }
 });
 assert.ok(new Set(c.battle.enemyParty.map(p=>p.id)).size<c.battle.enemyParty.length,'the original repeated seed really produces colliding ids');
 assert.equal(new Set(expected.map(p=>p.id)).size,expected.length);
});

test('normal defeat persists an empty original phase queue and projects a terminal Home reason to both owners',async()=>{
 const ended=await steadyRoute({initialSaved:route.milestones.get(25),untilWave:26});
 assert.equal(ended.error,undefined);const saved=ended.saved,c=saved.nativeCheckpoint;
 assert.equal(c.decision.kind,'ended');assert.equal(c.decision.reason,'defeat');assert.equal(c.decision.victory,false);
 assert.ok(c.roster.entries.filter(e=>e.owner!==null).every(e=>e.pokemon.fields.hp===0));
 for(const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'])assert.deepEqual(c.continuation[key],[]);
 const h=await createOriginalRuleHost({seed:saved.provisioning.seed,identity:saved.provisioning.identities[0]});
 try{for(const seat of [0,1]){
  const view=await h.request('native-project',{checkpoint:JSON.parse(JSON.stringify(c)),seat});
  assert.equal(view.personal.decision.reason,'defeat');assert.equal(view.personal.decision.victory,false);
  assert.deepEqual(view.personal.decision.requiredSeats,[]);
 }}finally{await h.close();}
});
