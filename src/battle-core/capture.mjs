/** Exact early threshold: keep rounding, ball/status multipliers and master-ball sentinel. */
export function getCaptureThreshold(maxHp, hp, catchRate, ballMultiplier, statusMultiplier) {
  const _3m = 3 * maxHp;
  const _2h = 2 * hp;
  const x = Math.round((((_3m - _2h) * catchRate * ballMultiplier) / _3m) * statusMultiplier);
  return Math.round(65536 / Math.sqrt(Math.sqrt(255 / x)));
}

/**
 * One original onRepeat decision. Early performs THREE random shake checks, then locks.
 * Call lazily at the existing animation boundary in solo; a server runner can call it
 * without animation. Unobtainable species and master balls consume no random draws.
 */
export function advanceCaptureCheck(shakeCount, obtainable, ballMultiplier, threshold, randomInt) {
  if (!obtainable) return { outcome: 'failed', shakeCount };
  if (shakeCount++ < 3) {
    return { outcome: ballMultiplier === -1 || randomInt(65536) < threshold ? 'shake' : 'failed', shakeCount };
  }
  return { outcome: 'caught', shakeCount };
}
