import {effectContext,executePreparation,optionAction} from './preparation-effects-model.mjs';
import {types,modifiers} from './modifier-model.mjs';
import {codec} from './decision-model.mjs';
export {executePreparation,optionAction};
export function persistentType(id){
  const type=id==='BASE_STAT_BOOSTER'?new types.PokemonBaseStatBoosterModifierType('HP Up',0)
    :id==='ATTACK_TYPE_BOOSTER'?new types.AttackTypeBoosterModifierType(0,20)
    :id==='BERRY'?new types.BerryModifierType(0)
    :id==='TEMP_STAT_BOOSTER'?new types.TempBattleStatBoosterModifierType(0):types.modifierTypes[id]();
  type.id=id;type.tier=['BASE_STAT_BOOSTER','BERRY'].includes(id)?1:2;return type;
}
export async function persistentContext({id='EXP_CHARM',seat=0,existing=0,peerModifier=false,target=null}={}){
  const c=await effectContext(),type=persistentType(id);
  c.decision.players[seat].rewards=[{id:'persistent-reward',type:types.captureModifierTypeState(type),cost:0}];
  const pk=c.roster.entries.find(e=>e.owner===seat&&e.pokemon.id===(target??100+seat))?.pokemon;
  if(existing){const m=type.newModifier(...(type instanceof types.PokemonModifierType?[pk]:[]));m.stackCount=existing;c.players[seat].modifiers.push(m);}
  if(peerModifier){const t=types.modifierTypes.EXP_CHARM();t.id='EXP_CHARM';c.players[1-seat].modifiers.push(new modifiers.ExpBoosterModifier(t,25,2));}
  return codec.restore(codec.capture(c));
}
export function rewardIntent(c,seat=0){const o=c.decision.players[seat].rewards[0],type=types.restoreModifierTypeState(o.type);
  return optionAction(c,seat,'reward',o.type.catalogId,type instanceof types.PokemonModifierType?100+seat:null);}
