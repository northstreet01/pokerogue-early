import {canonical,copy,requireContract as check} from './coop-contract.mjs';
import {selectNextPhase} from './phase-queue.mjs';

// NewBattle has levels but no enemies until Encounter completes. These two
// original phases therefore form one transaction, never an invalid checkpoint.
export async function advanceNextBattle(context,codec,driver,{decisionId}={}){
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128&&decisionId!==context.decision.id,'INVALID_RULE_DECISION_ID');
  check(typeof driver?.validateBranch==='function'&&typeof driver?.phaseKind==='function'
    &&typeof driver?.execute==='function','NEXT_BATTLE_DRIVER_UNAVAILABLE');
  const before=codec.capture(context),c=codec.restore(before),state=c.continuation;
  // Enemy items occupy component slots before personal inventories. Compare
  // the existing M2 projection with enemy/loot items omitted, not their indices.
  const personalResources=ctx=>{
    const battle=Object.assign(Object.create(Object.getPrototypeOf(ctx.battle)),ctx.battle,{postBattleLoot:[]});
    const s=codec.capture({...ctx,battle,enemyModifiers:[]});
    return {players:s.players,components:s.components,modifierTypeGroups:s.modifierTypeGroups};
  };
  check(c.decision.kind==='continuing'&&c.decision.reason==='next-battle'&&state.currentPhase===null
    &&state.standbyPhase===null&&c.pendingEffects.length===0,'UNSAFE_NEXT_BATTLE_BOUNDARY');
  check(c.battle?.enemyParty.length>0&&c.battle.enemyParty.every(p=>p.isFainted(true)),'BATTLE_NOT_WON');
  check([...before.continuation.phaseQueuePrepend,...before.continuation.phaseQueue].length===1
    &&before.continuation.nextCommandPhaseQueue.length===0,'UNSUPPORTED_NEXT_BATTLE_QUEUE');
  driver.validateBranch(c);
  const personalBefore=personalResources(c);
  const events=[];
  for(const kind of ['NewBattlePhase','NextEncounterPhase']){
    const d=selectNextPhase(state,()=>check(false,'NEXT_BATTLE_QUEUE_EMPTY')).phase;
    if(kind==='NextEncounterPhase'&&d?.kind==='original-phase'&&['ReturnPhase','ShowTrainerPhase'].includes(driver.phaseKind(d.phase))){
      let pre=d;
      while(pre?.kind==='original-phase'&&['ReturnPhase','ShowTrainerPhase'].includes(driver.phaseKind(pre.phase))){
        const returned=await driver.execute(c,pre.phase);
        check(returned?.completed===true&&returned.pendingTasks===0&&Array.isArray(returned.events)&&Array.isArray(returned.grants),
          'INCOMPLETE_NEXT_BATTLE_PHASE');
        state.currentPhase=null;events.push(...returned.events);
        pre=selectNextPhase(state,()=>check(false,'NEXT_BATTLE_QUEUE_EMPTY')).phase;
      }
      check(pre?.kind==='original-phase'&&pre.remaining==='start'&&driver.phaseKind(pre.phase)===kind,
        'UNSUPPORTED_NEXT_BATTLE_PHASE');
      const r=await driver.execute(c,pre.phase);
      check(r?.completed===true&&r.pendingTasks===0&&Array.isArray(r.events)&&Array.isArray(r.grants)
        &&r.grants.length===0,'INCOMPLETE_NEXT_BATTLE_PHASE');
      state.currentPhase=null;events.push(...r.events);continue;
    }
    check(d?.kind==='original-phase'&&d.remaining==='start'&&driver.phaseKind(d.phase)===kind,
      'UNSUPPORTED_NEXT_BATTLE_PHASE');
    const r=await driver.execute(c,d.phase);
    check(r?.completed===true&&r.pendingTasks===0&&Array.isArray(r.events)&&Array.isArray(r.grants)
      &&r.grants.length===0,'INCOMPLETE_NEXT_BATTLE_PHASE');
    check(c.continuation===state&&state.currentPhase===d&&state.standbyPhase===null,'INVALID_RULE_RESULT');
    state.currentPhase=null;events.push(...r.events);
  }
  c.decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
  const after=codec.capture(c);
  if(c.battle.battleType===1){
    check(c.battle.battleSpec===0&&c.battle.waveIndex===context.battle.waveIndex+1
      &&c.battle.double===true&&c.battle.turn===1&&c.battle.trainer&&c.battle.enemyParty.length>0
      &&c.battle.enemyParty.every(p=>!p.isFainted(true)), 'INVALID_NEXT_BATTLE_RESULT');
  } else check(c.battle.waveIndex===context.battle.waveIndex+1&&c.battle.double===true
    &&c.battle.battleType===0&&c.battle.battleSpec===0&&c.battle.turn===1
    &&c.battle.enemyParty.length===2&&c.battle.enemyParty.every(p=>!p.isFainted(true)), 'INVALID_NEXT_BATTLE_RESULT');
  check(canonical(personalBefore)===canonical(personalResources(c))&&canonical(before.eggState??null)===canonical(after.eggState??null)
    &&canonical(before.arena)===canonical(after.arena),
    'NEXT_BATTLE_RESOURCE_CHANGED');
  if(driver.validateEnemyModifiers){
    check(typeof driver.validateEnemyModifiers==='function'&&driver.validateEnemyModifiers.constructor.name!=='AsyncFunction','ENCOUNTER_MODIFIER_VALIDATOR_UNAVAILABLE');
    check(driver.validateEnemyModifiers(c)===true,'INVALID_ENCOUNTER_MODIFIERS');
  }else check(canonical(before.enemyModifiers)===canonical(after.enemyModifiers),'NEXT_BATTLE_RESOURCE_CHANGED');
  check(canonical(c.roster.field.slice(0,2))===canonical(context.roster.field.slice(0,2)),'NEXT_BATTLE_OWNER_CHANGED');
  const party=s=>s.roster.entries.filter(e=>e.owner!==null).map(e=>{
    const entry=copy(e);delete entry.pokemon.fields.battleData;return entry;
  });
  check(canonical(party(before))===canonical(party(after)),'NEXT_BATTLE_PARTY_CHANGED');
  const partyIds=new Set(context.roster.entries.filter(e=>e.owner!==null).map(e=>e.pokemon.id));
  for(const group of [...after.roster.ruleGroups,...after.roster.tagGroups]){
    check(!(group.some(ref=>partyIds.has(ref.pokemonId))&&group.some(ref=>!partyIds.has(ref.pokemonId))),
      'NEXT_BATTLE_ENEMY_PARTY_ALIAS');
  }
  const groups=s=>s.roster.ruleGroups.map(group=>group.filter(ref=>partyIds.has(ref.pokemonId)
    &&ref.path[0]!=='battleData')).filter(group=>new Set(group.map(ref=>ref.pokemonId)).size>1);
  check(canonical(groups(before))===canonical(groups(after)),'NEXT_BATTLE_PARTY_ALIAS_CHANGED');
  return {context:c,events:copy(events),grants:[]};
}
