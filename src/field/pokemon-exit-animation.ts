import type Pokemon from './pokemon';
import { getPokeballTintColor, PokeballType } from '../data/pokeball';
import { presentOnHost } from '../battle-core/presentation-port.mjs';

/** Original FaintPhase/SwitchSummonPhase visuals, shared with committed replay.
 * Rules (status, friendship, party, field removal and Phase.end) stay with caller. */
export function animatePokemonExit(pokemon: Pokemon, kind: 'faint' | 'return', complete: () => void, signal?: AbortSignal) {
  if (signal?.aborted) return;
  const scene = pokemon.scene, y = pokemon.y;
  presentOnHost(scene, 'pokemon-exit', { pokemonId: pokemon.id, animation: kind });
  pokemon.hideInfo();
  scene.playSound(kind === 'faint' ? 'faint' : 'pb_rel');
  if (kind === 'return') pokemon.tint(getPokeballTintColor(pokemon.pokeball ?? PokeballType.POKEBALL), 1, 250, 'Sine.easeIn');
  let stopped = false;
  let finished = false;
  const cancel = () => {
    stopped = true; tween?.stop(); scene.tweens.killTweensOf((pokemon as any).battleInfo);
    pokemon.y = y;
    if (kind === 'return') pokemon.setScale?.(pokemon.getSpriteScale());
  };
  const tween = scene.tweens.add({ targets: pokemon, duration: kind === 'faint' ? 500 : 250,
    ease: 'Sine.easeIn', ...(kind === 'faint' ? { y: y + 150 } : { scale: 0.5 }),
    onComplete: () => {
      finished = true;
      signal?.removeEventListener('abort', cancel);
      if (stopped || signal?.aborted) return;
      pokemon.setVisible(false);
      if (kind === 'faint') pokemon.y = y;
      complete();
    } });
  if (!finished) signal?.addEventListener('abort', cancel, { once: true });
}
