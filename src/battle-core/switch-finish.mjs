// SwitchSummonPhase.onEnd after SummonPhase.onEnd. Keep this exact order:
// compensate turn -> transfer summon -> reset outgoing -> trigger form change.
export function finishSwitchSummon(pokemon, lastPokemon, batonPass, isSwitchCommand, triggerFormChange) {
  if (isSwitchCommand) pokemon.battleSummonData.turnCount--;
  if (batonPass && pokemon) pokemon.transferSummon(lastPokemon);
  lastPokemon?.resetSummonData();
  triggerFormChange(pokemon);
}
