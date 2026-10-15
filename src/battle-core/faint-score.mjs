// Extracted from original BattleScene.addFaintedEnemyScore. Keep original item,
// IV, level-cap and boss multipliers, then round only the total increment.
export function addFaintedEnemyScore(scene,enemy,{PokemonHeldItemModifier}) {
  let scoreIncrease = enemy.getSpeciesForm().getBaseExp() * (enemy.level / scene.getMaxExpLevel()) * ((enemy.ivs.reduce((iv, total) => total += iv, 0) / 93) * 0.2 + 0.8);
  scene.findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === enemy.id, false).map(m => scoreIncrease *= m.getScoreMultiplier());
  if (enemy.isBoss())
    scoreIncrease *= Math.sqrt(enemy.bossSegments);
  scene.currentBattle.battleScore += Math.ceil(scoreIncrease);
}
