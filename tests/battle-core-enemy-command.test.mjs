import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parse } from './helpers/original-model.mjs';
import { selectEnemyCommand } from '../src/battle-core/enemy-command.mjs';
import { RandomDataGenerator } from '../src/battle-core/random.mjs';

const frozen = JSON.parse(fs.readFileSync(new URL('./fixtures/early-enemy-command-reference.json',import.meta.url),'utf8'));
const current = parse('phases.ts').statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='EnemyCommandPhase').members.find(n=>n.name?.getText()==='start').getText();
class TrappedTag {}
function compile(start) {
  const sandbox = {exports:{},selectEnemyCommand,TrappedTag,Utils:{BooleanHolder:class{constructor(value){this.value=value;}}},
    CheckTrappedAbAttr:class{},applyCheckTrappedAbAttrs(_,opponent,holder){opponent.trace.push(['ability',opponent.id]);holder.value ||= opponent.trapped;},
    FieldPhase:class{start(){this.scene.trace.push(['start']);}end(){this.scene.trace.push(['end']);}},Moves:{BATON_PASS:226},Command:{FIGHT:0,POKEMON:2},BattlerIndex:{ENEMY:2}};
  vm.runInNewContext(ts.transpileModule(`class EnemyPhase extends FieldPhase {${start}}; exports.Phase=EnemyPhase;`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,sandbox);
  return sandbox.exports.Phase;
}
const Original=compile(frozen.start), Current=compile(current);
function run(Phase,options,seed='enemy',state) {
  const trace=[],random=new RandomDataGenerator(state??[seed]);
  const opponents=[0,1].map(id=>({id,trace,trapped:options.trap==='ability'&&id===1}));
  const enemy={trainerSlot:1,summonData:{battleStats:[options.stat]},
    moveset:[{moveId:226,isUsable(){trace.push(['usable']);return options.baton;}}],
    getMoveQueue(){trace.push(['queue']);return options.queued?[{}]:[];},
    getOpponents(){trace.push(['opponents']);return opponents;},
    findTag(predicate){trace.push(['tag']);const tag=new TrappedTag();return options.trap==='tag'&&predicate(tag)?tag:null;},
    getNextTargets(move){trace.push(['targets',move]);return [random.integerInRange(0,1)];},
    getMatchupScore(opp){trace.push(['matchup',opp.id]);return 10;},
    getNextMove(){trace.push(['nextMove']);return {move:33,targets:[random.integerInRange(0,1)]};}};
  const trainer={config:{isBoss:options.boss},
    getPartyMemberMatchupScores(slot,include){trace.push(['scores',slot,include]);return options.score===null?[]:[[2,options.score]];},
    getSortedPartyMemberMatchupScores(scores){trace.push(['sort']);return scores;},
    getNextSummonIndex(slot,scores){trace.push(['summon',slot,scores[0][1]]);return 2+random.integerInRange(0,1);}};
  const scene={trace,getEnemyField:()=>[enemy,enemy],currentBattle:{trainer:options.trainer?trainer:null,turnCommands:{2:null,3:null}}};
  const phase=new Phase();phase.scene=scene;phase.fieldIndex=options.index??0;phase.start();
  return JSON.parse(JSON.stringify({trace,commands:scene.currentBattle.turnCommands,state:random.state()}));
}

test('actual EnemyCommandPhase matches frozen original decisions, method order and RNG consumption',()=>{
  for(const trainer of [false,true])for(const queued of [false,true])for(const trap of ['none','tag','ability'])
    for(const baton of [false,true])for(const stat of [-1,0])for(const boss of [false,true])for(const score of [null,19,20,29,30]) {
      const options={trainer,queued,trap,baton,stat,boss,score,index:1};
      assert.deepEqual(run(Current,options),run(Original,options),JSON.stringify(options));
    }
});

test('enemy command branches and saved room RNG continue independently',()=>{
  const base={trainer:true,queued:false,trap:'none',baton:false,stat:-1,boss:false,score:30};
  assert.equal(run(Current,base).commands[2].command,2);
  assert.equal(run(Current,{...base,score:29}).commands[2].command,0);
  assert.equal(run(Current,{...base,boss:true,score:20}).commands[2].command,2);
  assert.equal(run(Current,{...base,trap:'tag',baton:true}).commands[2].move.move,226);
  const a=run(Current,base,'a'),b=run(Current,{...base,queued:true},'b');
  assert.deepEqual(run(Current,base,'unused',a.state),run(Original,base,'unused',a.state));
  assert.deepEqual(run(Current,{...base,queued:true},'unused',b.state),run(Original,{...base,queued:true},'unused',b.state));
});
