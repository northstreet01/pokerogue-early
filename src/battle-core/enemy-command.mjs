// Original EnemyCommandPhase decision only. The caller supplies the original
// Pokemon/Trainer methods and trapping rules; no UI, Phase queue or global RNG.
export function selectEnemyCommand(enemyPokemon, trainer, rules) {
  if (trainer && !enemyPokemon.getMoveQueue().length) {
    const opponents = enemyPokemon.getOpponents();
    const trapTag = rules.findTrapTag(enemyPokemon);
    const trapped = rules.isAbilityTrapped(opponents);
    if (enemyPokemon.moveset.find(m => m.moveId === rules.batonPassMove && m.isUsable(enemyPokemon))
      && (enemyPokemon.summonData.battleStats.reduce((total, stat) => total += stat, 0) >= 0 || trapTag || trapped)) {
      return { command: rules.fightCommand, move: { move: rules.batonPassMove, targets: enemyPokemon.getNextTargets(rules.batonPassMove) } };
    } else if (!trapTag && !trapped) {
      const partyMemberScores = trainer.getPartyMemberMatchupScores(enemyPokemon.trainerSlot, true);
      if (partyMemberScores.length) {
        const matchupScores = opponents.map(opp => enemyPokemon.getMatchupScore(opp));
        const matchupScore = matchupScores.reduce((total, score) => total += score, 0) / matchupScores.length;
        const sortedPartyMemberScores = trainer.getSortedPartyMemberMatchupScores(partyMemberScores);
        if (sortedPartyMemberScores[0][1] >= matchupScore * (trainer.config.isBoss ? 2 : 3)) {
          return { command: rules.switchCommand, cursor: trainer.getNextSummonIndex(enemyPokemon.trainerSlot, partyMemberScores), args: [false] };
        }
      }
    }
  }
  return { command: rules.fightCommand, move: enemyPokemon.getNextMove() };
}
