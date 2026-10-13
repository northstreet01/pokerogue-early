import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parse} from './helpers/original-model.mjs';
import {getFieldOrder,getMoveOrder} from '../src/battle-core/turn-order.mjs';
import {RandomDataGenerator,nextBattleRandomInt} from '../src/battle-core/random.mjs';

const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/early-turn-order-reference.json',import.meta.url),'utf8'));
const method=(cls,name)=>parse('phases.ts').statements.find(n=>ts.isClassDeclaration(n)&&n.name.text===cls).members.find(n=>n.name?.getText()===name).getText();
function model(seed,speeds,commands,reversed,modern) {
  const trace=[], phases=[], random={state:null};
  const field=speeds.map((speed,index)=>({id:index,speed,isActive:()=>speed!==null,isPlayer:()=>index<2,
    getFieldIndex:()=>index%2,getBattlerIndex:()=>index,getBattleStat(){trace.push(['speed',index]);return speed;},
    getMoveset:()=>[{moveId:1},{moveId:2},{moveId:3}]}));
  const moves={1:{priority:0},2:{priority:1},3:{priority:-1}};
  class Phase {constructor(...args){this.args=args;} start(){} end(){}}
  const phase=(name)=>class extends Phase {constructor(...args){super(...args);this.kind=name;}};
  const scene={getPlayerField:()=>field.slice(0,2),getEnemyField:()=>field.slice(2),getField:()=>field,
    currentBattle:{turnCommands:commands,randSeedInt(range){const next=nextBattleRandomInt(seed,1,random.state,range);random.state=next.state;trace.push(['random',next.value]);return next.value;}},
    arena:{applyTags(_,holder){trace.push(['trickRoom']);holder.value=reversed;}},
    pushPhase(p){phases.push([p.kind,p.args[1]?.id??p.args[1]]);},unshiftPhase(p){phases.unshift([p.kind,p.args[1]?.id??p.args[1]]);}};
  const sandbox={exports:{},getFieldOrder,getMoveOrder,Utils:{BooleanHolder:class {constructor(v){this.value=v;}},IntegerHolder:class {constructor(v){this.value=v;}}},
    BattlePhase:Phase,Stat:{SPD:5},TrickRoomTag:class{},BattlerIndex:{ENEMY:2},Command:{FIGHT:0,BALL:1,POKEMON:2,RUN:3},allMoves:moves,
    IncrementMovePriorityAbAttr:class{},applyAbAttrs(_,pokemon,__,move,holder){trace.push(['priority',pokemon.id,holder.value]);if(pokemon.id===1)holder.value++;},
    MovePhase:phase('move'),AttemptCapturePhase:phase('capture'),SwitchSummonPhase:phase('switch'),AttemptRunPhase:phase('run'),
    WeatherEffectPhase:phase('weather'),PostTurnStatusEffectPhase:phase('status'),TurnEndPhase:phase('end'),PokemonMove:class{constructor(moveId){this.moveId=moveId;}}};
  const source=`class FieldPhase extends BattlePhase { ${modern?method('FieldPhase','getOrder'):frozen.fieldOrder} }
    class TurnStart extends FieldPhase { ${modern?method('TurnStartPhase','start'):frozen.turnStart} }
    exports.make = scene => { const phase = new TurnStart(); phase.scene=scene; return phase; };`;
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,sandbox);
  return {run(){sandbox.exports.make(scene).start();return JSON.parse(JSON.stringify({phases,trace,state:random.state}));}};
}

test('actual single-player phase wiring matches frozen early order, callbacks and random draws',()=>{
  for(const seed of ['a','b','中文'])for(const reversed of [false,true])for(const speeds of [[10,10,10,10],[1,20,5,20],[null,2,3,null],[0,0,0,0]]){
    for(const kinds of [[0,0,0,0],[0,1,2,3],[2,0,0,1]]){
      const commands=Object.fromEntries(kinds.map((command,i)=>[i,{command,cursor:0,move:{move:1+i%3,targets:[2],ignorePP:false},targets:[2],args:[false]}]));
      assert.deepEqual(model(seed,speeds,commands,reversed,true).run(),model(seed,speeds,commands,reversed,false).run());
    }
  }
});

test('turn order room streams interleave and resume without touching global RNG',()=>{
  function room(seed,state){return {rng:new RandomDataGenerator(state??[seed]),field:[0,1,2,3].map(id=>({id,isActive:()=>true}))};}
  const sort=r=>getFieldOrder(r.field.slice(0,2),r.field.slice(2),{getSpeed:()=>10,randomInt:n=>r.rng.integerInRange(0,n-1),isReversed:()=>false,getIndex:p=>p.id});
  const a=room('a'),b=room('b');sort(a);sort(b);
  const resumedA=room('ignored',a.rng.state()),resumedB=room('ignored',b.rng.state());
  for(let i=0;i<50;i++){const expectedA=sort(a),expectedB=sort(b);assert.deepEqual(sort(resumedB),expectedB);assert.deepEqual(sort(resumedA),expectedA);}
  assert.equal(a.rng.state(),resumedA.rng.state());assert.equal(b.rng.state(),resumedB.rng.state());
});
