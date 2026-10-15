import fs from 'node:fs';
import ts from 'typescript';
import {codec,safeCodec} from './decision-model.mjs';
import {parse,read,evaluate,pokemon,species,moves,moveCatalog,installPokemonTestDependencies} from './original-model.mjs';
import {originalPhases,evolutionPhases,evolutionModule,evolutionCodec,phaseCodec,installPhaseTestDependencies,installEvolutionTestDependencies} from './phase-model.mjs';
import {experienceContext,advanceExperience,referenceExperience,experienceDriver,bindExperience,atExperienceEnd} from './experience-model.mjs';
import {compileReference,actionRules} from './move-execution-model.mjs';
import {nextPostPhase,BattleSpec} from './post-damage-model.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {advanceProgressionChoice} from '../../src/battle-core/progression-choice-runner.mjs';
import {createLearnDecision,inspectLearnMove} from '../../src/battle-core/learn-command.mjs';
import {applySafeDecisionAction} from '../../src/battle-core/safe-decisions.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {requireContract as check,copy} from '../../src/battle-core/coop-contract.mjs';

const enumOf=(file,name)=>evaluate(parse(file).statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n'))[name];
export const Mode=enumOf('ui/ui.ts','Mode');
const SummaryUiMode=enumOf('ui/summary-ui-handler.ts','SummaryUiMode');
class EvolutionSceneHandler {}
const LevelAchv=class {};
const levelMoves=evaluate(read('data/pokemon-level-moves.ts'),{'./enums/moves':moves,'./enums/species':{Species:enumOf('data/enums/species.ts','Species')}});
const speciesClass=parse('data/pokemon-species.ts').statements.find(n=>n.name?.text==='PokemonSpeciesForm');
const getLevelMoves=compileReference(speciesClass.members.find(n=>n.name?.text==='getLevelMoves').getText(),'',
  {...levelMoves,pokemonSpeciesFormLevelMoves:levelMoves.pokemonFormLevelMoves});
for(const s of species.values())s.getLevelMoves=getLevelMoves;
installPokemonTestDependencies({'../data/pokemon-evolutions':evolutionModule});
installPhaseTestDependencies({'./battle-core/learn-command.mjs':{inspectLearnMove},'./evolution-phase':evolutionPhases,
  './ui/ui':{Mode},'./ui/summary-ui-handler':{SummaryUiMode},'./ui/evolution-scene-handler':{default:EvolutionSceneHandler},
  './system/achv':{LevelAchv},'./data/battle-anims':{initMoveAnim:()=>Promise.resolve(),loadMoveAnimAssets:()=>Promise.resolve()}});
installEvolutionTestDependencies({'./ui/ui':{Mode}});
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-level-up-reference.json',import.meta.url),'utf8'));
const rules={...actionRules,...evolutionPhases,Mode,SummaryUiMode,EvolutionSceneHandler,LevelAchv,
  inspectLearnMove,initMoveAnim:()=>Promise.resolve(),loadMoveAnimAssets:()=>Promise.resolve()};
export const referenceLevelUp=compileReference(frozen.methods.LevelUpPhase.start,'',rules);
export const referenceLearnStart=compileReference(frozen.methods.LearnMovePhase.start,'',rules);
const referenceEndEvolution=compileReference(frozen.methods.EndEvolutionPhase.start,'',rules);
const ast=ts.createSourceFile('original.ts',`class C {${frozen.methods.LearnMovePhase.start}}`,ts.ScriptTarget.Latest,true);
let forgetCallback;
function visit(n){if(ts.isArrowFunction(n)&&n.parameters[0]?.name.getText(ast)==='moveIndex')forgetCallback=n;ts.forEachChild(n,visit);}visit(ast);
// Extract the accepted original UI callback (the cancellation guard is handled
// by the M2 slot:null choice). No new implementation is used as its reference.
const forgetStatements=forgetCallback.body.statements.slice(1).map(n=>n.getText(ast)).join('\n');
export const referenceForget=compileReference(`resume(){const pokemon=this.getPokemon();${forgetStatements}}`,'moveIndex,messageMode',rules);
const evoAst=ts.createSourceFile('original.ts',`class C {${frozen.methods.EvolutionPhase.doEvolution}}`,ts.ScriptTarget.Latest,true);
let evoThen,endQueue;
function findEvo(n){if(ts.isCallExpression(n)&&n.expression.getText(evoAst)==='this.pokemon.evolve(this.evolution).then')evoThen=n;
  if(!endQueue&&ts.isExpressionStatement(n)&&n.getText(evoAst)==='this.scene.unshiftPhase(new EndEvolutionPhase(this.scene));')endQueue=n;
  ts.forEachChild(n,findEvo);}findEvo(evoAst);
const evoRules=evoThen.arguments[0].body.statements.slice(0,3).map(n=>n.getText(evoAst)).join('\n');
export const referenceApplyEvolution=compileReference(`apply(){return this.pokemon.evolve(this.evolution).then(()=>{${evoRules}});}`,'',rules);
const referenceQueueEnd=compileReference(`queue(){${endQueue.getText(evoAst)}}`,'',rules);
const is=(p,name)=>p?.constructor===(originalPhases[name]??evolutionPhases[name]);
const isProgression=p=>['LevelUpPhase','LearnMovePhase','EvolutionPhase','EndEvolutionPhase'].some(n=>is(p,n));
const nextId=c=>`progression-${Number(c.decision.id.split('-').at(-1))+1}`;

export async function levelUpContext({seat=1,level=7,lastLevel=5,full=false,known=false,pause=false,share=false}={}){
  let c=await experienceContext({levelUp:true,share});
  while(!is(nextPostPhase(c),'LevelUpPhase'))c=(await advanceExperience(c)).context;
  const all=[...c.continuation.phaseQueuePrepend,...c.continuation.phaseQueue];
  const d=all.find(d=>is(d.phase,'LevelUpPhase'));check(d,'MISSING_LEVEL_UP');
  const pk=c.roster.entries.find(e=>e.owner===seat&&e.index===0).pokemon;
  // Controlled input levels; subsequent calculateStats/getLevelMoves/evolution
  // selection execute the original methods and original level-move catalogue.
  const other=c.roster.entries[1].pokemon;if(seat===0){other.level=5;other.exp=135;other.levelExp=10;}
  pk.level=level;pk.exp=level**3;pk.levelExp=0;pk.pauseEvolutions=pause;
  pk.moveset=(full?[33,57,45,73]:known?[33,57,74]:[33,57]).map(id=>new pokemon.PokemonMove(id));
  pk.summonData.moveset=null;
  d.phase=new originalPhases.LevelUpPhase({currentBattle:c.battle},0,lastLevel,level);phaseCodec.capture(d.phase,c,seat);
  return codec.restore(codec.capture(c));
}

// Bind only scene ownership, presentation completions and deferred collection
// hooks. Original Pokemon and Phase rules run unchanged on the candidate.
export async function runProgression(c,p,options={},operation='start',intent={}){
  const seat=phaseCodec.capture(p,c).scope;check(seat===0||seat===1,'INVALID_PROGRESSION_OWNER');
  const b=bindExperience(c,p,seat,options.reference),s=b.scene,tasks=createRuleTaskTracker(s),temporary=[];
  const define=(o,k,value)=>{temporary.push([o,k,Object.getOwnPropertyDescriptor(o,k)]);Object.defineProperty(o,k,{value,configurable:true});};
  let wake;const signal=new Promise(resolve=>wake=resolve),shift=s.shiftPhase;let suspended=false;
  s.shiftPhase=()=>{shift();wake();};
  const tracked=()=>{const task=Promise.resolve();tasks.add(task);return task;};
  const mode=()=>{const task=Promise.resolve();tasks.add(task);return task;};
  const message=(text,_delay,done)=>{b.events.push({kind:'progression-message',seat,text});done?.();};
  s.ui={showText:message,setMode:mode,setModeForceTransition:mode,getHandler:()=>({}),
    getMessageHandler:()=>({promptLevelUpStats:(index,previous)=>{b.events.push({kind:'level-stats',seat,index,previous:copy(previous)});return tracked();}}),
    setModeWithoutClear:(m,...callbacks)=>{
      check(m===Mode.CONFIRM,'UNSUPPORTED_PROGRESSION_UI');suspended=true;wake();
    }};
  s.playSoundWithoutBgm=()=>{};
  s.gameData={gameStats:{highestLevel:0},setPokemonSeen:pk=>b.events.push({kind:'seen-hook',seat,pokemonId:pk.id,speciesId:pk.species.speciesId}),
    setPokemonCaught:pk=>{b.events.push({kind:'caught-hook',seat,pokemonId:pk.id,speciesId:pk.species.speciesId});return tracked();}};
  s.validateAchvs=(_type,value)=>b.events.push({kind:'level-achievement-hook',seat,level:value.value});
  try{
    for(const {pokemon:pk}of c.roster.entries){pk.generateName();define(pk,'updateInfo',tracked);define(pk,'loadAssets',tracked);}
    options.onProgressionBind?.(c,p,b,tasks,{seat,operation});
    if(operation==='learn'){
      if(intent.action.slot===null)p.end();
      else if(options.reference)referenceForget.call(p,intent.action.slot,Mode.MESSAGE);
      else await p.forgetMove(intent.action.slot,Mode.MESSAGE);
    }else if(operation==='cancel'){
      if(options.reference)referenceQueueEnd.call(p);else p.queueEndEvolution();
      suspended=true;wake();
    }else if(operation==='evolve'){
      if(!intent.cancelled){if(options.reference)await referenceApplyEvolution.call(p);else await p.applyEvolution();}
      p.end();
    }else if(is(p,'EvolutionPhase')){suspended=true;wake();}
    else if(options.reference){
      if(is(p,'LevelUpPhase'))referenceLevelUp.call(p);
      else if(is(p,'LearnMovePhase'))referenceLearnStart.call(p);
      else referenceEndEvolution.call(p);
    }else p.start();
    await signal;await tasks.drain();
    b.events.push(...(is(p,'LevelUpPhase')?[{kind:'highest-level-hook',seat,level:s.gameData.gameStats.highestLevel}]:[]));
    return {completed:b.ended,suspended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
  }catch(error){
    // Finish already-scheduled presentation callbacks before removing bindings.
    try{await tasks.drain();}catch{}
    throw error;
  }finally{for(const [o,k,d]of temporary.reverse()){if(d)Object.defineProperty(o,k,d);else delete o[k];}tasks.close();b.dispose();}
}

export function progressionDriver(options={}){const base=experienceDriver(options);return {
  ...base,
  supports:(c,p)=>c.battle.battleSpec===BattleSpec.DEFAULT&&(isProgression(p)||base.supports(c,p)),
  execute:(c,p)=>isProgression(p)?runProgression(c,p,options):base.execute(c,p),
  resumeLearning:(c,p,intent)=>runProgression(c,p,options,'learn',intent),
  resumeEvolution:(c,p,intent)=>runProgression(c,p,options,'evolve',intent),
  stageEvolutionPause:(c,p)=>runProgression(c,p,options,'cancel'),
  suspendBoundary(c,p,id){
    const seat=phaseCodec.capture(p,c).scope;
    if(is(p,'LearnMovePhase'))return {remaining:'learn-apply',decision:createLearnDecision(id,c,seat,
      c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index)[p.partyMemberIndex].pokemon.id,p.moveId,id=>!!moveCatalog[id])};
    check(is(p,'EvolutionPhase'),'UNSUPPORTED_PROGRESSION_PHASE');
    return {remaining:'evolution-apply',decision:{id,kind:'evolution',requiredSeats:[seat],pokemonId:p.pokemon.id,
      reference:evolutionCodec.capture(p.evolution),lastLevel:p.lastLevel,stage:'evolve-or-cancel'}};
  }
};}

export function advanceLevelUp(c,inputs={},options={}){
  if(['learn-move','evolution'].includes(c.decision.kind))return advanceProgressionChoice(c,inputs,codec,safeCodec,progressionDriver(options),{decisionId:nextId(c)});
  if(isProgression(nextPostPhase(c)))return advanceQueuedRulePhase(c,codec,progressionDriver(options),{decisionId:nextId(c)});
  return advanceExperience(c,options);
}
export async function referenceProgression(c,inputs={}){
  const driver=progressionDriver({reference:true}),id=nextId(c);
  if(['learn-move','evolution'].includes(c.decision.kind)){
    const seat=c.decision.requiredSeats[0];
    const complete=async(candidate,operation,intent)=>{
      const result=await runProgression(candidate,candidate.continuation.currentPhase.phase,{reference:true},operation,intent);
      check(result.completed&&result.pendingTasks===0,'REFERENCE_PROGRESSION_INCOMPLETE');
      candidate.continuation.currentPhase=null;candidate.decision=driver.finishBoundary(candidate,null,id);return result;
    };
    const result=await applySafeDecisionAction(c,seat,inputs[seat],codec,safeCodec,{
      learnMove:(candidate,_seat,action)=>complete(candidate,'learn',{action}),
      evolve:candidate=>complete(candidate,'evolve',{cancelled:false}),
      endEvolution:candidate=>complete(candidate,'evolve',{cancelled:true})
    });
    if(result.context.decision.kind==='evolution'){
      const paused=await runProgression(result.context,result.context.continuation.currentPhase.phase,{reference:true},'cancel');
      result.events.push(...paused.events);
      result.context.decision.id=id;result.context.continuation.currentPhase.remaining='evolution-pause';
    }
    codec.capture(result.context);return result;
  }
  if(!isProgression(nextPostPhase(c)))return referenceExperience(c);
  const d=selectNextPhase(c.continuation,()=>check(false,'EMPTY_PROGRESSION_QUEUE')).phase;
  const result=await driver.execute(c,d.phase);check(result.pendingTasks===0,'PENDING_PROGRESSION_TASKS');
  if(result.suspended){const stop=driver.suspendBoundary(c,d.phase,id);d.remaining=stop.remaining;c.decision=stop.decision;}
  else {check(result.completed,'INCOMPLETE_PROGRESSION_PHASE');c.continuation.currentPhase=null;c.decision=driver.finishBoundary(c,d.phase,id);}
  codec.capture(c);return {context:c,events:result.events,grants:[]};
}
export function chooseProgression(c,{slot=0,evolve='evolve',pause='pause'}={}){
  if(c.decision.kind==='learn-move')return {[c.decision.requiredSeats[0]]:{kind:'learn-move',pokemonId:c.decision.learn.pokemonId,slot}};
  if(c.decision.kind==='evolution')return {[c.decision.requiredSeats[0]]:{kind:'evolution',pokemonId:c.decision.pokemonId,
    choice:c.decision.stage==='pause-confirm'?pause:evolve}};
  return {};
}
export {atExperienceEnd};
