import {copy,requireContract as check} from './coop-contract.mjs';
import {selectNextPhase} from './phase-queue.mjs';

// Await one original effect boundary; the driver must also drain its rule tasks.
// Promise stacks/UI callbacks are never checkpoints. No default driver exists.
export async function advanceQueuedMoveEffect(context,codec,driver){
  check(driver&&typeof driver.supports==='function'&&typeof driver.execute==='function','MOVE_EFFECT_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation;
  check(candidate.decision.kind==='continuing'&&candidate.decision.reason==='effects'
    &&state.currentPhase===null&&state.standbyPhase===null,'UNSAFE_MOVE_EFFECT_BOUNDARY');
  const selected=selectNextPhase(state,()=>check(false,'MOVE_QUEUE_EMPTY')),descriptor=selected.phase;
  check(selected.start&&descriptor?.kind==='original-phase'&&descriptor.remaining==='start'
    &&driver.supports(candidate,descriptor.phase)===true,'UNSUPPORTED_MOVE_EFFECT');
  const result=await driver.execute(candidate,descriptor.phase);
  check(result&&result.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)&&Array.isArray(result.grants),'INCOMPLETE_MOVE_EFFECT');
  check(candidate.continuation===state&&state.currentPhase===descriptor&&state.standbyPhase===null,'INVALID_MOVE_EFFECT_RESULT');
  state.currentPhase=null;candidate.decision={...candidate.decision,id:`${context.decision.id}:effect`};
  codec.capture(candidate);
  return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
}
