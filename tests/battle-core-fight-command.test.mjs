import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parse, originalPokemon, battler } from './helpers/original-model.mjs';
import { selectFightCommand, resolveFightIntent } from '../src/battle-core/fight-command.mjs';
import { codec, initialDecision } from './helpers/decision-model.mjs';

const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/early-fight-command-reference.json',import.meta.url),'utf8'));
const current=parse('phases.ts').statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='CommandPhase').members.find(n=>n.name?.getText()==='handleCommand').getText();
function compile(method) {
  const sandbox={exports:{},selectFightCommand,Command:{FIGHT:0},Moves:{NONE:0,STRUGGLE:165},Mode:{MESSAGE:0,FIGHT:1},
    console:{log(){}},i18next:{t:k=>k},SelectTargetPhase:class{constructor(scene,index){this.index=index;}},
    getMoveTargets(pokemon,move){pokemon.trace.push(['targets',move]);return pokemon.targetSet;}};
  vm.runInNewContext(ts.transpileModule(`class Phase {${method} end(){this.scene.trace.push(['end']);}}; exports.Phase=Phase;`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,sandbox);
  return sandbox.exports.Phase;
}
const Original=compile(frozen.handleCommand),Current=compile(current);
function run(Phase,cursor,args,usable,targetSet){
  const trace=[], moves=usable.map((value,index)=>({moveId:33+index,ppUsed:0,isUsable(_,ignore){trace.push(['usable',index,ignore]);return ignore||value;},getName:()=>String(index)}));
  const pokemon={trace,targetSet,summonData:{disabledMove:33},getMoveset(){trace.push(['moveset']);return moves;},
    trySelectMove(index,ignore){trace.push(['select',index,ignore]);return moves[index]?.isUsable(this,ignore);}};
  const scene={trace,getPlayerField:()=>[pokemon,pokemon],getEnemyField:()=>[],currentBattle:{turnCommands:{}},
    unshiftPhase:p=>trace.push(['targetPhase',p.index]),ui:{setMode:mode=>trace.push(['mode',mode]),showText:text=>trace.push(['text',text])}};
  const phase=new Phase();phase.scene=scene;phase.fieldIndex=1;
  const result=phase.handleCommand(0,cursor,...args);
  assert.ok(moves.every(m=>m.ppUsed===0));
  return JSON.parse(JSON.stringify({result,trace,commands:scene.currentBattle.turnCommands}));
}
test('actual player FIGHT branch preserves original selection, Struggle, overrides and target prompts',()=>{
  const sets=[{targets:[],multiple:false},{targets:[2],multiple:false},{targets:[2,3],multiple:false},{targets:[2,3],multiple:true}];
  for(const cursor of [-1,0,1,2])for(const usable of [[true,true],[false,true],[true,false],[false,false]])for(const targets of sets)
    for(const args of [[],[false],[true],[false,{targets:[0],multiple:false}],[false,null,{targets:[0],multiple:false}]]) {
      assert.deepEqual(run(Current,cursor,args,usable,targets),run(Original,cursor,args,usable,targets));
    }
});
test('network fight intent rejects forged internal flags, wrong instance, cursor and target without consuming PP',()=>{
  const pokemon=originalPokemon();pokemon.summonData.moveQueue=[];pokemon.summonData.disabledMove=0;
  const rules={fightCommand:0,noneMove:0,struggleMove:165,getEncoreTag:p=>p.getTag(battler.EncoreTag),getMoveTargets:()=>({targets:[2,3],multiple:false})};
  const intent={kind:'fight',pokemonId:pokemon.id,cursor:0,target:3};
  const before=pokemon.getMoveset().map(m=>m.ppUsed);
  const command=resolveFightIntent(pokemon,0,intent,rules);
  assert.deepEqual(command.targets,[3]);assert.equal(command.move.ignorePP,false);
  for(const patch of [{pokemonId:101},{cursor:-1},{cursor:99},{target:0},{target:null},{ignorePP:true},{args:[true]}])
    assert.throws(()=>resolveFightIntent(pokemon,0,{...intent,...patch},rules));
  assert.deepEqual(pokemon.getMoveset().map(m=>m.ppUsed),before);
  pokemon.summonData.moveQueue=[{move:57,targets:[2]}];
  assert.throws(()=>resolveFightIntent(pokemon,0,intent,rules),/UNSUPPORTED_FORCED_COMMAND/);
});
test('restored original Pokemon resolves the same fight and spread-target commands',()=>{
  const ctx=initialDecision();const p=ctx.roster.entries[0].pokemon;p.summonData.moveQueue=[];p.summonData.disabledMove=0;
  const saved=codec.capture(ctx),restored=codec.restore(saved).roster.entries[0].pokemon;
  const intent={kind:'fight',pokemonId:p.id,cursor:0,target:null};
  const rules={fightCommand:0,noneMove:0,struggleMove:165,getEncoreTag:p=>p.getTag(battler.EncoreTag),getMoveTargets:()=>({targets:[2,3],multiple:true})};
  assert.deepEqual(resolveFightIntent(restored,0,intent,rules),resolveFightIntent(p,0,intent,rules));
  assert.deepEqual(codec.capture(ctx),saved);
});
