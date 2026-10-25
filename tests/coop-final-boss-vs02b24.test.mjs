import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {createOriginalRuleHost} from '../server/original-rule-host.mjs';
import {finalBossFixture,finalBossConfig,finalBossTrace,phase} from './helpers/native-final-boss.mjs';
import {forcedProgressionHost} from './helpers/forced-progression-host.mjs';
import {steadyInput} from './helpers/native-steady-progression.mjs';
let api,fixture,stageTrace;
before(async()=>{await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();fixture=await finalBossFixture(api);});
const enemies=c=>c.roster.entries.filter(e=>e.owner===null);

test('original generator creates one full segmented final Boss and both player fronts from the first stage',()=>{
 const c=fixture.checkpoint;
 assert.equal(c.battle.double,true);assert.equal(c.battle.battleSpec,1);assert.deepEqual(c.battle.enemyLevels,[200]);
 assert.equal(enemies(c).length,1);const boss=enemies(c)[0].pokemon.fields;
 assert.equal(boss.species,890);assert.equal(boss.formIndex,0);assert.equal(boss.bossSegments,4);assert.equal(boss.bossSegmentIndex,3);
 assert.deepEqual(boss.ivs,[31,31,31,31,31,31]);
 assert.equal(c.roster.field[2],boss.id);assert.equal(c.roster.field[3],null);
 assert.equal(c.decision.kind,'wait-actions');assert.deepEqual(c.decision.requiredSeats,[0,1]);
 for(const seat of [0,1]){
  assert.equal(c.roster.field[seat],c.roster.entries.find(e=>e.owner===seat&&e.index===0).pokemon.fields.id);
  assert.ok(c.decision.options[seat].some(o=>o.kind==='fight'&&o.target===2));
  assert.ok(!c.decision.options[seat].some(o=>o.kind==='fight'&&o.target===3));
  assert.ok(!c.decision.options[seat].some(o=>o.kind==='ball'));
 }
 assert.ok(fixture.events.some(e=>e.kind==='dialogue'));
});

test('single enemy generation uses the original single Battle constructor level and random consumption',()=>{
 const make=playerDouble=>{
  const c=api.originalDecisionStateCodec.restore(fixture.before),B=c.battle.constructor;
  const b=api.withStarterRandomContext(c,()=>new B(c.scene.gameMode,200,0,null,playerDouble,false));
  return {levels:b.enemyLevels,seed:b.battleSeed,random:c.sceneRandom.capture(),double:b.double};
 };
 const single=make(false),doubleFront=make(true);
 assert.equal(single.levels.length,1);assert.deepEqual(single.levels,fixture.checkpoint.battle.enemyLevels);
 assert.equal(doubleFront.double,true);assert.deepEqual({...doubleFront,double:false},single);
});

test('normal damage keeps one enemy action, owned PP and exact codec restoration',async()=>{
 const h=await createOriginalRuleHost(finalBossConfig);try{
  const c=fixture.checkpoint,input=steadyInput(api,c);
  const submitted=await h.request('native-submit',{checkpoint:c,inputs:input});
  const r=await h.request('native-run-to-boundary',submitted.checkpoint);
  assert.equal(enemies(r.checkpoint).length,1);assert.equal(r.checkpoint.roster.field[3],null);
  assert.equal([...submitted.events,...r.events].filter(e=>e.kind==='phase-start'&&e.phase==='EnemyCommandPhase').length,1);
  assert.deepEqual(api.originalDecisionStateCodec.capture(api.originalDecisionStateCodec.restore(r.checkpoint)),r.checkpoint);
 }finally{await h.close();}
});

