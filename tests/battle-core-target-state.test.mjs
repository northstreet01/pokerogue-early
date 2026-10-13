import { targetContext } from './helpers/target-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { codec } from './helpers/decision-model.mjs';
import { parse } from './helpers/original-model.mjs';
import { captureTurnCommands, restoreTurnCommands } from '../src/battle-core/command-state.mjs';
import { resolveTargetIntent, applyTargetSelection } from '../src/battle-core/target-command.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';


test('queued move awaiting target preserves original optional command fields and queue without rerunning preparation', () => {
  const ctx = targetContext(), before = codec.capture(ctx), restored = codec.restore(copy(before));
  assert.deepEqual(restored.battle.turnCommands, ctx.battle.turnCommands);
  assert.deepEqual(codec.capture(restored), before);
  const queue = restored.roster.entries[0].pokemon.getMoveQueue();
  assert.equal(queue.length, ctx.roster.entries[0].pokemon.getMoveQueue().length);
  for (const c of [ctx, restored]) {
    const choice = c.decision.options[0][1];
    const cursor = resolveTargetIntent(c, 0, choice, () => ({targets:[2,3],multiple:false}));
    applyTargetSelection(c.battle.turnCommands, 0, cursor, {ballCommand:1,requeueCommand:()=>assert.fail()});
    c.decision = {id:'other-player',kind:'wait-actions',requiredSeats:[1],options:{1:[{kind:'fight',pokemonId:101}]}};
  }
  assert.deepEqual(codec.capture(restored), codec.capture(ctx));
  assert.deepEqual(restored.battle.turnCommands[0].targets, [3]);
  assert.deepEqual(restored.battle.turnCommands[0].move.targets, []);
  assert.throws(() => codec.validateAction(restored, 0, {kind:'fight',pokemonId:100}), /INVALID_ACTION/);
});

test('target corruption, stale legal targets and unknown commands fail before changing committed state', () => {
  const ctx = targetContext(), before = codec.capture(ctx);
  for (const mutate of [s=>{s.decision.target.pokemonId=101;},s=>{s.decision.target.moveId=33;},s=>{s.decision.target.targets=[0,9];},s=>{s.decision.options[0].push({kind:'target',pokemonId:100,target:1});},s=>{s.battle.turnCommands[0]=null;},s=>{s.version=2;}]) {
    const s = copy(before); mutate(s); assert.throws(()=>codec.restore(s)); assert.deepEqual(codec.capture(ctx), before);
  }
  assert.throws(()=>resolveTargetIntent(ctx,0,ctx.decision.options[0][0],()=>({targets:[1,2],multiple:false})),/STALE_TARGET_DECISION/);
  assert.deepEqual(codec.capture(ctx),before);
  const commands = {'-1':null,0:{command:0,cursor:0,move:{move:57,targets:[],ignorePP:undefined},args:[undefined]},1:null,2:null,3:null};
  assert.deepEqual(restoreTurnCommands(captureTurnCommands(commands)),commands);
  commands[0].move.targets = [-1]; // Original Counter/Mirror Coat attacker sentinel.
  assert.deepEqual(restoreTurnCommands(captureTurnCommands(commands)),commands);
  const malformed = [c=>{c[0].args=[()=>{}];}, c=>{c[0].args=Array(1);},c=>{c[0].move.targets=[8];},c=>{c[0].command=4;},c=>{Object.defineProperty(c[0],'evil',{enumerable:true,get:()=>assert.fail('getter invoked')});}];
  for (const mutate of malformed) { const c = restoreTurnCommands(captureTurnCommands(commands)); mutate(c); assert.throws(()=>captureTurnCommands(c)); }
});

const frozen = JSON.parse(fs.readFileSync(new URL('./fixtures/early-target-command-reference.json',import.meta.url),'utf8')).source;
const actual = parse('phases.ts').statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='SelectTargetPhase').getText();
function run(source, fieldIndex, cursor, command, replace = false) {
  const commands = {'-1':null,0:{command:0,move:{move:33,targets:[]}},1:null,2:null,3:null};
  commands[fieldIndex] = command;
  const calls = [], scene={currentBattle:{turnCommands:commands},unshiftPhase:p=>calls.push(['command',p.fieldIndex]),ui:{setMode(mode,...args){calls.push(['mode',mode]); if(mode===1) { if(replace)commands[fieldIndex]={command:0,move:{move:33,targets:[]}};args[2](cursor);}}}};
  const result = {};
  vm.runInNewContext(ts.transpileModule(source.replace('export class','class')+'\nresult.Phase=SelectTargetPhase;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
    {result,applyTargetSelection,Command:{BALL:1},Mode:{TARGET_SELECT:1,MESSAGE:0},PokemonPhase:class{constructor(scene,index){this.scene=scene;this.fieldIndex=index;}start(){}end(){calls.push(['end']);}},CommandPhase:class{constructor(scene,index){this.fieldIndex=index;}}});
  new result.Phase(scene,fieldIndex).start();
  return JSON.parse(JSON.stringify({commands,calls,selectedCommand:command}));
}
test('actual SelectTargetPhase still matches frozen original callback including cancellation and ball skip ordering',()=>{
  for(const field of [0,1]) for(const cursor of [-1,0,1,2,3]) for(const command of [{command:0,move:{move:57,targets:[]}},{command:1,cursor:0,targets:[2]}]) {
    assert.deepEqual(run(actual,field,cursor,copy(command)),run(frozen,field,cursor,copy(command)));
    assert.deepEqual(run(actual,field,cursor,copy(command),true),run(frozen,field,cursor,copy(command),true));
  }
});
