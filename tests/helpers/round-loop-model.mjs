import fs from 'node:fs';
import {codec} from './decision-model.mjs';
import {pokemon,moves,battler,parse,evaluate} from './original-model.mjs';
import {originalPhases,installPhaseTestDependencies,phaseCodec} from './phase-model.mjs';
import {effectContext,damageRules} from './move-effect-model.mjs';
import {bindAction,compileReference,common,moveRules,originalMoveStart} from './move-execution-model.mjs';
import {postDamageDriver,nextPostPhase,BattleSpec} from './post-damage-model.mjs';
import {cleanupDriver} from './turn-end-model.mjs';
import {getFieldOrder,getMoveOrder} from '../../src/battle-core/turn-order.mjs';
import {populatePhaseQueue,selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {resolveFightIntent} from '../../src/battle-core/fight-command.mjs';
import {requireContract as check} from '../../src/battle-core/coop-contract.mjs';

const Command=evaluate(parse('ui/command-ui-handler.ts').statements.filter(n=>n.name?.text==='Command').map(n=>n.getText()).join('\n')).Command;
installPhaseTestDependencies({'./battle-core/turn-order.mjs':{getFieldOrder,getMoveOrder},
  './ui/command-ui-handler':{Command},'./data/pokemon-stat':common['./pokemon-stat']});
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-round-loop-reference.json',import.meta.url),'utf8'));
const reference=Object.fromEntries(Object.entries(frozen.methods).map(([name,methods])=>[name,
  Object.fromEntries(Object.entries(methods).map(([method,body])=>[method,
    compileReference(body.replaceAll('super.end();','this.scene.shiftPhase();'),'',
      {...damageRules,...originalPhases,Command,getMoveOrder})]))]));
const structural=new Set(['TurnStartPhase','TurnInitPhase','MessagePhase']);
export const fightRules={fightCommand:Command.FIGHT,noneMove:moves.Moves.NONE,struggleMove:moves.Moves.STRUGGLE,
  getMoveTargets:moveRules.getMoveTargets,getEncoreTag:p=>p.getTag(battler.EncoreTag)};

// Original target enumeration for the deterministic fixture moves only. The full
// production legal-action provider (including random targets) remains separate.
export function roundFightOptions(c,seat){
  const p=c.roster.entries.find(e=>e.pokemon.id===c.roster.field[seat]).pokemon;
  const binding=bindAction(c,new originalPhases.TurnInitPhase({}));
  try{return p.getMoveset().flatMap((move,cursor)=>{
    check([moves.Moves.TACKLE,moves.Moves.GROWL,moves.Moves.DOUBLE_SLAP].includes(move.moveId),'UNSUPPORTED_FIXTURE_MOVE');
    if(!move.isUsable(p))return [];
    const targets=moveRules.getMoveTargets(p,move.moveId);
    return (targets.targets.length>1&&!targets.multiple?targets.targets:[null]).map(target=>{
      const intent={kind:'fight',pokemonId:p.id,cursor,target};resolveFightIntent(p,seat,intent,fightRules);return intent;
    });
  });}finally{binding.dispose();}
}

export function finishRoundBoundary(c,_phase,id){
  // BattleScene.shiftPhase uses this exact queue helper when the main/prepend
  // queues are empty. Do not hand-build the next round's command order.
  if(!c.continuation.phaseQueue.length&&!c.continuation.phaseQueuePrepend.length){
    const phaseId=Math.max(-1,...c.continuation.nextCommandPhaseQueue.map(d=>d.phaseId))+1;
    populatePhaseQueue(c.continuation,()=>({kind:'original-phase',phaseId,
      phase:new originalPhases.TurnInitPhase({}),remaining:'start'}));
  }
  if(nextPostPhase(c)?.constructor===originalPhases.CommandPhase){
    check([0,1].every(seat=>c.roster.entries.some(e=>e.pokemon.id===c.roster.field[seat]&&e.owner===seat&&e.pokemon.hp>0)),'UNSUPPORTED_FAINT_BOUNDARY');
    const requiredSeats=[0,1].filter(seat=>c.battle.turnCommands[seat]===null);
    return {id,kind:'wait-actions',requiredSeats,options:Object.fromEntries(requiredSeats.map(seat=>[seat,roundFightOptions(c,seat)]))};
  }
  return {id,kind:'continuing',requiredSeats:[],reason:'effects'};
}

export function roundContext({seat=0,move=moves.Moves.TACKLE,seed='round-loop',disabledTurns=0}={}){
  const c=effectContext(seat,move,seed);
  for(const {pokemon:p}of c.roster.entries){p.hp=p.stats[0]=200;p.moveset=[new pokemon.PokemonMove(p.isPlayer()&&p.id===c.roster.field[seat]?move:moves.Moves.TACKLE,0,0,false)];}
  const b=bindAction(c,new originalPhases.TurnStartPhase({}));
  try{for(const slot of [0,1]){
    const p=c.roster.entries[slot].pokemon,targets=moveRules.getMoveTargets(p,p.moveset[0].moveId);
    const intent={kind:'fight',pokemonId:p.id,cursor:0,target:targets.targets.length>1&&!targets.multiple?2:null};
    c.battle.turnCommands[slot]=resolveFightIntent(p,slot,intent,fightRules);
  }}finally{b.dispose();}
  // Entry point is after commands have been collected; enemy-command/AI was
  // tested separately. Keep a declared enemy FIGHT command in this full queue.
  c.battle.turnCommands[2]={command:Command.FIGHT,cursor:0,move:{move:moves.Moves.TACKLE,targets:[0],ignorePP:false},args:[false]};
  if(disabledTurns){const p=c.roster.entries[seat].pokemon;p.summonData.disabledMove=moves.Moves.GROWL;p.summonData.disabledTurns=disabledTurns;}
  c.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase:new originalPhases.TurnStartPhase({}),remaining:'start'}];
  c.decision.id='round-0';return codec.restore(codec.capture(c));
}