test('original first-stage Damage, same-instance form, moves, held item and final ending survive every phase restart',async()=>{
 const trace=stageTrace=await finalBossTrace(api,fixture.checkpoint),id=enemies(fixture.checkpoint)[0].pokemon.fields.id;
 assert.equal(trace.terminal.decision.kind,'ended');assert.equal(trace.terminal.decision.victory,true);
 const phases=trace.steps.flatMap(s=>s.result.events.filter(e=>e.kind==='phase-start').map(e=>e.phase));
 for(const name of ['DamagePhase','QuietFormChangePhase','FaintPhase','VictoryPhase','GameOverPhase'])assert.ok(phases.includes(name),name);
 const transformed=trace.steps.find(s=>enemies(s.result.checkpoint)[0].pokemon.fields.formIndex===1).result.checkpoint;
 assert.equal(enemies(transformed)[0].pokemon.fields.id,id);assert.equal(transformed.battle.enemyParty.length,1);
 assert.notDeepEqual(enemies(transformed)[0].pokemon.fields.moveset,enemies(fixture.checkpoint)[0].pokemon.fields.moveset);
 assert.ok(transformed.enemyModifiers.length>fixture.checkpoint.enemyModifiers.length,'original MINI_BLACK_HOLE is granted');
 assert.equal(trace.steps.flatMap(s=>s.result.events).filter(e=>e.kind==='form-change'&&e.pokemonId===id).length,1);
 // Only accelerated damage is altered; each replay uses another real Worker
 // graph and the same original phase/codec, not a replacement boss model.
 for(const step of trace.steps){
  assert.equal(enemies(step.result.checkpoint).length,1);
  assert.equal(enemies(step.result.checkpoint)[0].pokemon.fields.id,id);
  const h=await forcedProgressionHost(finalBossConfig);
  try{assert.deepEqual(await h.request(step.operation,step.payload),step.result);}finally{await h.close();}
 }
});

for(const seat of [0,1])test(`phase change with fainted seat ${seat} preserves its original replacement without adding a second player summon`,async()=>{
 const transition=stageTrace.steps.find(s=>s.result.events.some(e=>e.kind==='dialogue')&&s.before.battle.battleSpec===1
  &&enemies(s.before)[0].pokemon.fields.formIndex===0&&enemies(s.before)[0].pokemon.fields.bossSegmentIndex===0);
 assert.ok(transition,'original first-stage ending');
 const c=api.originalDecisionStateCodec.restore(transition.before),actor=c.roster.entries.find(e=>e.owner===seat&&e.index===0).pokemon;
 actor.hp=0;actor.status=new api.Status(api.StatusEffect.FAINT);
 const h=await forcedProgressionHost(finalBossConfig);try{
  const r=await h.request('native-step',api.originalDecisionStateCodec.capture(c));
  const phases=[...r.checkpoint.continuation.phaseQueue,...r.checkpoint.continuation.phaseQueuePrepend];
  assert.ok(!phases.some(d=>d.phase.type==='SummonPhase'),'co-op already has two owned fronts; fainting must use its own replacement');
  assert.ok(!phases.some(d=>d.phase.type==='ToggleDoublePositionPhase'),'do not replay solo front expansion');
  assert.ok(phases.some(d=>d.phase.type==='QuietFormChangePhase'),'original transformation is retained');
  assert.equal(r.checkpoint.roster.field[seat],actor.id);assert.equal(r.checkpoint.roster.field[1-seat],fixture.checkpoint.roster.field[1-seat]);
 }finally{await h.close();}
});

test('legacy dual-Boss checkpoints preserve both original generated instances, HP and codec data on resume',async()=>{
 const legacy=await finalBossFixture(api,{legacy:true}),c=legacy.checkpoint;
 assert.equal(enemies(c).length,2);assert.equal(c.battle.enemyLevels.length,2);assert.ok(c.roster.field[3]!==null);
 assert.ok(enemies(c).every(e=>e.pokemon.fields.species===890));
 const h=await createOriginalRuleHost(finalBossConfig);try{
  await h.request('native-validate-checkpoint',c);
  assert.deepEqual(api.originalDecisionStateCodec.capture(api.originalDecisionStateCodec.restore(c)),c);
  const p=await h.request('native-project',{checkpoint:c,seat:1});assert.equal(p.shared.pokemon.filter(e=>e.owner===null).length,2);
  const submitted=await h.request('native-submit',{checkpoint:c,inputs:steadyInput(api,c)});
  const r=await h.request('native-run-to-boundary',submitted.checkpoint);
  assert.deepEqual(r.checkpoint.battle.enemyParty,c.battle.enemyParty);
 }finally{await h.close();}
});

