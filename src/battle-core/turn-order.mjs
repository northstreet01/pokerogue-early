// Extracted from early FieldPhase.getOrder and TurnStartPhase.start.
// Keep comparator evaluation and RNG consumption exactly as the original;
// precomputing speeds/priorities or shuffling ties would change the rules.
export function getFieldOrder(playerField, enemyField, { getSpeed, randomInt, isReversed, getIndex }) {
  let ordered = playerField.filter(p => p.isActive()).concat(enemyField.filter(p => p.isActive())).sort((a, b) => {
    const aSpeed = getSpeed(a) || 0, bSpeed = getSpeed(b) || 0;
    return aSpeed < bSpeed ? 1 : aSpeed > bSpeed ? -1 : !randomInt(2) ? -1 : 1;
  });
  if (isReversed()) ordered = ordered.reverse();
  return ordered.map(getIndex);
}

export function getMoveOrder(order, { getCommand, getPriorities, fightCommand }) {
  return order.slice().sort((a, b) => {
    const aCommand = getCommand(a), bCommand = getCommand(b);
    if (aCommand.command !== bCommand.command) {
      if (aCommand.command === fightCommand) return 1;
      else if (bCommand.command === fightCommand) return -1;
    } else if (aCommand.command === fightCommand) {
      const [aPriority, bPriority] = getPriorities(a, b, aCommand.move.move, bCommand.move.move);
      if (aPriority !== bPriority) return aPriority < bPriority ? 1 : -1;
    }
    const aIndex = order.indexOf(a), bIndex = order.indexOf(b);
    return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0;
  });
}
