import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { parse } from './helpers/original-model.mjs';
import { initialDecision, codec } from './helpers/decision-model.mjs';
import { modifierPoolFields, createModifierPoolState, restoreModifierPoolState } from '../src/battle-core/modifier-pool-state.mjs';
import { ruleRandom, ruleModifierPools, ruleSeedOffset } from '../src/battle-core/random-context.mjs';
import { withOriginalRules, withOriginalRandom } from '../server/original-random-context.mjs';
import { RandomDataGenerator } from '../src/battle-core/random.mjs';

const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/early-modifier-pools-reference.json',import.meta.url),'utf8')).source;
const actual=parse('modifier/modifier-type.ts').statements.filter(n=>ts.isFunctionDeclaration(n)&&['regenerateModifierPoolThresholds','getNewModifierTypeOption'].includes(n.name?.text)).map(n=>n.getText()).join('\n');
function implementation(source, random, isOriginal) {
  const result={},draw=limit=>limit<=1?0:random().integerInRange(0,limit-1);
  class Generator {constructor(){this.id='generated';}generateType(){return {id:'generated-'+draw(10)};}}
  const pool=Object.fromEntries([0,1,2,3,4].map(t=>[t,[{modifierType:{id:'static-'+t},weight:3},{modifierType:new Generator(),weight:p=>p[0].weight},{modifierType:{id:'ignored'},weight:0}]]));
  const declarations=isOriginal?modifierPoolFields.map(k=>'let '+k+'={};').join('\n'):'';
  const capture=isOriginal?'()=>({'+modifierPoolFields.join(',')+'})':'getModifierPools';
  vm.runInNewContext(ts.transpileModule(declarations+'\n'+source.replaceAll('export function','function')+`\nresult.regenerate=regenerateModifierPoolThresholds;result.pick=getNewModifierTypeOption;result.capture=${capture};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
    {result,Function,console:{log(){},table(){}},getModifierPools:()=>ruleModifierPools(()=>assert.fail()),Utils:{randSeedInt:draw},ModifierTypeGenerator:Generator,PokemonHeldItemModifierType:class{},FormChangeItemModifierType:class{},ModifierTypeOption:class{constructor(type,upgradeCount){this.type=type;this.upgradeCount=upgradeCount;}},ModifierPoolType:{PLAYER:0,WILD:1,TRAINER:2,ENEMY_BUFF:3,DAILY_STARTER:4},ModifierTier:{COMMON:0,GREAT:1,ULTRA:2,ROGUE:3,MASTER:4},tierWeights:[.75,.19,.047,.012,.001],outputModifierData:false,useMaxWeightForOutput:false,modifierPool:pool,wildModifierPool:pool,trainerModifierPool:pool,enemyBuffModifierPool:pool,dailyStarterModifierPool:pool});
  return result;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const party=weight=>[{weight,scene:{findModifiers:()=>[]},isShiny:()=>false,isFainted:()=>false}];

test('original reward pool regeneration/selection preserves weights and RNG across rooms and checkpoints',async()=>{
  const runtime=implementation(actual,()=>ruleRandom(()=>assert.fail()),false);
  const rooms=[initialDecision('pool-a'),initialDecision('pool-b')];
  const references=rooms.map(c=>{const random=new RandomDataGenerator(c.sceneRandom.capture());return {random,runtime:implementation(frozen,()=>random,true)};});
  for(let poolType=0;poolType<5;poolType++) {
    for(const [i,ctx] of rooms.entries()) {
      const ref=references[i],p=party(i+2);
      ref.runtime.regenerate(p,poolType);
      await withOriginalRules(ctx,async()=>{await Promise.resolve();runtime.regenerate(p,poolType);});
      assert.deepEqual(plain(ctx.modifierPools),plain(ref.runtime.capture()));
      assert.equal(ctx.sceneRandom.capture(),ref.random.state());
    }
    // Capture after regeneration, then alternate room selection without
    // regenerating pools (which itself consumes random draws).
    for(const i of [1,0]) {
      // The source fixture runs in a VM realm; normalize its plain tables at
      // this test boundary, as the other original-model helpers do.
      rooms[i].modifierPools=plain(rooms[i].modifierPools);
      const saved=codec.capture(rooms[i]);rooms[i]=codec.restore(saved);
      const ref=references[i],p=party(i+2);
      for(let count=0;count<12;count++) {
        const expected=ref.runtime.pick(p,poolType,0,0);
        const actual=withOriginalRules(rooms[i],()=>runtime.pick(p,poolType,0,0));
        assert.deepEqual(plain(actual),plain(expected));
      }
      assert.equal(rooms[i].sceneRandom.capture(),ref.random.state());
    }
  }
});
test('pool checkpoints reject invalid tiers, thresholds, indexes and missing sections',()=>{
  const valid=createModifierPoolState();assert.deepEqual(restoreModifierPoolState(valid),valid);
  for(const mutate of [s=>{delete s.ignoredPoolIndexes;},s=>{s.modifierPoolThresholds={9:{1:0}};},s=>{s.modifierPoolThresholds={0:{NaN:0}};},s=>{s.ignoredPoolIndexes={0:[-1]};}]) {
    const s=structuredClone(valid);mutate(s);assert.throws(()=>restoreModifierPoolState(s),/INVALID_MODIFIER_POOLS/);
  }
});
test('seed scopes retain pool ownership but entering a bare second room cannot inherit the first room tables',()=>{
  const a=initialDecision('a'),b=initialDecision('b');
  withOriginalRules(a,()=>{
    ruleSeedOffset(()=>assert.fail(),'nested',1,()=>assert.equal(ruleModifierPools(()=>assert.fail()),a.modifierPools));
    withOriginalRandom(b.sceneRandom,()=>assert.throws(()=>ruleModifierPools(()=>assert.fail()),/MODIFIER_POOL_CONTEXT_REQUIRED/));
    withOriginalRules(b,()=>assert.equal(ruleModifierPools(()=>assert.fail()),b.modifierPools));
    assert.equal(ruleModifierPools(()=>assert.fail()),a.modifierPools);
  });
});
