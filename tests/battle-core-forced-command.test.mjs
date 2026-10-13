import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parse, pokemon, battler} from './helpers/original-model.mjs';
import {codec, initialDecision} from './helpers/decision-model.mjs';
import {prepareQueuedFight, selectEncoreFight} from '../src/battle-core/forced-command.mjs';
import {resolveFightIntent} from '../src/battle-core/fight-command.mjs';

const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/early-forced-command-reference.json',import.meta.url),'utf8'));
const cls=parse('phases.ts').statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='CommandPhase');
const method=name=>cls.members.find(n=>n.name?.getText()===name).getText();
function compile(start,override){
  const sandbox={exports:{},prepareQueuedFight,selectEncoreFight,EncoreTag:class{},Command:{FIGHT:0,BALL:1,RUN:3},Mode:{COMMAND:0},
    FieldPhase:class{start(){}end(){this.trace.push(['end']);}}};
  vm.runInNewContext(ts.transpileModule(`class Phase extends FieldPhase {${start} ${override}
    getPokemon(){return this.pokemon;} handleCommand(...args){this.trace.push(['command',...args]);}}
    exports.Phase=Phase;`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,sandbox);
  return sandbox.exports.Phase;
}
const Original=compile(frozen.start,frozen.override),Current=compile(method('start'),method('checkFightOverride'));
function run(Phase,queue,usable,tag){
  const trace=[],q=structuredClone(queue),moves=[33,57].map((moveId,i)=>({moveId,isUsable(_,ignore){trace.push(['usable',i,ignore]);return ignore||usable[i];}}));
  const p={getMoveQueue:()=>q,getMoveset(){trace.push(['moveset']);return moves;},getTag:()=>tag};
  const phase=new Phase();phase.fieldIndex=0;phase.trace=trace;phase.pokemon=p;
  phase.scene={getPlayerField:()=>[p],currentBattle:{turnCommands:{}},ui:{setMode:(...args)=>trace.push(['ui',...args])}};
  phase.start();const override=phase.checkFightOverride();
  return JSON.parse(JSON.stringify({trace,queue:q,override}));
}
test('actual queued/Encore Phase paths match original queue edits, internal args and method order',()=>{
  const queues=[[],[{move:0,targets:[]}],[{move:999,targets:[2]}],[{move:33,targets:[2]}],
    [{move:33,targets:[2],ignorePP:true}],[{move:33,targets:[2]},{move:57,targets:[2,3]}],
    [{move:999,targets:[2]},{move:0,targets:[]}]];
  for(const queue of queues)for(const usable of [[true,true],[false,true],[true,false],[false,false]])for(const tag of [null,{moveId:33},{moveId:57},{moveId:999}])
    assert.deepEqual(run(Current,queue,usable,tag),run(Original,queue,usable,tag));
});
test('original queued state restores, prunes unusable heads and retains the next valid action without PP cost',()=>{
  const ctx=initialDecision(),p=ctx.roster.entries[0].pokemon;
  p.summonData.moveset=[new pokemon.PokemonMove(33,0,0),new pokemon.PokemonMove(57,0,0)];
  p.summonData.disabledMove=33;p.summonData.moveQueue=[{move:33,targets:[2]},{move:57,targets:[2,3],ignorePP:true}];
  const restored=codec.restore(codec.capture(ctx)),rp=restored.roster.entries[0].pokemon;
  assert.deepEqual(prepareQueuedFight(rp),prepareQueuedFight(p));
  assert.equal(rp.getMoveQueue().length,1);assert.equal(rp.getMoveQueue()[0].move,57);
  assert.deepEqual(codec.capture(restored),codec.capture(ctx));assert.ok(rp.getMoveset().every(m=>m.ppUsed===0));
});
test('network intent enforces original Encore selection and fails closed without the rule provider',()=>{
  const ctx=initialDecision(),p=ctx.roster.entries[0].pokemon;
  p.summonData.moveset=[new pokemon.PokemonMove(33,0,0),new pokemon.PokemonMove(57,0,0)];
  p.summonData.moveQueue=[];p.summonData.disabledMove=0;
  const rules={fightCommand:0,noneMove:0,struggleMove:165,getEncoreTag:p=>p.getTag(battler.EncoreTag),getMoveTargets:()=>({targets:[2],multiple:false})};
  const input={kind:'fight',pokemonId:p.id,cursor:0,target:null},before=codec.capture(ctx);
  assert.throws(()=>resolveFightIntent(p,0,input,rules),/FORCED_MOVE_REQUIRED/);
  assert.equal(resolveFightIntent(p,0,{...input,cursor:1},rules).move.move,57);
  assert.throws(()=>resolveFightIntent(p,0,input,{...rules,getEncoreTag:undefined}),/FORCED_RULES_UNAVAILABLE/);
  assert.deepEqual(codec.capture(ctx),before);
  p.summonData.disabledMove=57;
  assert.equal(selectEncoreFight(p,rules.getEncoreTag),null);
});
