import {copy,requireContract as check} from './coop-contract.mjs';
import {selectNextPhase} from './phase-queue.mjs';

// One completed original Phase at a time. The trusted driver declares support;
// callbacks and outstanding rule tasks must finish before a checkpoint exists.
export async function advanceQueuedRulePhase(context,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128
    &&decisionId!==context.decision.id,'INVALID_RULE_DECISION_ID');
  check(driver&&typeof driver.supports==='function'&&typeof driver.execute==='function','RULE_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation;
  check(candidate.decision.kind==='continuing'&&candidate.decision.reason==='effects'
    &&state.currentPhase===null&&state.standbyPhase===null,'UNSAFE_RULE_BOUNDARY');
  const selected=selectNextPhase(state,()=>check(false,'RULE_QUEUE_EMPTY')),descriptor=selected.phase;
  check(selected.start&&descriptor?.kind==='original-phase'&&descriptor.remaining==='start'
    &&driver.supports(candidate,descriptor.phase)===true,'UNSUPPORTED_RULE_PHASE');
  const result=await driver.execute(candidate,descriptor.phase);
  check(result&&result.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)
    &&Array.isArray(result.grants),'INCOMPLETE_RULE_PHASE');
  check(candidate.continuation===state&&state.currentPhase===descriptor&&state.standbyPhase===null,'INVALID_RULE_RESULT');
  state.currentPhase=null;candidate.decision={...candidate.decision,id:decisionId};
  codec.capture(candidate);
  return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
}
