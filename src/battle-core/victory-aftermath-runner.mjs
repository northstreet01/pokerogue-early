import {copy,requireContract as check} from './coop-contract.mjs';
import {selectNextPhase} from './phase-queue.mjs';

// Resume only a Victory whose experience work has already drained. The
// original remainder appends BattleEnd/rewards behind remaining turn actions.
export async function advanceVictoryAftermath(context,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128&&decisionId!==context.decision.id,
    'INVALID_VICTORY_DECISION_ID');
  check(typeof driver?.supports==='function'&&typeof driver.resumeVictory==='function','VICTORY_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation;
  check(candidate.decision.kind==='continuing'&&candidate.decision.reason==='effects'
    &&state.currentPhase===null&&state.standbyPhase===null,'UNSAFE_VICTORY_BOUNDARY');
  check(candidate.roster.entries.some(e=>e.owner!==null&&e.group==='party'&&!e.pokemon.isFainted()),
    'UNCONFIRMED_SIMULTANEOUS_WIPE');
  const descriptor=selectNextPhase(state,()=>check(false,'VICTORY_QUEUE_EMPTY')).phase;
  check(descriptor?.kind==='original-phase'&&descriptor.remaining==='victory-aftermath'
    &&descriptor.phase.player===false&&[2,3].includes(descriptor.phase.battlerIndex)
    &&typeof descriptor.phase.queueAftermath==='function'&&typeof descriptor.phase.recordDefeat==='function'
    &&driver.supports(candidate,descriptor.phase)===true,'UNSUPPORTED_VICTORY_PHASE');
  const result=await driver.resumeVictory(candidate,descriptor.phase);
  check(result?.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)&&Array.isArray(result.grants),
    'INCOMPLETE_VICTORY_AFTERMATH');
  check(candidate.continuation===state&&state.currentPhase===descriptor&&descriptor.remaining==='victory-aftermath'
    &&state.standbyPhase===null,'INVALID_VICTORY_RESULT');
  state.currentPhase=null;candidate.decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
  codec.capture(candidate);return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
}

// PLAY-07 is the only cooperative rule here: after a won battle, revive just
// the first personal party member when that entire party is fainted. The
// caller supplies the original 50-percent revive effect; no item is consumed.
export function recoverVictoryParties(context,applyRevive){
  check(typeof applyRevive==='function','REVIVE_RULE_UNAVAILABLE');
  const parties=[0,1].map(seat=>context.roster.entries.filter(e=>e.owner===seat&&e.group==='party')
    .sort((a,b)=>a.index-b.index).map(e=>e.pokemon));
  check(parties.every(p=>p.length>0)&&parties.some(p=>p.some(pk=>!pk.isFainted())),'UNCONFIRMED_SIMULTANEOUS_WIPE');
  check(context.battle?.enemyParty.length>0&&context.battle.enemyParty.every(p=>p.isFainted(true)),
    'BATTLE_NOT_WON');
  const recovered=[];
  for(const [seat,party]of parties.entries())if(party.every(p=>p.isFainted())){
    const pokemon=party[0],before=pokemon.hp,result=applyRevive(pokemon,seat);
    check(result===true&&!pokemon.isFainted(),'INCOMPLETE_VICTORY_RECOVERY');
    recovered.push({kind:'victory-recovery',seat,pokemonId:pokemon.id,hpBefore:before,hp:pokemon.hp});
  }
  return recovered;
}
