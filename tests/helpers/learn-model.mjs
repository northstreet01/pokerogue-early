import { initialDecision } from './decision-model.mjs';
import { pokemon } from './original-model.mjs';
import { createLearnDecision } from '../../src/battle-core/learn-command.mjs';
export function learningContext() {
  const context = initialDecision(), p = context.roster.entries[0].pokemon;
  p.moveset = [0,1,2,3].map(()=>new pokemon.PokemonMove(33));
  p.summonData.moveset = p.moveset;
  context.decision = createLearnDecision('learn-57',context,0,p.id,57,id=>id===57);
  return context;
}
