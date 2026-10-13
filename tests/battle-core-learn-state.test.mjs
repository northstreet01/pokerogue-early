import { learningContext } from './helpers/learn-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { codec, initialDecision } from './helpers/decision-model.mjs';
import { pokemon, parse } from './helpers/original-model.mjs';
import { inspectLearnMove, createLearnDecision, resolveLearnIntent } from '../src/battle-core/learn-command.mjs';
import { copy } from '../src/battle-core/coop-contract.mjs';


test('learning stop restores full moves and original forget/relearn sequence, including transformed aliases', () => {
  const initial = learningContext(), saved = codec.capture(initial);
  for (const slot of [0,1,2,3,null]) {
    const a = codec.restore(saved), b = codec.restore(copy(saved));
    for (const ctx of [a,b]) {
      const action={kind:'learn-move',pokemonId:100,slot};
      codec.validateAction(ctx,0,action);
      const continuation = resolveLearnIntent(ctx,0,action,id=>id===57);
      const p = ctx.roster.entries[0].pokemon;
      if (slot !== null) {
        assert.deepEqual(continuation,{kind:'forget-and-relearn',pokemonId:100,slot,moveId:57});
        p.setMove(slot,0); // Original confirmed replacement, before queued LearnMovePhase.
        const next = inspectLearnMove(p,57);
        assert.deepEqual(next,{kind:'automatic',slot});
        p.setMove(next.slot,57); // Original automatic learning branch, not its form hooks.
        assert.equal(p.moveset[slot],p.summonData.moveset[slot]);
        assert.equal(p.moveset[slot].ppUsed,0);
      } else assert.deepEqual(continuation,{kind:'end'});
      ctx.decision=initialDecision().decision;
    }
    assert.deepEqual(codec.capture(a),codec.capture(b));
  }
  assert.deepEqual(codec.capture(initial),saved);
});
test('learning checkpoints reject unknown moves, non-owner input and forged learning state', () => {
  const context=learningContext(), before=codec.capture(context);
  for(const mutate of [s=>{s.decision.learn.moveId=999;},s=>{s.decision.learn.pokemonId=101;},s=>{s.decision.requiredSeats=[1];},s=>{s.decision.options[0][0].slot=4;}]) {
    const s=copy(before);mutate(s);assert.throws(()=>codec.restore(s));assert.deepEqual(codec.capture(context),before);
  }
  assert.throws(()=>resolveLearnIntent(context,1,{kind:'learn-move',pokemonId:100,slot:0},()=>true),/INVALID_LEARN_OWNER/);
});

const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/early-learn-command-reference.json',import.meta.url),'utf8')).source;
const actual=parse('phases.ts').statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='LearnMovePhase').getText();
function branch(source, moves, moveId) {
  const ast=ts.createSourceFile('phase.ts',source,ts.ScriptTarget.Latest,true);
  const start=ast.statements[0].members.find(m=>m.name?.text==='start');
  // Stop before presentation. Test the exact current Phase statements against
  // the frozen original branch rather than duplicating the new helper logic.
  const cut=start.body.statements.findIndex(s=>s.getText().startsWith('const messageMode'));
  const statements=start.body.statements.slice(1,cut).map(s=>s.getText()).join('\n');
  const result={};
  vm.runInNewContext(ts.transpileModule(`result.run=function(){${statements};return {kind:'slot',slot:emptyMoveIndex};}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
    {result,inspectLearnMove,allMoves:{[moveId]:{id:moveId}}});
  return result.run.call({moveId,getPokemon:()=>({getMoveset:()=>moves}),end:()=>({kind:'end'})});
}
test('actual LearnMovePhase branches match frozen original for known, empty, full and null slots',()=>{
  for(const moves of [[],[33],[33,57],[33,null,33,33],[33,33,33,33]]) for(const moveId of [33,57]) {
    const input=moves.map(id=>id===null?null:{moveId:id});
    assert.equal(JSON.stringify(branch(actual,input,moveId)),JSON.stringify(branch(frozen,input,moveId)));
  }
});
