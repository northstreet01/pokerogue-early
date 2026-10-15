import ts from 'typescript';
import {initialDecision,codec} from './decision-model.mjs';
import {parse,evaluate,pokemon,arena,originalPokemon,installPokemonTestDependencies} from './original-model.mjs';
import {originalPhases,phaseCodec,formModule,installPhaseTestDependencies} from './phase-model.mjs';
import {modifiers} from './modifier-model.mjs';
import {observeRulePromise,createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {prependPhase,pushPhase} from '../../src/battle-core/phase-queue.mjs';

// Run actual switch methods with synchronous rendering hooks. Rule methods,
// object swaps, source tags, onEnd and entry-ability dispatcher are original.
const abilitySource=parse('data/ability.ts').statements.filter(n=>
  ts.isClassDeclaration(n)&&['AbAttr','PreSwitchOutAbAttr','PostSummonAbAttr'].includes(n.name.text)
  ||ts.isFunctionDeclaration(n)&&['applyAbAttrsInternal','applyPreSwitchOutAbAttrs','applyPostSummonAbAttrs','canApplyAttr','queueShowAbility'].includes(n.name?.text)).map(n=>n.getText()).join('\n');
const abilities=evaluate(`import {observeRulePromise} from 'tasks'; ${abilitySource}`,{tasks:{observeRulePromise}});
installPhaseTestDependencies({'./data/ability':abilities,'./data/pokemon-forms':formModule,'./modifier/modifier':modifiers,
  './data/arena-tag':arena,'./field/pokemon':pokemon,'./data/pokeball':{getPokeballTintColor:()=>0},
  './ui/command-ui-handler':{Command:evaluate(parse('ui/command-ui-handler.ts').statements.find(n=>n.name?.text==='Command').getText()).Command}});
installPokemonTestDependencies({'../modifier/modifier':modifiers});

export function queueOwnedPhase(c,phase,seat,prepend=false){
  const ids=[...c.continuation.phaseQueue,...c.continuation.phaseQueuePrepend,...c.continuation.nextCommandPhaseQueue,
    c.continuation.currentPhase,c.continuation.standbyPhase].filter(p=>p?.kind==='original-phase').map(p=>p.phaseId);
  phaseCodec.capture(phase,c,seat);
  (prepend?prependPhase:pushPhase)(c.continuation,{kind:'original-phase',phaseId:Math.max(-1,...ids)+1,phase,remaining:'start'});
}

export function nativeSwitchContext(baton=false,seat=0) {
  const c=initialDecision();
  c.roster.entries.push({owner:seat,group:'party',index:1,pokemon:originalPokemon(110+seat)});
  for(const e of c.roster.entries){e.pokemon.summonData.speciesForm=null;e.pokemon.fusionSpecies=null;e.pokemon.shiny=false;}
  if(!baton)c.roster.entries[seat].pokemon.hp=0;
  c.battle.turnCommands[seat]=baton?{command:2,cursor:1,args:[true]}:null;
  c.decision={id:'switch-native-0',kind:'continuing',requiredSeats:[],reason:'switch'};
  const scene={currentBattle:c.battle};
  const phase=new originalPhases.SwitchSummonPhase(scene,0,1,baton,baton);
  c.continuation.currentPhase={kind:'original-phase',phaseId:0,phase:phaseCodec.capture(phase,c,seat),remaining:'switch-return'};
  return c;
}
export async function nativeSwitchStep(context,seat=0,clone=true,options={}) {
  const c=clone?codec.restore(codec.capture(context)):context,descriptor=c.continuation.currentPhase;
  const phase=descriptor.phase,events=[];
  const party=c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index).map(e=>e.pokemon);
  const field=()=>c.roster.field.map(id=>c.roster.entries.find(e=>e.pokemon.id===id)?.pokemon);
  const append=(p,prepend)=>queueOwnedPhase(c,p,seat,prepend);
  let ended=false;
  const scene={currentBattle:c.battle,arena:c.arena,getParty:()=>party,getEnemyParty:()=>c.battle.enemyParty,
    getPlayerField:()=>field().slice(0,2),getEnemyField:()=>field().slice(2).filter(Boolean),getField:field,
    getPokemonById:id=>c.roster.entries.find(e=>e.pokemon.id===id)?.pokemon,
    field:{getIndex:p=>field().indexOf(p),remove:p=>{const index=field().indexOf(p);if(index>=0)c.roster.field[index]=null;}},
    ui:{showText:(_text,_delay,done)=>done?.()},playSound(){},
    time:{delayedCall(){descriptor.remaining='switch-swap';}},
    tweens:{add:options=>options.onComplete?.()},
    triggerPokemonFormChange:p=>{events.push({kind:'form-hook',pokemonId:p.id});return false;},
    findModifier:predicate=>c.players[seat].modifiers.find(predicate),
    tryTransferHeldItemModifier(){throw Error('Fixture has no baton held item');},
    validateAchv:id=>events.push({kind:'achievement-hook',id}),
    unshiftPhase:p=>append(p,true),pushPhase:p=>append(p,false),
    clearPhaseQueueSplice:()=>{c.continuation.phaseQueuePrependSpliceIndex=-1;},
    setPhaseQueueSplice:()=>{c.continuation.phaseQueuePrependSpliceIndex=c.continuation.phaseQueuePrepend.length;},
    queueMessage:text=>events.push({kind:'message-hook',text}),shiftPhase(){ended=true;}};
  const tasks=createRuleTaskTracker(scene);
  for(const {pokemon:p}of c.roster.entries){p.scene=scene;Object.defineProperties(p,{hideInfo:{value:()=>{},configurable:true},tint:{value:()=>{},configurable:true},
    setVisible:{value:()=>{},configurable:true}});}
  phase.scene=scene;
  // The rendering summon's logical boundary is kept as a separate step. Native
  // switchAndSummon has already done the swap/source transfer when this runs.
  Object.defineProperty(phase,'summon',{value:()=>{
    party.forEach((p,index)=>{c.roster.entries.find(e=>e.pokemon===p).index=index;});c.roster.field[seat]=party[0].id;
    phase.fieldIndex=seat;descriptor.remaining='summon-initialize';
  },configurable:true});
  let unpatch=()=>{};
  try {
    unpatch=options.patchPhase?.(phase)??unpatch;
    options.onBind?.(c,phase,{scene,events},tasks,{stage:descriptor.remaining});
    if(descriptor.remaining==='start'&&options.managed)phase.start();
    else if(descriptor.remaining==='switch-return')phase.preSummon();
    else if(descriptor.remaining==='switch-swap')phase.switchAndSummon();
    else if(descriptor.remaining==='summon-initialize'){
      const incoming=phase.getPokemon();incoming.fieldPosition=seat===1?2:1;incoming.resetSummonData();descriptor.remaining='summon-finish';
    } else if(descriptor.remaining==='summon-finish'){
      if(options.managed)phase.end();
      else{phase.onEnd();c.continuation.currentPhase=null;
      const seats=[0,1].filter(s=>c.battle.turnCommands[s]===null);
      c.decision={id:'switch-native-done',kind:'wait-actions',requiredSeats:seats,options:Object.fromEntries(seats.map(s=>[s,[{kind:'test-continue',pokemonId:c.roster.field[s]}]]))};}
    } else throw Error('Unsupported native fixture stage');
    await tasks.drain();await Promise.resolve();
  } finally {
    unpatch();tasks.close();
    delete phase.summon;delete phase.scene;
    for(const {pokemon:p}of c.roster.entries){delete p.scene;delete p.hideInfo;delete p.tint;delete p.setVisible;}
  }
  if(options.managed)return {context:c,completed:ended,suspended:!ended,remaining:descriptor.remaining,pendingTasks:0,events,grants:[]};
  if(c.decision.kind==='continuing')c.decision.id=`switch-native-${context.decision.id.split('-').at(-1)*1+1}`;
  codec.capture(c);return {context:c,events,grants:[]};
}
