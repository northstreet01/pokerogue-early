import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parse } from './helpers/original-model.mjs';
import { codec } from './helpers/decision-model.mjs';
import { switchFinishContext, finishHandler, continueSwitchFinishes } from './helpers/continuation-model.mjs';
import { emptyContinuation, advanceContinuation } from '../src/battle-core/phase-continuation.mjs';
import { pushPhase, prependPhase, selectNextPhase, populatePhaseQueue } from '../src/battle-core/phase-queue.mjs';
import { finishSwitchSummon } from '../src/battle-core/switch-finish.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';

const frozen = JSON.parse(fs.readFileSync(new URL('./fixtures/early-continuation-reference.json',import.meta.url),'utf8'));
const method = (file,cls,name) => parse(file).statements.find(n=>ts.isClassDeclaration(n)&&n.name.text===cls).members.find(n=>n.name?.getText()===name).getText();
function queueTrace(source, modal, splice) {
  const trace=[], result={};
  vm.runInNewContext(ts.transpileModule(`class Scene { ${source} } result.Scene=Scene;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
    {result,pushPhase,prependPhase,selectNextPhase,populatePhaseQueue,TurnInitPhase:class{start(){trace.push('turn-init');}}});
  const scene = new result.Scene(); Object.assign(scene,emptyContinuation());
  const phase = id => ({id,start(){trace.push(id);}});
  scene.pushPhase(phase('ordinary')); scene.pushPhase(phase('deferred'),true);
  scene.unshiftPhase(phase('prepend-1'));
  if(splice) scene.setPhaseQueueSplice();
  scene.unshiftPhase(phase('prepend-2'));scene.unshiftPhase(phase('prepend-3'));
  if(modal) {scene.currentPhase=phase('suspended');assert.equal(scene.overridePhase(phase('modal')),true);assert.equal(scene.overridePhase(phase('rejected')),false);}
  for(let i=0;i<8;i++)scene.shiftPhase();
  return {trace,splice:scene.phaseQueuePrependSpliceIndex,standby:scene.standbyPhase};
}
test('actual BattleScene queue wiring matches frozen prepend, splice, deferred and standby order',()=>{
  const names=['pushPhase','unshiftPhase','clearPhaseQueue','setPhaseQueueSplice','clearPhaseQueueSplice','shiftPhase','overridePhase','populatePhaseQueue'];
  const actual=names.map(n=>method('battle-scene.ts','BattleScene',n)).join('\n');
  assert.match(actual,/selectNextPhase\(/);
  for(const modal of [false,true])for(const splice of [false,true])assert.deepEqual(queueTrace(actual,modal,splice),queueTrace(frozen.queue,modal,splice));
});

function finishTrace(source, batonPass, command, hasLast) {
  const trace=[], result={}, pokemon={scene:{currentBattle:{turnCommands:{0:{command}}}},battleSummonData:{turnCount:1},transferSummon:p=>trace.push(['transfer',p.id])};
  const last=hasLast?{id:7,resetSummonData:()=>trace.push(['reset'])}:undefined;
  const scene={triggerPokemonFormChange:()=>trace.push(['form'])};
  vm.runInNewContext(ts.transpileModule(`class Switch extends Base { ${source} } result.Switch=Switch;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
    {result,finishSwitchSummon,Command:{POKEMON:2},SpeciesFormChangeActiveTrigger:class{},Base:class{onEnd(){trace.push(['super']);}}});
  const phase=new result.Switch();Object.assign(phase,{scene,fieldIndex:0,batonPass,lastPokemon:last,getPokemon:()=>pokemon});phase.onEnd();
  return {trace,turnCount:pokemon.battleSummonData.turnCount};
}
test('actual SwitchSummonPhase tail preserves original super, turn compensation, transfer and reset order',()=>{
  const actual=method('phases.ts','SwitchSummonPhase','onEnd');assert.match(actual,/finishSwitchSummon\(/);
  for(const baton of [false,true])for(const command of [0,2])for(const hasLast of [false,true]){
    if(baton&&!hasLast)continue;
    assert.deepEqual(finishTrace(actual,baton,command,hasLast),finishTrace(frozen.finish,baton,command,hasLast));
  }
});

test('original switch finish and baton stages resume identically; explicit RAND slot survives JSON',()=>{
  for(const baton of [false,true]){
    const original=switchFinishContext(baton),saved=codec.capture(original),restored=codec.restore(copy(saved));
    // Reference executes real Pokemon methods directly, with no checkpoint in between.
    const expected=[];
    for(const d of original.continuation.phaseQueue) expected.push(...finishHandler(original,d));
    original.continuation.phaseQueue=[];
    prependPhase(original.continuation,{kind:'post-summon',fieldIndex:0,pokemonId:100});original.decision.id+='-finished';
    const result=continueSwitchFinishes(restored);
    assert.deepEqual(result.events,expected);assert.deepEqual(codec.capture(result.context),codec.capture(original));
    const stages=result.context.roster.entries[0].pokemon.summonData.battleStats;
    assert.equal(stages.length,baton?8:7);
    if(baton){assert.equal(Object.hasOwn(stages,7),true);assert.equal(stages[7],undefined);}
    assert.deepEqual(codec.capture(codec.restore(codec.capture(result.context))),codec.capture(original));
    assert.deepEqual(codec.capture(restored),saved);
  }
});

test('queued, current and standby descriptors survive; unsupported handlers and corrupt state keep old context',()=>{
  const old=switchFinishContext(),q=old.continuation;
  q.currentPhase=q.phaseQueue.shift();q.standbyPhase=q.phaseQueue.shift();
  q.phaseQueuePrepend=[{kind:'post-summon',fieldIndex:0,pokemonId:100}];q.phaseQueuePrependSpliceIndex=1;
  q.nextCommandPhaseQueue=[{kind:'turn-init'}];
  const saved=codec.capture(old);assert.deepEqual(codec.capture(codec.restore(saved)),saved);
  assert.throws(()=>advanceContinuation(old,codec,{'switch-finish':{start:finishHandler}}),/HANDLER_UNAVAILABLE/);
  const resumed=advanceContinuation(old,codec,{'switch-finish':{resume:finishHandler}});
  assert.equal(resumed.context.continuation.currentPhase.pokemonId,101);
  assert.equal(resumed.context.continuation.standbyPhase,null);
  const finished=advanceContinuation(resumed.context,codec,{'switch-finish':{resume:finishHandler}});
  assert.equal(finished.context.continuation.currentPhase,null);
  assert.throws(()=>advanceContinuation(finished.context,codec,{}),/HANDLER_UNAVAILABLE/);
  assert.throws(()=>advanceContinuation(old,codec,{'switch-finish':{resume:c=>{c.players[0].money=-1;return [];}}}),/INVALID_MONEY/);
  assert.throws(()=>advanceContinuation(old,codec,{'switch-finish':{resume:(c,d)=>{finishHandler(c,d);throw Error('after-transfer');}}}),/after-transfer/);
  for(const mutate of [s=>{s.continuation.phaseQueuePrependSpliceIndex=5;},s=>{s.continuation.currentPhase.outgoingId=111;},s=>{s.continuation.phaseQueue.push(copy(s.continuation.currentPhase));},s=>{s.continuation.currentPhase.pokemonId=110;s.continuation.currentPhase.outgoingId=100;},s=>{s.continuation.currentPhase.kind='animation';},s=>{s.continuation.currentPhase.extra=true;},s=>{s.version=3;}]){
    const bad=copy(saved);mutate(bad);const before=copy(bad);assert.throws(()=>codec.restore(bad));assert.deepEqual(bad,before);
  }
  assert.deepEqual(codec.capture(old),saved);
});
