import {canonical,copy,requireContract as check} from './coop-contract.mjs';
import {advancePreparation,coopRewardExclusions} from './preparation-runner.mjs';

export function validatePreparationEffect(c,seat,action,safe,driver){
  safe.validateAction(c,seat,action);
  check(c.decision.kind==='preparation'&&c.decision.players[seat].subdecision===null&&c.decision.players[seat].selection===null,'PREPARATION_EFFECT_UNAVAILABLE');
  if(['skip-reward','ready','unready'].includes(action.operation))return;
  check(['reward','buy','reroll'].includes(action.operation)&&typeof driver?.validate==='function','PREPARATION_EFFECT_UNAVAILABLE');
  driver.validate(c,seat,action);
}

// Original callback owns the charge/effect. Do not run M2's applyModifier or
// reroll hooks as well: that would charge the same personal purchase twice.
export async function advancePreparationEffect(context,seat,action,codec,safe,driver){
  validatePreparationEffect(context,seat,action,safe,driver);
  if(['skip-reward','ready','unready'].includes(action.operation))return advancePreparation(context,seat,action,codec,safe);
  check(typeof driver.execute==='function','PREPARATION_DRIVER_UNAVAILABLE');
  const c=codec.restore(codec.capture(context)),d=c.decision,p=d.players[seat],before=codec.capture(c);
  // Component indices can move when this player gains a modifier. Compare a
  // projection with their resources omitted, so peer and enemy identities are
  // protected by actual state rather than incidental component table indices.
  const protectedState=ctx=>codec.capture({...ctx,players:ctx.players.map((player,index)=>index===seat
    ?{money:0,pokeballCounts:{0:0,1:0,2:0,3:0,4:0},modifiers:[]}:player)});
  const protectedBefore=protectedState(c);
  check(c.continuation.currentPhase===null&&c.continuation.standbyPhase===null,'UNSAFE_PREPARATION_BOUNDARY');
  const pending=before.pendingEffects.filter(e=>e.phase.type==='SelectModifierPhase'&&e.phase.scope===seat);
  check(pending.length===1&&pending[0].phase.fields.rerollCount.value===p.rerollCount,'INVALID_PREPARATION_OWNER');
  const effect=c.pendingEffects.find(e=>e.id===pending[0].id),oldCount=p.rerollCount;
  const result=await driver.execute(c,effect.phase,{seat,action});
  check(result?.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)&&Array.isArray(result.grants)
    &&result.grants.length===0,'INCOMPLETE_PREPARATION_EFFECT');
  check(c.decision===d&&d.players[seat]===p&&c.continuation.currentPhase===null&&c.continuation.standbyPhase===null,'INVALID_PREPARATION_RESULT');
  check(canonical(codec.capture(c).continuation)===canonical(before.continuation),'PREPARATION_CHANGED_BATTLE_QUEUE');
  // Protect the other player's resources and Pokemon, plus battle/egg state.
  const after=codec.capture(c);
  const protectedAfter=protectedState(c);
  check(canonical(after.decision)===canonical(before.decision),'INVALID_PREPARATION_RESULT');
  check(canonical(after.pendingEffects)===canonical(before.pendingEffects),'INVALID_PREPARATION_RESULT');
  for(const key of ['battle','arena','scene','eggState','enemyModifiers'])check(canonical(protectedAfter[key]??null)===canonical(protectedBefore[key]??null),'PREPARATION_CHANGED_BATTLE_STATE');
  check(canonical(d.players[1-seat])===canonical(before.decision.players[1-seat]),'PREPARATION_CHANGED_PEER');
  check(canonical(protectedAfter.components)===canonical(protectedBefore.components)
    &&canonical(protectedAfter.players[1-seat])===canonical(protectedBefore.players[1-seat]),'PREPARATION_CHANGED_PEER');
  check(canonical(after.roster.entries.filter(e=>e.owner!==seat))===canonical(before.roster.entries.filter(e=>e.owner!==seat))
    &&canonical(after.roster.field)===canonical(before.roster.field)&&canonical(after.roster.retiredIds)===canonical(before.roster.retiredIds),
  'PREPARATION_CHANGED_PEER');
  check(canonical(after.roster.entries.map(({pokemon,...entry})=>entry))===canonical(before.roster.entries.map(({pokemon,...entry})=>entry))
    &&canonical(after.roster.entries.filter(e=>e.owner===seat&&e.group==='reserve'))===canonical(before.roster.entries.filter(e=>e.owner===seat&&e.group==='reserve'))
    &&canonical(after.roster.ruleGroups)===canonical(before.roster.ruleGroups)&&canonical(after.roster.tagGroups)===canonical(before.roster.tagGroups),
  'PREPARATION_CHANGED_ROSTER');
  const peer=c.players[1-seat];check(peer.money===context.players[1-seat].money
    &&canonical(peer.pokeballCounts)===canonical(context.players[1-seat].pokeballCounts),'PREPARATION_CHANGED_PEER');
  if(action.operation==='reroll'){
    check(c.players[seat].money===context.players[seat].money-p.rerollCost,'INVALID_PREPARATION_CHARGE');
    check(result.menu&&result.phase,'INCOMPLETE_PREPARATION_REROLL');
    p.rerollCount=oldCount+1;p.rerollCost=result.menu.rerollCost;p.rewards=copy(result.menu.rewards);p.shop=copy(result.menu.shop);
    check(p.rewards.every(o=>!coopRewardExclusions.includes(o.type.catalogId)),'COOP_REWARD_EXCLUDED');
    effect.phase=result.phase;
  }else if(action.operation==='reward'){
    check(result.ended===true,'INCOMPLETE_PREPARATION_EFFECT');p.rewardResolved=true;
  }else {
    const selected=p.shop.find(o=>o.id===action.optionId);
    check(result.ended===false,'INVALID_PREPARATION_SHOP_END');
    check(c.players[seat].money===context.players[seat].money-selected.cost,'INVALID_PREPARATION_CHARGE');
  }
  p.ready=false;
  const match=/^(.*?)(?:~(\d+))?$/.exec(d.id),step=Number(match[2]??0)+1;
  check(Number.isSafeInteger(step)&&`${match[1]}~${step}`.length<=128,'DECISION_SEQUENCE_EXHAUSTED');d.id=`${match[1]}~${step}`;
  const saved=codec.capture(c),owned=saved.pendingEffects.find(e=>e.id===effect.id);
  check(owned?.phase.type==='SelectModifierPhase'&&owned.phase.scope===seat&&owned.phase.fields.rerollCount.value===p.rerollCount,'INVALID_PREPARATION_OWNER');
  if(result.growth!==undefined){
    check(action.operation==='reward'&&Array.isArray(result.growth)&&result.growth.length>0&&result.growth.length<=1000,
      'INVALID_PREPARATION_GROWTH');
    check(!c.pendingEffects.some(e=>e.id.startsWith(`preparation-growth-${seat}-`)),'PREPARATION_GROWTH_PENDING');
    c.pendingEffects.push(...result.growth.map((phase,index)=>({id:`preparation-growth-${seat}-${index}`,phase,remaining:'start'})));
    const growth=codec.capture(c).pendingEffects.filter(e=>e.id.startsWith(`preparation-growth-${seat}-`));
    check(growth.every(e=>e.phase.scope===seat&&e.phase.type==='LevelUpPhase'),'INVALID_PREPARATION_GROWTH');
  }
  return {context:c,events:copy(result.events),grants:[]};
}