for(const deadSeat of [0,1])test(`single Boss: original summon replaces fainted seat ${deadSeat} without borrowing the partner front`,async()=>{
 const c=api.originalDecisionStateCodec.restore(fixture.checkpoint),front=c.roster.entries.find(e=>e.owner===deadSeat&&e.index===0).pokemon;
 front.hp=0;front.status=new api.Status(api.StatusEffect.FAINT);c.roster.field[deadSeat]=null;
 c.decision={id:'vs24-faint-'+deadSeat,kind:'continuing',requiredSeats:[],reason:'effects'};
 c.continuation={phaseQueue:[phase('TurnInitPhase')],phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,currentPhase:null,standbyPhase:null};
 const h=await createOriginalRuleHost(finalBossConfig);try{
  const r=await h.request('native-run-to-boundary',api.originalDecisionStateCodec.capture(c));
  assert.ok(['wait-switch','switch-select','wait-actions'].includes(r.checkpoint.decision.kind),r.checkpoint.decision.kind);
  assert.equal(r.checkpoint.battle.enemyParty.length,1);
  assert.equal(r.checkpoint.roster.field[1-deadSeat],fixture.checkpoint.roster.field[1-deadSeat]);
  if(r.checkpoint.decision.kind!=='wait-actions')assert.deepEqual(r.checkpoint.decision.requiredSeats,[deadSeat]);
 }finally{await h.close();}
});

for(const seat of [0,1])for(const move of [0,130])test(`single Boss original automatic ${move===0?'recharge':'charged attack'} stays owned by seat ${seat}`,async()=>{
 const c=api.originalDecisionStateCodec.restore(fixture.checkpoint),actor=c.roster.entries.find(e=>e.owner===seat&&e.index===0).pokemon;
 const m=actor.getMoveset()[0];if(move){m.moveId=move;m.ppUsed=1;actor.moveset=[m];}
 actor.getMoveQueue().push({move,targets:move?[2]:[],...(move?{ignorePP:true}:{})});
 if(move)actor.getMoveHistory().push({move,targets:[2],result:4,turn:c.battle.turn-1}); // Original charge history is MoveResult.OTHER.
 c.decision={id:`vs24-auto-${seat}-${move}`,kind:'continuing',requiredSeats:[],reason:'effects'};
 c.continuation={phaseQueue:[phase('TurnInitPhase')],phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,currentPhase:null,standbyPhase:null};
 const h=await forcedProgressionHost(finalBossConfig);try{
  let next=(await h.request('native-step',api.originalDecisionStateCodec.capture(c))).checkpoint;
  assert.deepEqual(next.decision.requiredSeats,[1-seat]);
  const partner=steadyInput(api,next)[1-seat];
  next=(await h.request('native-submit',{checkpoint:next,inputs:{[1-seat]:partner}})).checkpoint;
  if(next.decision.kind==='wait-target'){
   assert.deepEqual(next.decision.requiredSeats,[seat]);assert.ok(!next.decision.options[seat].some(o=>o.target===3));
   next=(await h.request('native-submit',{checkpoint:next,inputs:{[seat]:next.decision.options[seat].find(o=>o.target===2)}})).checkpoint;
  }
  next=(await h.request('native-run-to-boundary',next)).checkpoint;
  assert.equal(next.battle.enemyParty.length,1);assert.equal(next.roster.field[3],null);
  const restored=api.restorePokemonState(next.roster.entries.find(e=>e.owner===seat&&e.index===0).pokemon);
  assert.equal(restored.getMoveQueue().length,0);assert.equal(restored.getMoveset()[0].ppUsed,move?1:actor.getMoveset()[0].ppUsed);
 }finally{await h.close();}
});
