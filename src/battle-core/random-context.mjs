import { RandomDataGenerator, shiftSeed, withSeedOffset } from './random.mjs';

// Browser rules retain Phaser's stream. The Node host installs an async-local
// resolver; neither path replaces Phaser.Math.RND or Math.random.
let host;
export function installRandomHost(value) {
  if (host && host !== value) throw new Error('RANDOM_HOST_ALREADY_INSTALLED');
  if (!value || typeof value.current !== 'function' || typeof value.run !== 'function') throw new Error('INVALID_RANDOM_HOST');
  host = value;
}
export function ruleRandom(fallback) {
  if (!host) return fallback();
  const random = host.current();
  if (!random) throw new Error('RANDOM_CONTEXT_REQUIRED');
  return random;
}
export function unseededRandom() {
  if (host) throw new Error('UNSEEDED_RULE_RANDOM');
  return Math.random();
}
export function ruleModifierPools(fallback) {
  if (!host) return fallback();
  ruleRandom(fallback); // Also rejects expired detached work.
  const pools = host.modifierPools?.();
  if (!pools) throw new Error('MODIFIER_POOL_CONTEXT_REQUIRED');
  return pools;
}
export function ruleSeedOffset(fallback, seed, offset, callback) {
  if (!callback) return;
  if (!host) return withSeedOffset(fallback(), seed, offset, callback);
  ruleRandom(fallback); // Require an enclosing room, even for deterministic scopes.
  return host.run(new RandomDataGenerator([shiftSeed(seed, offset)]), callback);
}
