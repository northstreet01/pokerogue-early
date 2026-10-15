import {copy,requireContract as check} from './coop-contract.mjs';
import {selectNextPhase} from './phase-queue.mjs';

// Execute only the extracted original experience segment, once. Stats and
// battle aftermath remain explicit pending work on this same Victory instance.
export async function advanceVictoryExperience(context,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128&&decisionId!==context.decision.id,
    'INVALID_EXPERIENCE_DECISION_ID');
  check(typeof driver?.supports==='function'&&typeof driver.queueExperience==='function','EXPERIENCE_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation;
  check(candidate.decision.kind==='continuing'&&candidate.decision.reason==='effects'&&state.currentPhase===null
    &&state.standbyPhase===null,'UNSAFE_EXPERIENCE_BOUNDARY');
  check(candidate.roster.entries.some(e=>e.owner!==null&&e.group==='party'&&!e.pokemon.isFainted()),'UNCONFIRMED_SIMULTANEOUS_WIPE');
  const descriptor=selectNextPhase(state,()=>check(false,'EXPERIENCE_QUEUE_EMPTY')).phase;
  check(descriptor?.kind==='original-phase'&&descriptor.remaining==='start'&&descriptor.phase.player===false
    &&[2,3].includes(descriptor.phase.battlerIndex)&&typeof descriptor.phase.queueExperience==='function'
    &&driver.supports(candidate,descriptor.phase)===true,
    'UNSUPPORTED_EXPERIENCE_PHASE');
  const result=await driver.queueExperience(candidate,descriptor.phase);
  check(result?.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)&&Array.isArray(result.grants),
    'INCOMPLETE_EXPERIENCE_SEGMENT');
  check(candidate.continuation===state&&state.currentPhase===descriptor&&state.standbyPhase===null,'INVALID_EXPERIENCE_RESULT');
  descriptor.remaining='victory-aftermath';
  // Original unshiftPhase effects drain first. Resume the original Victory
  // aftermath before the previously queued actions, never by restarting start.
  state.currentPhase=null;state.phaseQueue.unshift(descriptor);
  candidate.decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
  codec.capture(candidate);return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
}
