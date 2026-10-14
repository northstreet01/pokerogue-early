import ts from 'typescript';
import fs from 'node:fs';
import {parse,evaluate,read,pokemon,installPokemonTestDependencies,moveCatalog,status,battler,moves,weather,terrain} from './original-model.mjs';
import {originalPhases,installPhaseTestDependencies,phaseCodec,formModule} from './phase-model.mjs';
import {initialDecision,codec} from './decision-model.mjs';
import {modifiers} from './modifier-model.mjs';
import {advanceQueuedMoveAction} from '../../src/battle-core/move-action-runner.mjs';
import {prependPhase,pushPhase} from '../../src/battle-core/phase-queue.mjs';
import {observeRulePromise} from '../../src/battle-core/rule-task-tracker.mjs';

const enums=file=>evaluate(parse(file).statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n'));
const dependencyMap=file=>Object.fromEntries(parse(file).statements.filter(ts.isImportDeclaration).map(n=>[n.moduleSpecifier.text,{}]));
class Holder{constructor(value){this.value=value;}}
export const utils={IntegerHolder:Holder,NumberHolder:Holder,BooleanHolder:Holder};
const moveReference={};
export const common={
  '../battle-core/rule-task-tracker.mjs':{observeRulePromise},
  '../field/pokemon':pokemon,'../phases':originalPhases,'./enums/moves':moves,'./status-effect':status,'./battler-tags':battler,
  './type':enums('data/type.ts'),'../utils':utils,'./battle-stat':enums('data/battle-stat.ts'),
  './enums/battler-tag-type':enums('data/enums/battler-tag-type.ts'),'./enums/arena-tag-type':enums('data/enums/arena-tag-type.ts'),
  './weather':weather,'./terrain':terrain,'./pokemon-stat':enums('data/pokemon-stat.ts'),'./pokemon-forms':formModule,
  '../battle':enums('battle.ts'),'./battle-anims':enums('data/battle-anims.ts'),'../modifier/modifier':modifiers,
  '../system/localized-catalog':{catalogName:(_kind,_key,fallback)=>fallback,catalogDescription:(_kind,_key,fallback)=>fallback},
  '../messages':{getPokemonMessage:(p,s)=>`${p.id}${s}`,getPokemonNameWithAffix:p=>String(p.id)}
};
export const abilityRules=evaluate(read('data/ability.ts'),{...dependencyMap('data/ability.ts'),...common,'./move':moveReference});
export const moveRules=evaluate(read('data/move.ts'),{...dependencyMap('data/move.ts'),...common,'./ability':abilityRules});
Object.assign(moveReference,moveRules);moveRules.initMoves();abilityRules.initAbilities();
// Use full original move/ability catalogues in this suite, not fabricated PP or effects.
for(const [id,move]of moveRules.allMoves.entries())moveCatalog[id]=move;
installPokemonTestDependencies({'../data/move':moveRules,'../data/ability':abilityRules,'../battle':common['../battle']});
const phaseDependencies={
  './data/move':moveRules,'./data/ability':abilityRules,'./field/pokemon':pokemon,'./data/pokemon-forms':formModule,
  './data/battler-tags':battler,'./data/status-effect':status,'./data/enums/moves':moves,
  './data/battle-stat':common['./battle-stat'],'./data/enums/arena-tag-type':common['./enums/arena-tag-type'],
  './data/temp-battle-stat':enums('data/temp-battle-stat.ts'),
  './data/enums/battler-tag-type':common['./enums/battler-tag-type'],'./data/battle-anims':common['./battle-anims'],
  './modifier/modifier':modifiers,'./battle':common['../battle'],'./utils':utils,'./messages':common['../messages'],
  './data/terrain':terrain,'./i18n':{default:{t:(key,args)=>`${key}:${JSON.stringify(args??{})}`}}
};
installPhaseTestDependencies(phaseDependencies);
export const actionRules={...moveRules,...abilityRules,...pokemon,...status,...battler,...moves,...originalPhases,...common['../battle'],...common['./battle-anims'],
  ...common['./enums/battler-tag-type'],...formModule,...terrain,...common['../messages'],HiddenTag:battler.HideSpriteTag,Utils:utils,i18next:phaseDependencies['./i18n'].default};
export const hitRules={...actionRules,...common['./battle-stat'],...common['./enums/arena-tag-type'],...phaseDependencies['./data/temp-battle-stat'],...modifiers};
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-move-execution-reference.json',import.meta.url),'utf8'));
// Frozen original methods need lexical rule imports, not dependency stubs.
export function compileReference(method,args,rules){
  return evaluate(`const {${Object.keys(rules).filter(k=>/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)&&k!=='default').join(',')}}=require('rules');
    export function run(${args}){${method.slice(method.indexOf('{')+1,-1).replace('super.start();','')}}`,{rules}).run;
}
export const originalMoveStart=compileReference(frozen.moveStart,'',actionRules);
export const originalHitCheck=compileReference(frozen.hitCheck,'target',hitRules);

export function actionContext(seat=0,seed='move-execution'){
  const c=initialDecision(seed);
  for(const {pokemon:p}of c.roster.entries){p.status=null;p.fusionSpecies=null;p.summonData.speciesForm=null;p.summonData.fusionSpeciesForm=null;
    p.summonData.moveset=null;p.summonData.tags=[];p.summonData.moveQueue=[];p.summonData.disabledMove=0;p.summonData.battleStats.fill(0);}
  c.arena.weather=null;c.arena.terrain=null;c.players.forEach(p=>{p.modifiers=[];});
  const p=c.roster.entries[seat].pokemon,targets=[2];c.battle.turnCommands[seat]={command:0,cursor:0,move:{move:p.moveset[0].moveId,targets,ignorePP:false},args:[false]};
  const phase=new originalPhases.MovePhase({},p,targets,p.moveset[0]);
  c.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase:phaseCodec.capture(phase,c,seat),remaining:'start'}];
  c.decision={id:'action-before',kind:'continuing',requiredSeats:[],reason:'effects'};return c;
}

