import fs from 'node:fs';
import ts from 'typescript';
import {parse,read,evaluate,pokemon,installPokemonTestDependencies,arena,moves} from './original-model.mjs';
import {actionContext,bindAction,abilityRules,moveRules,common,utils,hitRules,compileReference} from './move-execution-model.mjs';
import {originalPhases,installPhaseTestDependencies,phaseCodec} from './phase-model.mjs';
import {codec} from './decision-model.mjs';
import {modifiers} from './modifier-model.mjs';
import {advanceQueuedMoveEffect} from "./reference-rules/move-effect-runner.mjs";
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';

Object.assign(utils,evaluate(parse('utils.ts').statements.filter(n=>ts.isFunctionDeclaration(n)&&['executeIf','getEnumValues'].includes(n.name?.text)).map(n=>n.getText()).join('\n')));
const types=evaluate(read('data/type.ts'),{'./enums/biome':{},'./enums/moves':moves,'../utils':utils});
const temp=evaluate(parse('data/temp-battle-stat.ts').statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n'));
const i18n={default:{t:(key,args)=>`${key}:${JSON.stringify(args??{})}`}};
installPokemonTestDependencies({'../data/type':types,'../modifier/modifier':modifiers,'../data/temp-battle-stat':temp,
  '../data/arena-tag':arena,'../data/enums/arena-tag-type':common['./enums/arena-tag-type'],
  '../data/weather':common['./weather'],'../data/terrain':common['./terrain'],
  '../phases':originalPhases,'../utils':utils,'../i18n':i18n});
installPhaseTestDependencies({'./utils':utils,'./data/ability':abilityRules});
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-move-effect-reference.json',import.meta.url),'utf8'));
export const damageRules={...hitRules,...moveRules,...abilityRules,...types,...arena,...temp,...modifiers,...common['./pokemon-stat'],console:{log(){}},DamageAchv:class{}};
export const originalPokemonApply=compileReference(frozen.pokemonApply,'source,battlerMove',damageRules);
export const originalEffectStart=compileReference(frozen.effectStart,'',{...damageRules,MoveAnim:class{play(_scene,done){done();}}});
const originalEffectEnd=compileReference(frozen.effectEnd.replace('super.end();','this.scene.shiftPhase();'),'',damageRules);

export function effectContext(seat=0,moveId=moves.Moves.TACKLE,seed='effect'){
  const c=codec.restore(codec.capture(actionContext(seat,seed)));
  for(const {pokemon:p}of c.roster.entries){p.summonData.types=null;p.turnData=new pokemon.PokemonTurnData();p.battleSummonData.moveHistory=[];
    if(!p.isPlayer()){p.bossSegments=0;p.bossSegmentIndex=0;}}
  const p=c.roster.entries[seat].pokemon;p.moveset[0]=new pokemon.PokemonMove(moveId,0,0,false);
  c.battle.turnCommands[seat].move.move=moveId;
  const phase=new originalPhases.MoveEffectPhase({},seat,c.battle.turnCommands[seat].move.targets,p.moveset[0]);
  c.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase:phaseCodec.capture(phase,c,seat),remaining:'start'}];
  c.decision.id='effect-before';return c;
}
export function runDamage(c,seat=0,reference=false){
  const p=c.roster.entries[seat].pokemon,t=c.roster.entries[2].pokemon,phase=new originalPhases.MoveEffectPhase({},seat,[2],p.moveset[0]),binding=bindAction(c,phase);
  p.turnData.hitsLeft=1;p.turnData.hitCount=1;
  try{return {result:reference?originalPokemonApply.call(t,p,p.moveset[0]):t.apply(p,p.moveset[0]),events:binding.events};}
  finally{binding.dispose();}
}

export async function runEffect(context,{reference=false,clone=true,onBind,bindModifiers}={}){
  const c=clone?codec.restore(codec.capture(context)):context,descriptor=selectNextPhase(c.continuation,()=>{throw Error('Empty effect queue');}).phase,phase=descriptor.phase,b=bindAction(c,phase);
  let finish;const ended=new Promise(resolve=>{finish=resolve;});b.scene.shiftPhase=()=>finish();b.scene.ruleTasks=createRuleTaskTracker(b.scene);
  installPhaseTestDependencies({'./data/battle-anims':{MoveAnim:class{play(_scene,done){done();}}}});
  if(reference)Object.defineProperty(phase,'end',{value:originalEffectEnd,configurable:true});
  let modifierBinding;
  try{modifierBinding=bindModifiers?.(c,phase,b,b.scene.ruleTasks);onBind?.(c,phase,b);
    if(reference)originalEffectStart.call(phase);else phase.start();await ended;
    await (modifierBinding?.drain()??b.scene.ruleTasks.drain());
  }finally{modifierBinding?.dispose();if(reference)delete phase.end;delete phase.hitCheck;b.scene.ruleTasks.close();b.dispose();}
  c.continuation.currentPhase=null;c.decision.id='effect-after';codec.capture(c);return {context:c,events:b.events,grants:[]};
}

export function actionEffectContext(seat=0){
  const c=effectContext(seat),p=c.roster.entries[seat].pokemon;
  const phase=new originalPhases.MovePhase({},p,c.battle.turnCommands[seat].move.targets,p.moveset[0]);
  c.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase:phaseCodec.capture(phase,c,seat),remaining:'start'}];
  c.decision.id='action-before';return c;
}

export const nativeEffectDriver={supports:(_c,p)=>Object.getPrototypeOf(p)===originalPhases.MoveEffectPhase.prototype,
  async execute(c,phase,{bindModifiers}={}){const b=bindAction(c,phase);let finish;const ended=new Promise(resolve=>{finish=resolve;});
    b.scene.shiftPhase=()=>finish();b.scene.ruleTasks=createRuleTaskTracker(b.scene);
    installPhaseTestDependencies({'./data/battle-anims':{MoveAnim:class{play(_scene,done){done();}}}});
    let modifierBinding;
    try{modifierBinding=bindModifiers?.(c,phase,b,b.scene.ruleTasks);phase.start();await ended;
      await (modifierBinding?.drain()??b.scene.ruleTasks.drain());
      return {completed:true,pendingTasks:b.scene.ruleTasks.pendingTasks,events:b.events,grants:[]};}
    finally{modifierBinding?.dispose();b.scene.ruleTasks.close();b.dispose();}
  }};
export const advanceEffect=c=>advanceQueuedMoveEffect(c,codec,nativeEffectDriver);
