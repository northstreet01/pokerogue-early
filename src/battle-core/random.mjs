// Import only Phaser's pure generator, never the browser renderer or the global RND.
import RandomDataGenerator from 'phaser/src/math/random-data-generator/RandomDataGenerator.js';

export { RandomDataGenerator };

export function shiftSeed(seed, offset) {
  if (!offset) offset = 0;
  let shifted = '';
  for (let i = 0; i < seed.length; i++) shifted += String.fromCharCode(seed.charCodeAt(i) + offset);
  return shifted;
}

/** Same integer draw and serialized state as early Battle.randSeedInt. */
export function nextBattleRandomInt(seed, turn, savedState, range, min = 0) {
  const random = new RandomDataGenerator(savedState || [shiftSeed(seed, turn << 6)]);
  const value = range <= 1 ? min : random.integerInRange(min, range - 1 + min);
  return { value, state: random.state() };
}

/** Legacy synchronous seed scope. Always restore the enclosing stream, even on failure. */
export function withSeedOffset(random, seed, offset, callback) {
  if (!callback) return;
  const state = random.state();
  try {
    random.sow([shiftSeed(seed, offset)]);
    callback();
  } finally {
    random.state(state);
  }
}
