import { canonical, requireContract as check } from './coop-contract.mjs';

// The initial branch of original LearnMovePhase.start. No setters, RNG or UI.
export function inspectLearnMove(pokemon, moveId) {
  const moves = pokemon.getMoveset();
  if (moves.findIndex(m => m?.moveId === moveId) > -1) return {kind:'known'};
  const empty = moves.length < 4 ? moves.length : moves.findIndex(m => m === null);
  return empty > -1 ? {kind:'automatic',slot:empty} : {kind:'choose'};
}
export function createLearnDecision(id, context, seat, pokemonId, moveId, hasMove) {
  const entry = context.roster.entries.find(e => e.pokemon.id === pokemonId);
  check((seat === 0 || seat === 1) && entry?.owner === seat && entry.group === 'party', 'INVALID_LEARN_OWNER');
  check(typeof hasMove === 'function' && Number.isSafeInteger(moveId) && moveId > 0 && hasMove(moveId), 'UNKNOWN_MOVE');
  check(inspectLearnMove(entry.pokemon, moveId).kind === 'choose', 'INVALID_LEARN_DECISION');
  return {id,kind:'learn-move',requiredSeats:[seat],
    options:{[seat]:[0,1,2,3,null].map(slot=>({kind:'learn-move',pokemonId,slot}))}, learn:{pokemonId,moveId}};
}
export function resolveLearnIntent(context, seat, action, hasMove) {
  check(context.decision.kind === 'learn-move', 'INVALID_LEARN_DECISION');
  const {pokemonId,moveId} = context.decision.learn;
  const expected = createLearnDecision(context.decision.id,context,seat,pokemonId,moveId,hasMove);
  check(canonical(expected) === canonical(context.decision), 'INVALID_LEARN_DECISION');
  check(expected.options[seat].some(option=>canonical(option)===canonical(action)), 'INVALID_LEARN_ACTION');
  // Original confirmation first clears the slot and queues LearnMovePhase.
  // The runner must execute that continuation (including form-change hooks).
  return action.slot === null ? {kind:'end'} : {kind:'forget-and-relearn',pokemonId,slot:action.slot,moveId};
}
