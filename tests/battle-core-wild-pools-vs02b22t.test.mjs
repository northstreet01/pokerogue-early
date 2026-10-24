import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {defaultTrainerRoute} from './helpers/native-default-trainer.mjs';
let api,source,trainerSource,identity;
before(async()=>{
 await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();
 const route=await defaultTrainerRoute();await route.h.close();identity=route.config.identity;
 // Explicit synthetic boundary for a fast, unmodified production Worker/API
 // regression. Natural/accelerated traversal is proved separately by dual WS.
 const c=api.originalDecisionStateCodec.restore(route.c);c.battle.waveIndex=44;c.scene.waveCycleOffset=30;
 const scene=api.createOriginalRuntime(c.scene.seed,identity).scene;
 Object.assign(scene,c.scene,{currentBattle:c.battle,arenaBg:{}});c.arena=scene.newArena(40); // original ISLAND pool; display-only allocation port
 source=api.originalDecisionStateCodec.capture(c);
 assert.equal(source.arena.lastTimeOfDay.value,3); // original NIGHT
 const trainer=api.originalDecisionStateCodec.restore(route.c);trainer.battle.waveIndex=19;trainer.scene.waveCycleOffset=0;
 Object.assign(scene,trainer.scene,{currentBattle:trainer.battle});trainer.arena=scene.newArena(40);
 trainerSource=api.originalDecisionStateCodec.capture(trainer);
 assert.equal(trainerSource.arena.lastTimeOfDay.value,2); // original DUSK
});

test('unmodified native 44 to 45 accepts exactly the original NIGHT to DAWN encounter pool refresh',async()=>{
 const runtime=api.createOriginalRuntime(source.scene.seed,identity),before=structuredClone(source);
 const result=await api.executeRuntimeOperation(runtime,'native-next',source),after=result.checkpoint;
 assert.equal(after.battle.waveIndex,45);assert.equal(after.battle.battleType,0);
 const expected=api.originalDecisionStateCodec.restore(source),scene=runtime.scene;
 expected.battle.waveIndex=45;Object.assign(scene,expected.scene,{currentBattle:expected.battle});expected.arena.scene=scene;
 expected.arena.updatePoolsForTimeOfDay();
 assert.equal(after.arena.lastTimeOfDay.value,0); // original DAWN
 assert.notDeepEqual(after.arena.pokemonPool,source.arena.pokemonPool);
 assert.deepEqual(after.arena,api.originalDecisionStateCodec.capture(expected).arena);
 assert.deepEqual(after.players,source.players);assert.deepEqual(after.eggState,source.eggState);assert.deepEqual(source,before);
});

test('wild pool refresh does not admit unrelated Arena changes or mutate the source on rejection',async()=>{
 const runtime=api.createOriginalRuntime(source.scene.seed,identity),before=structuredClone(source),original=api.BattleScene.prototype.newBattle;
 api.BattleScene.prototype.newBattle=function(...args){const result=original.apply(this,args);this.arena.ignoreAbilities=!this.arena.ignoreAbilities;return result;};
 try{await assert.rejects(api.executeRuntimeOperation(runtime,'native-next',source),/INVALID_WILD_TRANSITION/);assert.deepEqual(source,before);}
 finally{api.BattleScene.prototype.newBattle=original;}
});

test('original trainer 19 to 20 preserves the existing DUSK pool until the following biome change',async()=>{
 const runtime=api.createOriginalRuntime(trainerSource.scene.seed,identity),before=structuredClone(trainerSource);
 const {checkpoint:after}=await api.executeRuntimeOperation(runtime,'native-next',trainerSource);
 assert.equal(after.battle.waveIndex,20);assert.equal(after.battle.battleType,1);
 assert.equal(after.arena.lastTimeOfDay.value,2);assert.deepEqual(after.arena,trainerSource.arena);
 assert.deepEqual(trainerSource,before);
});
