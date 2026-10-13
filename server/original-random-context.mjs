import { AsyncLocalStorage } from 'node:async_hooks';
import { installRandomHost } from '../src/battle-core/random-context.mjs';

const streams = new AsyncLocalStorage();
function run(random, callback, modifierPools = streams.getStore()?.modifierPools) {
  const scope = { random, modifierPools, open:true, parent:streams.getStore() };
  return streams.run(scope, () => {
    try {
      const result = callback();
      if (result && typeof result.then === 'function') return Promise.resolve(result).finally(() => { scope.open = false; });
      scope.open = false;
      return result;
    } catch (error) { scope.open = false; throw error; }
  });
}
const host = Object.freeze({ current() {
  const scope = streams.getStore();
  for (let ancestor = scope; ancestor; ancestor = ancestor.parent) {
    if (!ancestor.open) throw new Error('RANDOM_CONTEXT_EXPIRED');
  }
  return scope?.random;
}, modifierPools:()=>streams.getStore()?.modifierPools, run });

/** Enter before executing original rules, including catalog factories. Await all
 * child work before capturing the room. Detached work is not a safe boundary. */
export function withOriginalRandom(sceneRandom, callback, modifierPools) {
  installRandomHost(host);
  if (!sceneRandom?.generator || typeof callback !== 'function') throw new Error('INVALID_RANDOM_CONTEXT');
  // Entering another room must never inherit the enclosing room's pool tables.
  // Only ruleSeedOffset (host.run) inherits them for a nested seed scope.
  return run(sceneRandom.generator, callback, modifierPools ?? null);
}

export function withOriginalRules(context, callback) {
  if (!context?.modifierPools) throw new Error('MODIFIER_POOL_CONTEXT_REQUIRED');
  return withOriginalRandom(context.sceneRandom, callback, context.modifierPools);
}
