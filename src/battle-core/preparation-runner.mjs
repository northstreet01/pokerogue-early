import {canonical,copy,requireContract as check} from './coop-contract.mjs';
import {selectNextPhase} from './phase-queue.mjs';
import {applySafeDecisionAction} from './safe-decisions.mjs';

// Coop is always a double battle. Keep encounter-rate items in solo pools.
export const coopRewardExclusions=Object.freeze(['LURE','SUPER_LURE','MAX_LURE']);

// The original queued shared menu is dispatched into two original personal
// menus. M2 stores already drawn options; recovery must never run start again.
export async function openPreparation(context,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128&&decisionId!==context.decision.id,'INVALID_PREPARATION_ID');
  check(typeof driver?.openPersonalMenu==='function','PREPARATION_DRIVER_UNAVAILABLE');
  const c=codec.restore(codec.capture(context)),state=c.continuation;
  check(c.decision.kind==='continuing'&&c.decision.reason==='effects'&&state.currentPhase===null
    &&state.standbyPhase===null&&c.pendingEffects.length===0,'UNSAFE_PREPARATION_BOUNDARY');
  check(c.battle?.enemyParty.length>0&&c.battle.enemyParty.every(p=>p.isFainted(true)),'BATTLE_NOT_WON');
  check(c.roster.entries.some(e=>e.owner!==null&&e.group==='party'&&!e.pokemon.isFainted()),'UNCONFIRMED_SIMULTANEOUS_WIPE');
  const before=codec.capture(c),d=selectNextPhase(state,()=>check(false,'REWARD_QUEUE_EMPTY')).phase;
  const record=[...before.continuation.phaseQueuePrepend,...before.continuation.phaseQueue].find(p=>p.phaseId===d?.phaseId);
  check(d?.kind==='original-phase'&&d.remaining==='start'&&record?.phase.type==='SelectModifierPhase'
    &&record.phase.scope===null&&d.phase.rerollCount===0,'UNSUPPORTED_PREPARATION_PHASE');
  // Only rule RNG/pools/waveSeed may change while the menus are drawn.
  const stable=()=>{const s=codec.capture({...c,continuation:{...state,currentPhase:null}});
    delete s.sceneRandom;delete s.modifierPools;delete s.scene.waveSeed;return canonical(s);};
  const previous=stable(),players=[],pending=[],events=[];
  for(const seat of [0,1]){
    const r=await driver.openPersonalMenu(c,d.phase,{seat});
    check(r?.pendingTasks===0&&r.suspended===true&&r.completed===false&&r.phase
      &&Array.isArray(r.events)&&Array.isArray(r.grants)&&r.grants.length===0,'INCOMPLETE_PREPARATION_MENU');
    check(Array.isArray(r.rewards)&&r.rewards.every(o=>!coopRewardExclusions.includes(o.type?.catalogId)),'COOP_REWARD_EXCLUDED');
    check(c.continuation===state&&state.currentPhase===d&&state.standbyPhase===null&&stable()===previous,'INVALID_PREPARATION_RESULT');
    players.push({ready:false,rewardResolved:false,rerollCount:0,rerollCost:r.rerollCost,
      rewards:copy(r.rewards),shop:copy(r.shop),selection:null,subdecision:null});
    pending.push({id:`preparation-${d.phaseId}-${seat}`,phase:r.phase,remaining:'reward-select'});events.push(...r.events);
  }
  state.currentPhase=null;c.pendingEffects.push(...pending);
  c.decision={id:decisionId,kind:'preparation',requiredSeats:[0,1],players};
  const saved=codec.capture(c);
  for(const seat of [0,1])check(saved.pendingEffects[seat].phase.type==='SelectModifierPhase'
    &&saved.pendingEffects[seat].phase.scope===seat&&saved.pendingEffects[seat].phase.fields.rerollCount.value===0,'INVALID_PREPARATION_OWNER');
  codec.capture(c);return {context:c,events:copy(events),grants:[]};
}

