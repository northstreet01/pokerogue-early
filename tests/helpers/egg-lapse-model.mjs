import fs from 'node:fs';
import {codec} from './decision-model.mjs';
import {originalPhases,eggHatchPhases,phaseCodec} from './phase-model.mjs';
import {eggs} from './egg-model.mjs';
import {aftermathContext,advanceAftermath,referenceAfterBattle,atEggBoundary} from './victory-aftermath-model.mjs';
import {bindAction,compileReference,actionRules} from './move-execution-model.mjs';
import {queueOwnedPhase} from './native-switch-model.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {advanceEggLapse} from '../../src/battle-core/egg-lapse-runner.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {requireContract as check,copy} from '../../src/battle-core/coop-contract.mjs';
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-egg-lapse-reference.json',import.meta.url),'utf8'));
const referenceStart=compileReference(frozen.start,'',{...actionRules,...eggHatchPhases});
const is=(p,name)=>p?.constructor===(originalPhases[name]??eggHatchPhases[name]);
const nextId=c=>`egg-lapse-${Number(c.decision.id.split('-').at(-1))+1}`;
export const atEggStop=c=>c.continuation.currentPhase===null
  &&['EggHatchPhase','SelectModifierPhase','ModifierRewardPhase','NewBattlePhase'].some(name=>is(nextPhase(c),name));
function nextPhase(c){const state={...c.continuation,phaseQueue:[...c.continuation.phaseQueue],phaseQueuePrepend:[...c.continuation.phaseQueuePrepend]};
  return selectNextPhase(state,()=>{}).phase?.phase;}
export async function eggLapseContext({rows=[[3,1],[1,7]],emptySeat=null,fromVictory=false}={}){
  let c=await aftermathContext({emptySeat});
  if(!fromVictory)while(!atEggBoundary(c))c=(await advanceAftermath(c)).context;
  c.eggState={players:rows.map((row,seat)=>row.map((waves,index)=>new eggs.Egg(10000+seat*100+index,index%3,waves,1000+index)))};
  return codec.restore(codec.capture(c));
}
export function eggLapseDriver(options={}){return {
  supports:(_c,p)=>is(p,'EggLapsePhase'),
  async executeEggLapse(c,p){
    check(is(p,'EggLapsePhase'),'UNSUPPORTED_EGG_PHASE');const events=[];
    // Dispatch the one shared queued boundary into two personal original Phase
    // instances, each started exactly once inside this single atomic candidate.
    for(const seat of [0,1]){
      const owned=new originalPhases.EggLapsePhase({}),b=bindAction(c,owned),tasks=createRuleTaskTracker(b.scene);
      try{
        b.scene.gameData={eggs:c.eggState.players[seat]};
        b.scene.unshiftPhase=q=>queueOwnedPhase(c,q,seat,true);
        const queue=b.scene.queueMessage;b.scene.queueMessage=text=>{b.events.push({kind:'egg-message-owner',seat});queue(text);};
        options.onEggBind?.(c,owned,b,tasks,{seat});
        if(options.reference)referenceStart.call(owned);else owned.start();
        await tasks.drain();check(b.ended&&tasks.pendingTasks===0,'INCOMPLETE_OWNED_EGG_LAPSE');
        events.push(...b.events,{kind:'egg-progress',seat,count:c.eggState.players[seat].length});
      }finally{tasks.close();b.dispose();}
    }
    return {completed:true,pendingTasks:0,events,grants:[]};
  }
};}
export function advanceEggs(c,inputs={},options={}){
  if(atEggBoundary(c))return advanceEggLapse(c,codec,eggLapseDriver(options),{decisionId:nextId(c)});
  return advanceAftermath(c,inputs,options);
}
export async function referenceEggs(c,inputs={}){
  if(!atEggBoundary(c))return referenceAfterBattle(c,inputs);
  const id=nextId(c),d=selectNextPhase(c.continuation,()=>check(false,'EMPTY_EGG_QUEUE')).phase;
  const result=await eggLapseDriver({reference:true}).executeEggLapse(c,d.phase);
  check(result.completed&&result.pendingTasks===0,'REFERENCE_EGG_LAPSE_INCOMPLETE');
  c.continuation.currentPhase=null;c.decision={id,kind:'continuing',requiredSeats:[],reason:'effects'};
  codec.capture(c);return {context:c,events:copy(result.events),grants:[]};
}
export function queuedHatches(c){return [...c.continuation.phaseQueuePrepend,...c.continuation.phaseQueue]
  .filter(d=>is(d.phase,'EggHatchPhase')).map(d=>({scope:phaseCodec.capture(d.phase,c).scope,egg:d.phase.egg,phase:d.phase,phaseId:d.phaseId}));}