export function bindAction(c,phase,events=[]){
  const field=()=>c.roster.field.map(id=>c.roster.entries.find(e=>e.pokemon.id===id)?.pokemon);
  let ended=false;
  const scene={currentBattle:c.battle,gameMode:c.scene.gameMode,arena:c.arena,
    getPlayerField:()=>field().slice(0,2),getEnemyField:()=>field().slice(2).filter(Boolean),
    getField:active=>field().filter(p=>p&&(!active||p.isActive(true))),getPokemonById:id=>c.roster.entries.find(e=>e.pokemon.id===id)?.pokemon,
    field:{getIndex:p=>field().indexOf(p)},queueMessage:text=>events.push({kind:'message',text}),
    findModifier:()=>null,validateAchvs(){},gameData:{gameStats:{highestDamage:0}},
    triggerPokemonFormChange:p=>{events.push({kind:'form-check',pokemonId:p.id});return false;},
    applyModifiers(){},applyModifier(){return false;},setPhaseQueueSplice(){c.continuation.phaseQueuePrependSpliceIndex=c.continuation.phaseQueuePrepend.length;},
    clearPhaseQueueSplice(){c.continuation.phaseQueuePrependSpliceIndex=-1;},
    shiftPhase(){ended=true;},unshiftPhase(p){
      const ids=[...c.continuation.phaseQueue,...c.continuation.phaseQueuePrepend,...c.continuation.nextCommandPhaseQueue,c.continuation.currentPhase,c.continuation.standbyPhase].filter(Boolean).map(d=>d.phaseId);
      phaseCodec.capture(p,c,p.player?p.fieldIndex:null);
      prependPhase(c.continuation,{kind:'original-phase',phaseId:Math.max(0,...ids)+1,phase:p,remaining:'start'});
    }};
  scene.pushPhase=p=>{
    const ids=[...c.continuation.phaseQueue,...c.continuation.phaseQueuePrepend,...c.continuation.nextCommandPhaseQueue,c.continuation.currentPhase,c.continuation.standbyPhase].filter(Boolean).map(d=>d.phaseId);
    phaseCodec.capture(p,c,p.player?p.fieldIndex:null);
    pushPhase(c.continuation,{kind:'original-phase',phaseId:Math.max(0,...ids)+1,phase:p,remaining:'start'});
  };
  for(const {pokemon:p}of c.roster.entries){p.scene=scene;Object.defineProperties(p,{
    updateInfo:{value:()=>events.push({kind:'status-display',pokemonId:p.id}),configurable:true},setFrameRate:{value:()=>{},configurable:true}});}
  c.arena.scene=scene;phase.scene=scene;
  return {scene,events,get ended(){return ended;},dispose(){delete phase.scene;delete c.arena.scene;for(const {pokemon:p}of c.roster.entries){delete p.scene;delete p.updateInfo;delete p.setFrameRate;}}};
}

export function runAction(context,{reference=false,clone=true,onBind}={}){
  const c=clone?codec.restore(codec.capture(context)):context,descriptor=c.continuation.phaseQueue.shift(),phase=descriptor.phase;
  const binding=bindAction(c,phase);
  try{onBind?.(c,phase,binding);if(reference)originalMoveStart.call(phase);else phase.start();
    if(!binding.ended)throw Error('Original action did not reach its boundary');
  }finally{binding.dispose();}
  c.decision.id='action-after';codec.capture(c);return {context:c,events:binding.events,grants:[]};
}
export function runHitCheck(context,phase,targetId,reference=false){
  const b=bindAction(context,phase);let result;
  try{const target=context.roster.entries.find(e=>e.pokemon.id===targetId).pokemon;
    result=reference?originalHitCheck.call(phase,target):phase.hitCheck(target);
  }finally{b.dispose();}
  return {result,events:b.events};
}

export const nativeMoveDriver={supports:(_c,p)=>Object.getPrototypeOf(p)===originalPhases.MovePhase.prototype,
  execute(c,phase){const binding=bindAction(c,phase);
    try{phase.start();return {completed:binding.ended,events:binding.events,grants:[]};}finally{binding.dispose();}
  }};
export const advanceAction=c=>advanceQueuedMoveAction(c,codec,nativeMoveDriver);
