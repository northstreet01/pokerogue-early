import { initialDecision } from './decision-model.mjs';
import { originalPokemon } from './original-model.mjs';
import { createForcedSwitchDecision } from '../../src/battle-core/switch-command.mjs';
export function switchContext() {
  const context=initialDecision();
  for(const seat of [0,1]) {
    context.roster.entries[seat].pokemon.hp=0;
    context.roster.entries.push({owner:seat,group:'party',index:1,pokemon:originalPokemon(110+seat)});
    context.roster.entries.push({owner:seat,group:'reserve',index:0,pokemon:originalPokemon(120+seat)});
  }
  context.decision=createForcedSwitchDecision('replace-both',context,[0,1]);
  return context;
}
