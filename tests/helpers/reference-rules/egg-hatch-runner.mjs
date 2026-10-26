import {copy,canonical,requireContract as check} from '../../../src/battle-core/coop-contract.mjs';
import {selectNextPhase} from '../../../src/battle-core/phase-queue.mjs';

// Only the original generation rule runs here. Removing the egg and writing
// dex/IV/egg-move data require the later atomic personal collection transaction.
// A durable hatch-commit Phase is a stop, never permission to regenerate/start.
export async function advanceEggHatch(context,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128&&decisionId!==context.decision.id,'INVALID_HATCH_DECISION_ID');
  check(typeof driver?.supports==='function'&&typeof driver.generateEggHatch==='function','HATCH_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation;
  check(candidate.eggState&&candidate.decision.kind==='continuing'&&candidate.decision.reason==='effects'
    &&state.standbyPhase===null,'UNSAFE_HATCH_BOUNDARY');
  check(state.currentPhase===null,'HATCH_COMMIT_UNAVAILABLE');
  check(candidate.battle?.enemyParty.length>0&&candidate.battle.enemyParty.every(p=>p.isFainted(true)),'BATTLE_NOT_WON');
  check(candidate.roster.entries.some(e=>e.owner!==null&&e.group==='party'&&!e.pokemon.isFainted()),'UNCONFIRMED_SIMULTANEOUS_WIPE');
  const descriptor=selectNextPhase(state,()=>check(false,'HATCH_QUEUE_EMPTY')).phase;
  const selected=codec.capture({...candidate,continuation:{...state,currentPhase:null,phaseQueue:[descriptor,...state.phaseQueue]}})
    .continuation.phaseQueue[0].phase;
  check(descriptor?.kind==='original-phase'&&descriptor.remaining==='start'&&selected.type==='EggHatchPhase'
    &&[0,1].includes(selected.scope)&&descriptor.phase.egg.hatchWaves<=0
    &&driver.supports(candidate,descriptor.phase)===true,'UNSUPPORTED_HATCH_PHASE');
  const phase=descriptor.phase,egg=phase.egg;
  const unchanged=canonical(codec.capture({...candidate,continuation:{...state,currentPhase:null}}));
  const result=await driver.generateEggHatch(candidate,phase,{seat:selected.scope});
  check(result?.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)
    &&Array.isArray(result.grants)&&result.grants.length===0,'INCOMPLETE_HATCH_GENERATION');
  check(candidate.continuation===state&&state.currentPhase===descriptor&&state.standbyPhase===null
    &&descriptor.phase===phase&&descriptor.remaining==='start'&&phase.egg===egg,'INVALID_HATCH_RESULT');
  check(canonical(codec.capture({...candidate,continuation:{...state,currentPhase:null}}))===unchanged,'HATCH_MUTATED_BATTLE_OR_INVENTORY');
  check(phase.pokemon?.isPlayer()===true&&Number.isInteger(phase.eggMoveIndex)&&phase.eggMoveIndex>=0&&phase.eggMoveIndex<=3,'INVALID_HATCH_RESULT');
  descriptor.remaining='hatch-commit';
  candidate.decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
  codec.capture(candidate);
  return {context:candidate,events:copy(result.events),grants:[]};
}
