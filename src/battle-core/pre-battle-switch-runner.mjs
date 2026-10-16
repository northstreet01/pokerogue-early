import {copy,canonical,requireContract as check} from './coop-contract.mjs';

// Resume only the original callback of the saved interaction. The subsequent
// return/swap/summon stays on the existing original phase queue and runner.
export async function advancePreBattleSwitch(context,inputs,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128&&decisionId!==context.decision.id,'INVALID_SWITCH_DECISION_ID');
  check(typeof driver?.resumeChoice==='function','SWITCH_DRIVER_UNAVAILABLE');
  const c=codec.restore(codec.capture(context)),state=c.continuation,d=state.currentPhase,kind=c.decision.kind;
  check(['switch-confirm','switch-select'].includes(kind)&&d?.remaining===kind&&state.standbyPhase===null&&c.pendingEffects.length===0,'UNSAFE_PRE_BATTLE_SWITCH');
  const seat=c.decision.requiredSeats[0],actions=copy(inputs);
  check(actions&&typeof actions==='object'&&!Array.isArray(actions)&&Object.keys(actions).join(',')===String(seat),'INCOMPLETE_SWITCH_INPUTS');codec.validateAction(c,seat,actions[seat]);
  const before=codec.capture(c);
  const r=await driver.resumeChoice(c,d.phase,{seat,kind,action:actions[seat]});
  check(r?.completed===true&&r.pendingTasks===0&&Array.isArray(r.events)&&Array.isArray(r.grants)&&r.grants.length===0,'INCOMPLETE_SWITCH_CALLBACK');
  check(c.continuation===state&&state.currentPhase===d&&d.remaining===kind&&state.standbyPhase===null,'INVALID_SWITCH_RESULT');
  state.currentPhase=null;c.decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
  const after=codec.capture(c);
  const stable=s=>{const v=copy(s);delete v.decision;delete v.continuation;return canonical(v);};
  check(stable(before)===stable(after),'SWITCH_CHOICE_MODEL_CHANGED');
  const old=before.continuation,next=after.continuation;
  for(const key of ['phaseQueue','nextCommandPhaseQueue','phaseQueuePrependSpliceIndex'])
    check(canonical(old[key])===canonical(next[key]),'SWITCH_CHOICE_QUEUE_CHANGED');
  const queued=kind==='switch-confirm'?actions[seat].accept:actions[seat].pokemonId!==null;
  check(old.phaseQueuePrependSpliceIndex===-1&&next.phaseQueuePrepend.length===old.phaseQueuePrepend.length+(queued?1:0)
    &&canonical(next.phaseQueuePrepend.slice(0,old.phaseQueuePrepend.length))===canonical(old.phaseQueuePrepend),'SWITCH_CHOICE_QUEUE_CHANGED');
  if(queued){const added=next.phaseQueuePrepend.at(-1),p=added.phase,f=p.fields;
    check(added.kind==='original-phase'&&added.remaining==='start'&&p.scope===seat
      &&p.type===(kind==='switch-confirm'?'SwitchPhase':'SwitchSummonPhase')&&f.doReturn?.value===true
      &&f.fieldIndex?.value===(kind==='switch-confirm'?seat:0),'INVALID_SWITCH_CHOICE_QUEUE');
    if(kind==='switch-confirm')check(f.isModal?.value===false,'INVALID_SWITCH_CHOICE_QUEUE');
    else check(f.batonPass?.value===false&&f.player?.value===true&&f.slotIndex?.value===c.roster.entries.find(e=>e.pokemon.id===actions[seat].pokemonId)?.index,
      'INVALID_SWITCH_CHOICE_QUEUE');
  }
  if(driver.finishBoundary){
    check(typeof driver.finishBoundary==='function'&&driver.finishBoundary.constructor.name!=='AsyncFunction','RULE_BOUNDARY_DRIVER_UNAVAILABLE');
    const decision=driver.finishBoundary(c,d.phase,decisionId);
    check(decision&&!decision.then&&decision.id===decisionId,'INVALID_RULE_DECISION');c.decision=decision;codec.capture(c);
  }
  return {context:c,events:copy(r.events),grants:[]};
}
