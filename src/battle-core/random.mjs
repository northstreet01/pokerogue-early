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

/** Validate without constructing/seeding a generator or consuming a draw. */
export function readBattleRandomCheckpoint(checkpoint) {
  const invalid = () => { throw new TypeError('Invalid original battle random checkpoint'); };
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(checkpoint);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value'))
    || Object.keys(descriptors).sort().join(',') !== 'seed,state,turn,version') invalid();
  const { version, seed, turn, state } = checkpoint;
  if (version !== 1 || typeof seed !== 'string' || !Number.isSafeInteger(turn) || turn < 0) invalid();
  if (state !== null) {
    if (typeof state !== 'string' || state.length > 200) invalid();
    const parts = state.split(',');
    if (parts.length !== 5 || parts[0] !== '!rnd') invalid();
    const [carry, ...fractions] = parts.slice(1).map(Number);
    if (!Number.isSafeInteger(carry) || carry < 0 || carry > 2091639
      || fractions.some(value => !Number.isFinite(value) || value < 0 || value >= 1)
      || ['!rnd', carry, ...fractions].join(',') !== state) invalid();
  }
  return { version, seed, turn, state };
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