export function roundDriver({reference:useReference=false,onBind,onFinish,bindModifiers}={}){
  const post=postDamageDriver({reference:useReference,bindModifiers}),cleanup=cleanupDriver(useReference,undefined,bindModifiers);
  return {
    supports:(c,p)=>c.battle.battleSpec===BattleSpec.DEFAULT&&
      ([originalPhases.MovePhase.prototype,...[...structural].map(n=>originalPhases[n].prototype)].includes(Object.getPrototypeOf(p))
      ||post.supports(c,p)||cleanup.supports(c,p)),
    async execute(c,p){
      const name=p.constructor.name;
      if(post.supports(c,p))return post.execute(c,p);
      if(cleanup.supports(c,p))return cleanup.execute(c,p);
      const b=bindAction(c,p),tasks=createRuleTaskTracker(b.scene),patched=[];
      let modifierBinding;
      try{
        // Only the original MessagePhase's presentation callback is immediate.
        b.scene.ui={showText:(text,_arg,done)=>{b.events.push({kind:'message-display',text});done();}};
        b.scene.abilityBar={shown:false};
        modifierBinding=bindModifiers?.(c,p,b,tasks);
        onBind?.(c,p,b,tasks);
        if(useReference&&name!=='MovePhase')for(const [method,fn]of Object.entries(reference[name])){
          patched.push(method);Object.defineProperty(p,method,{value:fn,configurable:true});}
        if(name==='MovePhase'&&useReference)originalMoveStart.call(p);else p.start();
        await (modifierBinding?.drain()??tasks.drain());
        return {completed:b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
      }finally{modifierBinding?.dispose();for(const method of patched)delete p[method];tasks.close();b.dispose();}
    },
    finishBoundary(c,p,id){const decision=finishRoundBoundary(c,p,id);onFinish?.(c,p,decision);return decision;}
  };
}
const nextId=c=>`round-${Number(c.decision.id.split('-').at(-1))+1}`;
export const advanceRound=(c,options={})=>advanceQueuedRulePhase(c,codec,roundDriver(options),{decisionId:nextId(c)});
export async function runRoundReference(c){
  const id=nextId(c),driver=roundDriver({reference:true}),descriptor=selectNextPhase(c.continuation,()=>{throw Error('Empty round queue');}).phase;
  check(driver.supports(c,descriptor.phase),'UNSUPPORTED_RULE_PHASE');
  const result=await driver.execute(c,descriptor.phase);check(result.completed&&result.pendingTasks===0,'INCOMPLETE_RULE_PHASE');
  c.continuation.currentPhase=null;c.decision=driver.finishBoundary(c,descriptor.phase,id);codec.capture(c);
  return {context:c,events:result.events,grants:result.grants};
}
export function resolveRoundFight(c,seat,intent){const b=bindAction(c,new originalPhases.TurnInitPhase({}));
  try{return resolveFightIntent(c.roster.entries.find(e=>e.pokemon.id===c.roster.field[seat]).pokemon,seat,intent,fightRules);}
  finally{b.dispose();}}
