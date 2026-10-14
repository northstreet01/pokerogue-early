import {copy,requireContract as check} from './coop-contract.mjs';
import {selectNextPhase} from './phase-queue.mjs';

// One not-yet-started original MovePhase, on an independently restored model.
// Headless scene/rule providers are trusted and must explicitly declare support;
// this is not a default production runner or an arbitrary Phase.start dispatcher.
export function advanceQueuedMoveAction(context,codec,driver){
  check(driver&&typeof driver.supports==='function'&&typeof driver.execute==='function','MOVE_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation;
  check(candidate.decision.kind==='continuing'&&candidate.decision.reason==='effects'
    &&state.currentPhase===null&&state.standbyPhase===null,'UNSAFE_MOVE_ACTION_BOUNDARY');
  const selected=selectNextPhase(state,()=>check(false,'MOVE_QUEUE_EMPTY'));
  const descriptor=selected.phase;
  check(selected.start&&descriptor?.kind==='original-phase'&&descriptor.remaining==='start'
    &&driver.supports(candidate,descriptor.phase)===true,'UNSUPPORTED_MOVE_ACTION');
  const result=driver.execute(candidate,descriptor.phase);
  check(result&&!result.then&&result.completed===true&&Array.isArray(result.events)&&Array.isArray(result.grants),'INCOMPLETE_MOVE_ACTION');
  check(candidate.continuation===state&&state.currentPhase===descriptor&&state.standbyPhase===null,'INVALID_MOVE_ACTION_RESULT');
  state.currentPhase=null;
  candidate.decision={...candidate.decision,id:`${context.decision.id}:move`};
  codec.capture(candidate); // Late failures never replace context or consume its RNG.
  return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
}
