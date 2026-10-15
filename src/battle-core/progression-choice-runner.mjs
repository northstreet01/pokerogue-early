import {copy,canonical,requireContract as check} from './coop-contract.mjs';
import {applySafeDecisionAction} from './safe-decisions.mjs';

// Reuse M2 choice validation/coordination, resuming only the saved original
// learning/evolution rule segment. Never restart the suspended Phase.
export async function advanceProgressionChoice(context,inputs,codec,safe,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128
    &&decisionId!==context.decision.id,'INVALID_PROGRESSION_DECISION_ID');
  const saved=codec.capture(context),d=context.decision,current=context.continuation.currentPhase,
    phase=saved.continuation.currentPhase?.phase;
  check(['learn-move','evolution'].includes(d.kind)&&d.requiredSeats.length===1
    &&current?.kind==='original-phase'&&context.continuation.standbyPhase===null,'UNSAFE_PROGRESSION_BOUNDARY');
  const seat=d.requiredSeats[0],actions=copy(inputs),party=context.roster.entries
    .filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index);
  check(actions&&typeof actions==='object'&&!Array.isArray(actions)&&Object.keys(actions).join(',')===String(seat),
    'INCOMPLETE_PROGRESSION_INPUTS');
  check(phase.scope===seat&&(d.kind==='learn-move'
    ?phase.type==='LearnMovePhase'&&current.remaining==='learn-apply'
      &&party[current.phase.partyMemberIndex]?.pokemon.id===d.learn.pokemonId&&current.phase.moveId===d.learn.moveId
    :phase.type==='EvolutionPhase'&&current.remaining===(d.stage==='pause-confirm'?'evolution-pause':'evolution-apply')
      &&current.phase.pokemon.id===d.pokemonId&&current.phase.lastLevel===d.lastLevel
      &&canonical(phase.fields.evolution.value)===canonical(d.reference)), 'INVALID_PROGRESSION_PHASE');
  codec.validateAction(context,seat,actions[seat]);
  check(canonical(codec.capture(context))===canonical(saved),'VALIDATOR_MUTATED_STATE');
  const run=async(c,method,intent)=>{
    check(typeof driver?.[method]==='function','PROGRESSION_DRIVER_UNAVAILABLE');
    const state=c.continuation,descriptor=state.currentPhase,remaining=descriptor.remaining;
    const result=await driver[method](c,descriptor.phase,{seat,...intent});
    check(result?.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)&&Array.isArray(result.grants),
      'INCOMPLETE_PROGRESSION_CALLBACK');
    check(c.continuation===state&&state.currentPhase===descriptor&&descriptor.remaining===remaining
      &&state.standbyPhase===null,'INVALID_PROGRESSION_RESULT');
    state.currentPhase=null;c.decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
    return result;
  };
  const result=await applySafeDecisionAction(context,seat,actions[seat],codec,safe,{
    learnMove:(c,_seat,a)=>run(c,'resumeLearning',{action:a}),
    evolve:c=>run(c,'resumeEvolution',{cancelled:false}),
    endEvolution:c=>run(c,'resumeEvolution',{cancelled:true})
  });
  if(result.context.decision.kind==='evolution'){
    check(actions[seat].choice==='cancel'&&result.context.decision.stage==='pause-confirm','INVALID_PROGRESSION_RESULT');
    check(typeof driver?.stageEvolutionPause==='function','PROGRESSION_DRIVER_UNAVAILABLE');
    const candidate=result.context,state=candidate.continuation,descriptor=state.currentPhase;
    const paused=await driver.stageEvolutionPause(candidate,descriptor.phase,{seat});
    check(paused?.completed===false&&paused.suspended===true&&paused.pendingTasks===0
      &&Array.isArray(paused.events)&&Array.isArray(paused.grants),'INCOMPLETE_PROGRESSION_CALLBACK');
    check(candidate.continuation===state&&state.currentPhase===descriptor&&descriptor.remaining==='evolution-apply'
      &&state.standbyPhase===null,'INVALID_PROGRESSION_RESULT');
    result.events.push(...copy(paused.events));result.grants.push(...copy(paused.grants));
    descriptor.remaining='evolution-pause';
    result.context.decision.id=decisionId;
  }
  codec.capture(result.context);return result;
}
