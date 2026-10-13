import { switchContext } from './helpers/switch-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { codec, initialDecision } from './helpers/decision-model.mjs';
import { originalPokemon, parse } from './helpers/original-model.mjs';
import { createForcedSwitchDecision, resolveForcedSwitchIntent, selectSwitchSummon } from '../src/battle-core/switch-command.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';


test('forced replacements preserve dead actors, stable party ownership and both independent choices',()=>{
  const a=switchContext(),b=codec.restore(codec.capture(a));
  assert.deepEqual(b.decision,a.decision);
  for(const seat of [0,1]) {
    const choice=a.decision.options[seat][0];
    assert.deepEqual(resolveForcedSwitchIntent(a,seat,choice),resolveForcedSwitchIntent(b,seat,choice));
    assert.deepEqual(resolveForcedSwitchIntent(b,seat,choice),{fieldIndex:seat,pokemonId:110+seat,partyIndex:1,doReturn:false,batonPass:false});
    assert.throws(()=>resolveForcedSwitchIntent(b,seat,{kind:'forced-switch',pokemonId:120+seat}),/INVALID_SWITCH_ACTION/);
    assert.throws(()=>resolveForcedSwitchIntent(b,seat,a.decision.options[1-seat][0]),/INVALID_SWITCH_ACTION/);
  }
  const before=codec.capture(a);
  for(const mutate of [s=>{s.decision.switch.outgoing[0]=101;},s=>{s.decision.options[0][0].pokemonId=111;},s=>{s.decision.requiredSeats=[2];}]) {
    const s=copy(before);mutate(s);assert.throws(()=>codec.restore(s));assert.deepEqual(codec.capture(a),before);
  }
  b.roster.entries[0].pokemon.hp=1;
  assert.throws(()=>codec.capture(b),/INVALID_SWITCH_DECISION/);
});

const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/early-switch-command-reference.json',import.meta.url),'utf8')).source;
const actual=parse('phases.ts').statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='SwitchPhase').getText();
async function run(source,fieldIndex,slotIndex,count,modal,doReturn,option) {
  const calls=[],scene={currentBattle:{getBattlerCount:()=>count},getParty:()=>[{isFainted:()=>false,isActive:()=>true},{isFainted:()=>false,isActive:()=>false}],unshiftPhase:p=>calls.push(['summon',...p.args]),ui:{setMode(mode,...args){calls.push(['mode',mode]);if(mode===1)args[2](slotIndex,option);return Promise.resolve();}}};
  const result={};
  vm.runInNewContext(ts.transpileModule(source.replace('export class','class')+'\nresult.Phase=SwitchPhase;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
    {result,selectSwitchSummon,Mode:{PARTY:1,MESSAGE:0},PartyUiMode:{FAINT_SWITCH:0,POST_BATTLE_SWITCH:1},PartyOption:{PASS_BATON:2},PartyUiHandler:{FilterNonFainted:()=>true},BattlePhase:class{constructor(scene){this.scene=scene;}start(){}end(){calls.push(['end']);}},SwitchSummonPhase:class{constructor(scene,...args){this.args=args;}}});
  new result.Phase(scene,fieldIndex,modal,doReturn).start();await Promise.resolve();
  return JSON.stringify(calls);
}
test('actual SwitchPhase retains original slot bounds, return flags and baton selection',async()=>{
  assert.match(actual, /selectSwitchSummon\(/);
  for(const field of [0,1]) for(const slot of [0,1,2,5,6]) for(const count of [1,2]) for(const flag of [false,true]) for(const option of [0,2])
    assert.equal(await run(actual,field,slot,count,flag,flag,option),await run(frozen,field,slot,count,flag,flag,option));
});
