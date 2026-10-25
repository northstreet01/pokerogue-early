import {createOriginalRuleHost} from '../../server/original-rule-host.mjs';
import {forcedProgressionHost} from './forced-progression-host.mjs';
import {steadyInput} from './native-steady-progression.mjs';

export const finalBossConfig={seed:'vs24-final-boss',identity:{trainerId:1,secretId:2}};
export const phase=(type,phaseId=24000)=>({kind:'original-phase',phaseId,remaining:'start',phase:{version:1,type,scope:null,fields:{},presentation:{}}});
// Deliberately synthetic won-wave-199 boundary. The production NewBattle and
// Encounter phases must construct the final enemy themselves; no saved Boss
// object, deleted enemy, or altered damage is used to establish cardinality.
export async function finalBossFixture(api,{legacy=false}={}){
 const h=await createOriginalRuleHost(finalBossConfig);
 try{
  const initial=(await h.request('native-open-to-input',{parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}})).checkpoint;
  const c=api.originalDecisionStateCodec.restore(initial);
  c.battle.waveIndex=199;
  const scene=Object.assign(api.createOriginalRuntime(finalBossConfig.seed,finalBossConfig.identity).scene,c.scene,{currentBattle:c.battle});
  c.arena=new c.arena.constructor(scene,50,'end');
  for(const e of c.roster.entries.filter(e=>e.owner===null)){e.pokemon.hp=0;e.pokemon.status=new api.Status(api.StatusEffect.FAINT);}
  c.enemyModifiers=[];
  c.roster.field[2]=null;c.roster.field[3]=null;
  c.decision={id:'vs24-before-final',kind:'continuing',requiredSeats:[],reason:'next-battle'};
  c.continuation={phaseQueue:[phase('NewBattlePhase')],phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,currentPhase:null,standbyPhase:null};
  const before=api.originalDecisionStateCodec.capture(c);
  let generated;
  if(legacy){
   // Reproduce the previous production generator (true for both sides), using
   // the real original constructor/Encounter, then restore the test port.
   const original=api.BattleScene.prototype.newBattle;
   api.BattleScene.prototype.newBattle=function(...args){
    args[0]=200;args[4]=true;const result=original.apply(this,args);
    this.arena=new this.arena.constructor(this,50,'end');return result;
   };
   try{
    const result=await api.executeRuntimeOperation(api.createOriginalRuntime(finalBossConfig.seed,finalBossConfig.identity),'native-open-to-input',
     {parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}});
    return {before,generated:result.checkpoint,checkpoint:result.checkpoint,events:result.events};
   }
   finally{api.BattleScene.prototype.newBattle=original;}
  }else generated=await h.request('native-next',before);
  let checkpoint=generated.checkpoint,events=[...generated.events];
  for(let n=0;n<16&&checkpoint.decision.kind!=='wait-actions';n++){
   const d=checkpoint.decision;
   const result=d.kind==='continuing'?await h.request('native-run-to-boundary',checkpoint)
    :await h.request('native-switch',{checkpoint,inputs:{[d.requiredSeats[0]]:d.options[d.requiredSeats[0]].find(o=>o.accept===false)??d.options[d.requiredSeats[0]][0]}});
   checkpoint=result.checkpoint;events.push(...result.events);
  }
  return {before,generated:generated.checkpoint,checkpoint,events};
 }finally{await h.close();}
}

export async function finalBossTrace(api,initial){
 const h=await forcedProgressionHost(finalBossConfig),steps=[],boundaries=[];let c=initial;
 try{
  for(let n=0;n<1200&&c.decision.kind!=='ended';n++){
   const before=structuredClone(c);
   const front=(c.continuation.phaseQueuePrepend[0]??c.continuation.phaseQueue[0])?.phase.type;
   const operation=c.decision.kind==='continuing'
    ?(['LearnMovePhase','EvolutionPhase'].includes(front)?'native-run-to-boundary':'native-step')
    :['learn-move','evolution'].includes(c.decision.kind)?'native-progression':'native-submit';
   if(operation==='native-submit')boundaries.push(before);
   const payload=['native-step','native-run-to-boundary'].includes(operation)?c
    :operation==='native-progression'?{checkpoint:c,seat:c.decision.requiredSeats[0],action:steadyInput(api,c)[c.decision.requiredSeats[0]]}
    :{checkpoint:c,inputs:steadyInput(api,c)};
   let r;try{r=await h.request(operation,payload);}catch(error){throw Error(`${operation} ${front} ${JSON.stringify(c.continuation.phaseQueuePrepend)}\n${error.message}\n${error.detail??''}`);}
   steps.push({before,operation,payload:structuredClone(payload),result:r});c=r.checkpoint;
  }
  return {steps,boundaries,terminal:c};
 }finally{await h.close();}
}
