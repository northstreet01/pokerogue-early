import {itemRoundContext,addBattleItem,advanceBattleItems,referenceBattleItems,chooseBattleItems} from './battle-items-model.mjs';
import {originalPhases} from './phase-model.mjs';
import {codec} from './decision-model.mjs';
import {status} from './original-model.mjs';
import {copy} from '../../src/battle-core/coop-contract.mjs';
export const advanceItems=(c,inputs={},options={})=>advanceBattleItems(c,inputs,{...options,transferAndRevive:true});
export const referenceItems=(c,inputs={},options={})=>referenceBattleItems(c,inputs,{...options,transferAndRevive:true});
export const save=c=>copy(codec.capture(c));
export const clone=c=>codec.restore(save(c));
export function queue(c,phase){c.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase,remaining:'start'}];return c;}
export const inventory=(c,seat)=>seat===null?c.enemyModifiers:c.players[seat].modifiers;
export async function transferContext({seat=0,id='MINI_BLACK_HOLE',seed='transfer-0',stack=2}={}){
  const c=await itemRoundContext({seed});
  addBattleItem(c,seat,id,{stack:id==='GRIP_CLAW'?5:1});
  if(seat===null)for(const owner of [0,1])addBattleItem(c,owner,'BERRY',{stack});
  else{addBattleItem(c,null,'BERRY',{stack});addBattleItem(c,1-seat,'LEFTOVERS');}
  if(id==='GRIP_CLAW'){
    const actor=c.roster.entries[seat??2].pokemon;
    queue(c,new originalPhases.MovePhase({},actor,[seat===null?0:2],actor.moveset[0]));
  }else queue(c,new originalPhases.TurnEndPhase({}));
  return clone(c);
}
export async function reviveContext({seat=0,prevent=false,realAction=false,fullRound=false}={}){
  const c=await itemRoundContext(),slot=seat??2,actor=c.roster.entries[slot].pokemon;
  addBattleItem(c,seat,'REVIVER_SEED');addBattleItem(c,seat===0?1:0,'REVIVER_SEED');
  if(fullRound){
    actor.hp=1;if(seat!==null){c.roster.entries[2].pokemon.stats[5]=1000;c.battle.turnCommands[2].move.targets=[seat];}
  }else if(realAction){
    actor.hp=1;const attacker=c.roster.entries[seat===null?0:2].pokemon;
    queue(c,new originalPhases.MovePhase({},attacker,[slot],attacker.moveset[0]));
  }else{
    actor.hp=0;actor.status=new status.Status(status.StatusEffect.FAINT);
    queue(c,new originalPhases.FaintPhase({},slot,prevent));
  }
  return clone(c);
}
export {chooseBattleItems};
