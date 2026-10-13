import { initialDecision } from './decision-model.mjs';
import { originalPokemon } from './original-model.mjs';
import { prepareQueuedFight } from '../../src/battle-core/forced-command.mjs';
import { selectFightCommand } from '../../src/battle-core/fight-command.mjs';
import { createTargetDecision } from '../../src/battle-core/target-command.mjs';
export function targetContext() {
  const ctx = initialDecision(), enemy = originalPokemon(103, true);
  ctx.roster.entries.push({owner:null,group:'enemy',index:1,pokemon:enemy});
  ctx.roster.field[3] = 103; ctx.battle.enemyParty.push(enemy); ctx.battle.enemyLevels.push(5);
  const p = ctx.roster.entries[0].pokemon;
  const forced = prepareQueuedFight(p);
  const selected = selectFightCommand(p, 0, forced.cursor, forced.args, {fightCommand:0,noneMove:0,struggleMove:165,getMoveTargets:()=>({targets:[2,3],multiple:false})});
  ctx.battle.turnCommands[0] = selected.command;
  ctx.decision = createTargetDecision('target-1', ctx, 0, () => ({targets:[2,3],multiple:false}));
  return ctx;
}
