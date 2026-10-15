import {copy,requireContract as check} from './coop-contract.mjs';
import {selectNextPhase} from './phase-queue.mjs';

// PLAY-14: the trusted driver invokes the same original EggLapse Phase once
// for each personal inventory. All rows and original hatch queues commit as a
// single candidate, even when a player's entire party had fainted.
export async function advanceEggLapse(context,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128&&decisionId!==context.decision.id,
    'INVALID_EGG_DECISION_ID');
  check(typeof driver?.supports==='function'&&typeof driver.executeEggLapse==='function','EGG_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation;
  check(candidate.eggState&&candidate.decision.kind==='continuing'&&candidate.decision.reason==='effects'
    &&state.currentPhase===null&&state.standbyPhase===null,'UNSAFE_EGG_BOUNDARY');
  check(candidate.battle?.enemyParty.length>0&&candidate.battle.enemyParty.every(p=>p.isFainted(true)),'BATTLE_NOT_WON');
  check(candidate.roster.entries.some(e=>e.owner!==null&&e.group==='party'&&!e.pokemon.isFainted()),'UNCONFIRMED_SIMULTANEOUS_WIPE');
  const saved=codec.capture(candidate),descriptor=selectNextPhase(state,()=>check(false,'EGG_QUEUE_EMPTY')).phase;
  check(descriptor?.kind==='original-phase'&&descriptor.remaining==='start'
    &&saved.continuation.phaseQueuePrepend.concat(saved.continuation.phaseQueue).some(d=>d.phaseId===descriptor.phaseId
      &&d.phase.type==='EggLapsePhase'&&d.phase.scope===null)
    &&driver.supports(candidate,descriptor.phase)===true,'UNSUPPORTED_EGG_PHASE');
  const result=await driver.executeEggLapse(candidate,descriptor.phase);
  check(result?.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)&&Array.isArray(result.grants),
    'INCOMPLETE_EGG_LAPSE');
  check(candidate.continuation===state&&state.currentPhase===descriptor&&descriptor.remaining==='start'
    &&state.standbyPhase===null,'INVALID_EGG_RESULT');
  state.currentPhase=null;candidate.decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
  codec.capture(candidate);return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
}
