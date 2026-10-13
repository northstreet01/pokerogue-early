// Exact early level formulas; callers supply the game mode and its random stream.
export function gaussianLevelOffset(value, random) {
  let rand = 0;
  for (let i = value; i > 0; i--) rand += random.realInRange(0, 1);
  return rand / value;
}

export function getWildLevel(waveIndex, levelWaveIndex, finalBoss, isWaveFinal, random) {
  const baseLevel = 1 + levelWaveIndex / 2 + Math.pow(levelWaveIndex / 25, 2);
  const bossMultiplier = 1.2;
  if (!(waveIndex % 10)) {
    const ret = Math.floor(baseLevel * bossMultiplier);
    if (finalBoss || !(waveIndex % 250)) return Math.ceil(ret / 25) * 25;
    let levelOffset = 0;
    // Preserve lazy evaluation: final-boss/milestone waves do not ask the mode again.
    if (!isWaveFinal()) levelOffset = Math.round(random.realInRange(-1, 1) * Math.floor(levelWaveIndex / 10));
    return ret + levelOffset;
  }
  const deviation = 10 / levelWaveIndex;
  const levelOffset = Math.abs(gaussianLevelOffset(deviation, random));
  return Math.max(Math.round(baseLevel + levelOffset), 1);
}

export function getMaxExpLevel(difficultyWaveIndex, ignoreLevelCap = false) {
  if (ignoreLevelCap) return Number.MAX_SAFE_INTEGER;
  const baseLevel = (1 + difficultyWaveIndex / 2 + Math.pow(difficultyWaveIndex / 25, 2)) * 1.2;
  return Math.ceil(baseLevel / 2) * 2 + 2;
}
