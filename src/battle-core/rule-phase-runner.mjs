import {copy,requireContract as check} from './coop-contract.mjs';
import {selectNextPhase} from './phase-queue.mjs';

const switchStages=['switch-return','switch-swap','summon-initialize','summon-finish','switch-finish','post-summon'];

// One completed original Phase at a time. The trusted driver declares support;
// callbacks and outstanding rule tasks must finish before a checkpoint exists.
export async function advanceQueuedRulePhase(context,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128
    &&decisionId!==context.decision.id,'INVALID_RULE_DECISION_ID');
  check(driver&&typeof driver.supports==='function'&&typeof driver.execute==='function','RULE_DRIVER_UNAVAILABLE');
  check(driver.finishBoundary===undefined||(typeof driver.finishBoundary==='function'
    &&driver.finishBoundary.constructor.name!=='AsyncFunction'),'RULE_BOUNDARY_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation;
  const resuming=state.currentPhase!==null;
  check(candidate.decision.kind==='continuing'&&state.standbyPhase===null
    &&(resuming?candidate.decision.reason==='switch'&&switchStages.includes(state.currentPhase.remaining)
      &&typeof driver.resume==='function':candidate.decision.reason==='effects'),'UNSAFE_RULE_BOUNDARY');
  const selected=resuming?{phase:state.currentPhase,start:false}:selectNextPhase(state,()=>check(false,'RULE_QUEUE_EMPTY')),descriptor=selected.phase;
  check(descriptor?.kind==='original-phase'&&(resuming||descriptor.remaining==='start')
    &&driver.supports(candidate,descriptor.phase)===true,'UNSUPPORTED_RULE_PHASE');
  const result=await (resuming?driver.resume(candidate,descriptor.phase,descriptor.remaining):driver.execute(candidate,descriptor.phase));
  check(result&&(result.completed===true||result.completed===false&&result.suspended===true)
    &&result.pendingTasks===0&&Array.isArray(result.events)
    &&Array.isArray(result.grants),'INCOMPLETE_RULE_PHASE');
  check(candidate.continuation===state&&state.currentPhase===descriptor&&state.standbyPhase===null,'INVALID_RULE_RESULT');
  if(result.suspended===true){
    check(result.completed===false&&typeof driver.suspendBoundary==='function'
      &&driver.suspendBoundary.constructor.name!=='AsyncFunction','RULE_SUSPEND_DRIVER_UNAVAILABLE');
    const stop=driver.suspendBoundary(candidate,descriptor.phase,decisionId,result);
    check(stop&&!stop.then&&stop.decision?.id===decisionId
      &&(['wait-actions','wait-target','wait-switch'].includes(stop.remaining)&&stop.decision.kind===stop.remaining
        ||stop.remaining==='learn-apply'&&stop.decision.kind==='learn-move'
        ||stop.remaining==='evolution-apply'&&stop.decision.kind==='evolution'
        ||switchStages.includes(stop.remaining)&&stop.decision.kind==='continuing'&&stop.decision.reason==='switch'),
      'INVALID_RULE_SUSPENSION');
    check(candidate.continuation===state&&state.currentPhase===descriptor&&state.standbyPhase===null,'INVALID_RULE_RESULT');
    descriptor.remaining=stop.remaining;candidate.decision=stop.decision;
    codec.capture(candidate);
    return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
  }
  state.currentPhase=null;
  // Trusted scene adapter may complete the original queue boundary and expose
  // an input stop. It acts only on this candidate, after all rule tasks ended.
  const decision=driver.finishBoundary?driver.finishBoundary(candidate,descriptor.phase,decisionId)
    :{...candidate.decision,id:decisionId};
  check(decision&&!decision.then&&decision.id===decisionId,'INVALID_RULE_DECISION');
  check(candidate.continuation===state&&state.currentPhase===null&&state.standbyPhase===null,'INVALID_RULE_RESULT');
  candidate.decision=decision;
  codec.capture(candidate);
  return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
}
