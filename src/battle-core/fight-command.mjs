import { copy, requireContract as check } from './coop-contract.mjs';

// Original CommandPhase FIGHT selection. Trusted internal args retain early's
// positional override semantics; never pass unvalidated network args here.
export function selectFightCommand(pokemon, fieldIndex, cursor, args, rules) {
  let useStruggle = false;
  if (!(cursor === -1 || pokemon.trySelectMove(cursor, args[0])
    || (useStruggle = cursor > -1 && !pokemon.getMoveset().filter(m => m.isUsable(pokemon)).length))) return null;
  const moveId = !useStruggle ? cursor > -1 ? pokemon.getMoveset()[cursor].moveId : rules.noneMove : rules.struggleMove;
  const command = { command: rules.fightCommand, cursor, move: { move: moveId, targets: [], ignorePP: args[0] }, args };
  const targets = args.length < 3 ? rules.getMoveTargets(pokemon, moveId) : args[2];
  if (!moveId) command.targets = [fieldIndex];
  const needsTarget = targets.targets.length > 1 && !targets.multiple;
  if (!needsTarget) command.move.targets = targets.targets;
  return { command, targets, needsTarget };
}

// Network intent is deliberately narrower than trusted Phase arguments. Queue
// continuation/Encore handling belongs to the authoritative runner, not input.
export function resolveFightIntent(pokemon, fieldIndex, input, rules) {
  const intent = copy(input);
  check(intent && Object.keys(intent).sort().join(',') === 'cursor,kind,pokemonId,target'
    && intent.kind === 'fight' && intent.pokemonId === pokemon.id
    && Number.isInteger(fieldIndex) && fieldIndex >= 0 && fieldIndex <= 1, 'INVALID_FIGHT_INTENT');
  check(Number.isInteger(intent.cursor) && intent.cursor >= 0 && intent.cursor < pokemon.getMoveset().length, 'INVALID_MOVE_CURSOR');
  check(pokemon.hp > 0 && pokemon.getMoveQueue().length === 0, 'UNSUPPORTED_FORCED_COMMAND');
  // Forced tags (e.g. Encore) must be checked by the original runner before
  // offering options. This resolver does not synthesize legal options.
  const selected = selectFightCommand(pokemon, fieldIndex, intent.cursor, [false], rules);
  check(selected, 'MOVE_UNUSABLE');
  if (selected.needsTarget) {
    check(Number.isInteger(intent.target) && selected.targets.targets.includes(intent.target), 'INVALID_MOVE_TARGET');
    selected.command.targets = [intent.target];
  } else check(intent.target === null, 'UNEXPECTED_MOVE_TARGET');
  return copy(selected.command);
}