// Bounded initial bridge: M2 coordinates confirmed skip/ready/unready intents.
// Applying, buying, rerolling and transferring items require original effect
// handlers; they must not silently use the M2 test hooks.
export function validatePreparationAction(context,seat,action,safe){
  safe.validateAction(context,seat,action);
  check(context.decision.kind==='preparation'&&['skip-reward','ready','unready'].includes(action.operation)
    &&context.decision.players[seat].subdecision===null&&context.decision.players[seat].selection===null,'PREPARATION_EFFECT_UNAVAILABLE');
}
export function advancePreparation(context,seat,action,codec,safe){
  validatePreparationAction(context,seat,action,safe);
  return applySafeDecisionAction(context,seat,action,codec,safe,{
    nextBattle(c){
      check(c.pendingEffects.length===2&&c.pendingEffects.every(p=>p.remaining==='reward-select'),'UNSAFE_PREPARATION_END');
      const saved=codec.capture(c);
      for(const owner of [0,1])check(saved.pendingEffects.filter(p=>p.phase.type==='SelectModifierPhase'&&p.phase.scope===owner).length===1,'INVALID_PREPARATION_OWNER');
      check(c.continuation.currentPhase===null&&c.continuation.standbyPhase===null,'UNSAFE_PREPARATION_END');
      check([...saved.continuation.phaseQueuePrepend,...saved.continuation.phaseQueue].some(p=>p.kind==='original-phase'
        &&p.remaining==='start'&&p.phase.type==='NewBattlePhase'),'NEXT_BATTLE_PHASE_MISSING');
      c.pendingEffects=[];
      c.decision={id:c.decision.id,kind:'continuing',requiredSeats:[],reason:'next-battle'};
      return {events:[{kind:'preparation-ready'}],grants:[]};
    }
  });
}

// A roster transaction, separate from reward effects: those retain their strict
// PREPARATION_CHANGED_ROSTER guard. Reuse M2's existing swap, not a second swap.
export function validatePreparationReserveSwap(context,seat,action,codec,safe){
  safe.validateAction(context,seat,action);
  check(context.decision.kind==='preparation'&&action.operation==='reserve-swap','INVALID_PREPARATION_OPTION');
  const player=context.decision.players[seat];
  check(!player.ready,'PREPARATION_ALREADY_READY');
  check(player.subdecision===null&&player.selection===null,'UNRESOLVED_PREPARATION');
  const incoming=context.roster.entries.find(e=>e.pokemon.id===action.reserveId);
  check(incoming.pokemon.hp>0||context.roster.entries.some(e=>e.owner===seat&&e.group==='party'
    &&e.pokemon.id!==action.partyId&&e.pokemon.hp>0),'NO_LIVING_PARTY_MEMBER');
  const pending=codec.capture(context).pendingEffects.filter(effect=>effect.phase.scope===seat);
  check(pending.length===1&&pending[0].remaining==='reward-select'
    &&pending[0].phase.type==='SelectModifierPhase','PREPARATION_GROWTH_PENDING');
}

export async function advancePreparationReserveSwap(context,seat,action,codec,safe){
  validatePreparationReserveSwap(context,seat,action,codec,safe);
  const before=codec.capture(context);
  const result=await applySafeDecisionAction(context,seat,action,codec,safe,{});
  // Party membership changes now; actual deployment belongs to the next
  // original Encounter/Summon. An incoming member must not look summoned merely
  // because M2 remapped its field ID (it may have no summon data yet).
  if(before.roster.field[seat]===action.partyId)result.context.roster.field[seat]=null;
  const after=codec.capture(result.context),expected=copy(before);
  // Authorize only the two existing locations and this seat's field reference.
  // All Pokemon bytes, rewards, pending phases, eggs, resources and RNG stay put.
  const party=expected.roster.entries.find(e=>e.pokemon.fields.id===action.partyId);
  const reserve=expected.roster.entries.find(e=>e.pokemon.fields.id===action.reserveId);
  const partyIndex=party.index,reserveIndex=reserve.index;
  Object.assign(party,{group:'reserve',index:reserveIndex});
  Object.assign(reserve,{group:'party',index:partyIndex});
  if(expected.roster.field[seat]===action.partyId)expected.roster.field[seat]=null;
  expected.decision.id=after.decision.id;
  check(after.decision.id!==before.decision.id&&canonical(after)===canonical(expected),'INVALID_RESERVE_SWAP_RESULT');
  return {...result,events:[{kind:'preparation-reserve-swap',seat,partyId:action.partyId,reserveId:action.reserveId}]};
}
