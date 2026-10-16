import {codec} from './decision-model.mjs';
import {nextBattleDriver,nextBattleContext} from './next-battle-model.mjs';
import {bindEncounterModifierScenes} from './encounter-modifier-binding.mjs';
import {persistentType} from './persistent-rewards-model.mjs';
import {modifiers} from './modifier-model.mjs';
import {originalPhases} from './phase-model.mjs';
import {bindAction} from './move-execution-model.mjs';
import {advanceNextBattle} from '../../src/battle-core/next-battle-runner.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {preBattleDriver,advancePreBattle,choosePreBattle,referencePreBattle} from './pre-battle-switch-model.mjs';
import {finishRoundBoundary} from './round-loop-model.mjs';
import {copy,requireContract as check} from '../../src/battle-core/coop-contract.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';

const personalTypes=new Set(['EXP_CHARM','HEALING_CHARM','EXP_SHARE','LUCKY_EGG','GOLDEN_EGG',
  'BASE_STAT_BOOSTER','SOUL_DEW','ATTACK_TYPE_BOOSTER','BERRY','TEMP_STAT_BOOSTER']);
const enemyTypes=new Set(['BERRY','BASE_STAT_BOOSTER','ATTACK_TYPE_BOOSTER','LUCKY_EGG','GOLDEN_EGG']);
export function encounterModifierDriver(options={}){
  const base=nextBattleDriver({...options,encounterModifiers:true,preBattleSwitch:true,
    bindEncounterModifiers:options.bindModifiers??((c,_p,b,t)=>bindEncounterModifierScenes(c,b,t,options))});
  return {...base,
    validateBranch(c){base.validateBranch(c);
      check(c.players.every(p=>p.modifiers.every(m=>m instanceof modifiers.PersistentModifier&&personalTypes.has(m.type.generatorId||m.type.id))),
        'UNSUPPORTED_PERSONAL_ENCOUNTER_MODIFIER');
    },
    validateEnemyModifiers(c){return c.enemyModifiers.every(m=>m instanceof modifiers.PokemonHeldItemModifier
      &&enemyTypes.has(m.type.generatorId||m.type.id)&&c.battle.enemyParty.some(pk=>pk.id===m.pokemonId)
      &&m.stackCount>0&&m.virtualStackCount===0);}
  };
}
export const createEncounter=(c,options={})=>advanceNextBattle(c,codec,encounterModifierDriver(options),{decisionId:`encounter-${c.battle.waveIndex+1}-0`});
export async function encounterContext({seed='encounter-items-0',personal=true,reserves=false}={}){
  const c=await nextBattleContext();c.scene.seed=seed;
  if(reserves)for(const e of c.roster.entries.filter(e=>e.owner!==null&&e.index===1)){e.pokemon.hp=100;e.pokemon.status=null;}
  if(personal)for(const [seat,id,stack]of [[0,'BASE_STAT_BOOSTER',4],[0,'EXP_CHARM',2],[1,'SOUL_DEW',3],[1,'LUCKY_EGG',1]]){
    const type=persistentType(id),pk=c.roster.entries.find(e=>e.owner===seat&&e.index===0).pokemon;
    const m=type.newModifier(...(id==='EXP_CHARM'?[]:[pk]));m.stackCount=stack;c.players[seat].modifiers.push(m);
  }
  // Personal stats already come from prior original reward/BattleEnd updates.
  // Do not add a new player update to Encounter where the original has none.
  await inspectPersonalStats(c,pk=>pk.calculateStats());
  return codec.restore(copy(codec.capture(c)));
}
export async function inspectPersonalStats(c,probe,options={}){
  const b=bindAction(c,new originalPhases.TurnInitPhase({})),tasks=createRuleTaskTracker(b.scene);
  const binding=bindEncounterModifierScenes(c,b,tasks,options);
  try{const result=c.roster.entries.filter(e=>e.owner!==null).map(e=>probe(e.pokemon,e.owner));await binding.drain();return result;}
  finally{binding.dispose();tasks.close();b.dispose();}
}
export function encounterEntryDriver(options={}){
  const base=preBattleDriver(options),mod=encounterModifierDriver(options);
  return {...base,execute:(c,p)=>p.constructor===originalPhases.PostSummonPhase?mod.execute(c,p):base.execute(c,p),
    finishBoundary:finishRoundBoundary};
}
export function advanceEncounterEntry(c,inputs={},options={}){
  if(c.decision.kind!=='continuing')return advancePreBattle(c,inputs,options);
  return advanceQueuedRulePhase(c,codec,encounterEntryDriver(options),{decisionId:`entry-${Number(c.decision.id.split('-').at(-1))+1}`});
}
export async function referenceEncounter(c,options={}){
  const driver=encounterModifierDriver({...options,reference:true});driver.validateBranch(c);const events=[];
  for(let i=0;i<2;i++){
    const d=selectNextPhase(c.continuation,()=>check(false,'EMPTY_ENCOUNTER')).phase,r=await driver.execute(c,d.phase);
    check(r.completed&&r.pendingTasks===0,'INCOMPLETE_ENCOUNTER');c.continuation.currentPhase=null;events.push(...r.events);
  }
  c.decision={id:`encounter-${c.battle.waveIndex}-0`,kind:'continuing',requiredSeats:[],reason:'effects'};codec.capture(c);
  return {context:c,events,grants:[]};
}
export async function referenceEncounterEntry(c,inputs={},options={}){
  if(c.decision.kind!=='continuing')return referencePreBattle(c,inputs,options);
  const id=`entry-${Number(c.decision.id.split('-').at(-1))+1}`,driver=encounterEntryDriver({...options,reference:true});
  const d=c.continuation.currentPhase||selectNextPhase(c.continuation,()=>check(false,'EMPTY_ENCOUNTER_ENTRY')).phase;
  const r=await(c.continuation.currentPhase===d&&d.remaining!=='start'?driver.resume(c,d.phase,d.remaining):driver.execute(c,d.phase));
  check((r.completed||r.suspended)&&r.pendingTasks===0,'INCOMPLETE_ENCOUNTER_ENTRY');
  if(r.suspended){const stop=driver.suspendBoundary(c,d.phase,id,r);d.remaining=stop.remaining;c.decision=stop.decision;}
  else{c.continuation.currentPhase=null;c.decision=driver.finishBoundary(c,d.phase,id);}
  codec.capture(c);return {context:c,events:r.events,grants:[]};
}
export {choosePreBattle};
