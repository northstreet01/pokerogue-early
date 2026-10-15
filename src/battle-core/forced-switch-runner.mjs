import {copy,canonical,requireContract as check} from './coop-contract.mjs';
import {resolveForcedSwitchIntent} from './switch-command.mjs';

// Resume the saved original Switch callback with a validated personal instance.
// The trusted adapter maps the seat to its own party's local field index; it
// queues the original SwitchSummon and completes only the waiting Switch Phase.
export async function advanceForcedSwitch(context,inputs,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128
    &&decisionId!==context.decision.id,'INVALID_SWITCH_DECISION_ID');
  check(typeof driver?.resumeSwitch==='function','SWITCH_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation,descriptor=state.currentPhase;
  check(candidate.decision.kind==='wait-switch'&&candidate.decision.requiredSeats.length===1
    &&descriptor?.kind==='original-phase'&&descriptor.remaining==='wait-switch'&&state.standbyPhase===null
    &&descriptor.phase.isModal===true&&descriptor.phase.doReturn===false,'UNSAFE_SWITCH_BOUNDARY');
  const seat=candidate.decision.requiredSeats[0],actions=copy(inputs);
  check(actions&&typeof actions==='object'&&!Array.isArray(actions)&&Object.keys(actions).join(',')===String(seat),
    'INCOMPLETE_SWITCH_INPUTS');
  const before=canonical(codec.capture(candidate));
  codec.validateAction(candidate,seat,actions[seat]);
  const intent=resolveForcedSwitchIntent(candidate,seat,actions[seat]);
  check(canonical(codec.capture(candidate))===before,'VALIDATOR_MUTATED_STATE');
  const result=await driver.resumeSwitch(candidate,descriptor.phase,{seat,...intent});
  check(result?.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)&&Array.isArray(result.grants),
    'INCOMPLETE_SWITCH_CALLBACK');
  check(candidate.continuation===state&&state.currentPhase===descriptor&&descriptor.remaining==='wait-switch'
    &&state.standbyPhase===null,'INVALID_SWITCH_RESULT');
  state.currentPhase=null;
  candidate.decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
  codec.capture(candidate);
  return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
}
