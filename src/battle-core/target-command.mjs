import { copy, canonical, requireContract as check } from './coop-contract.mjs';

/** Original SelectTargetPhase callback, with presentation/queue effects supplied
 * by the caller. Keep the selected slot in command.targets, not move.targets. */
export function applyTargetSelection(commands, fieldIndex, cursor, rules, command = commands[fieldIndex]) {
  if (cursor === -1) {
    commands[fieldIndex] = null;
    rules.requeueCommand(fieldIndex);
  } else command.targets = [cursor];
  if (command.command === rules.ballCommand && fieldIndex) commands[fieldIndex - 1].skip = true;
}

export function createTargetDecision(id, context, fieldIndex, getMoveTargets) {
  check(fieldIndex === 0 || fieldIndex === 1, 'INVALID_TARGET_DECISION');
  const entry = context.roster.entries.find(e => e.pokemon.id === context.roster.field[fieldIndex]);
  const command = context.battle.turnCommands[fieldIndex];
  check(entry?.owner === fieldIndex && entry.pokemon.hp > 0 && command?.command === 0 && command.move && !command.skip, 'INVALID_TARGET_DECISION');
  const selection = getMoveTargets(entry.pokemon, command.move.move);
  check(selection && !selection.multiple && selection.targets.length > 1, 'INVALID_TARGET_DECISION');
  return { id, kind: 'wait-target', requiredSeats: [fieldIndex],
    options: { [fieldIndex]: [...selection.targets, -1].map(target => ({ kind:'target', pokemonId:entry.pokemon.id, target })) },
    target: { fieldIndex, pokemonId:entry.pokemon.id, moveId:command.move.move, targets:copy(selection.targets) } };
}
export function resolveTargetIntent(context, seat, action, getMoveTargets) {
  check(context.decision.kind === 'wait-target' && context.decision.target.fieldIndex === seat, 'INVALID_TARGET_DECISION');
  const expected = createTargetDecision(context.decision.id, context, seat, getMoveTargets);
  check(canonical(expected) === canonical(context.decision), 'STALE_TARGET_DECISION');
  check(expected.options[seat].some(option => canonical(option) === canonical(action)), 'INVALID_MOVE_TARGET');
  return action.target;
}
