import type Pokemon from './pokemon';
import { getPokeballAtlasKey, getPokeballTintColor, PokeballType } from '../data/pokeball';
import { addPokeballOpenParticles } from './anims';
import { presentOnHost } from '../battle-core/presentation-port.mjs';

/** SummonPhase's original ball flight/release. Rule callbacks remain in Phase. */
export function animatePokemonSummon(pokemon: Pokemon, player: boolean,
  hooks: { seen?: () => void; released?: () => void; complete: () => void }, signal?: AbortSignal) {
  if (signal?.aborted) return;
  const scene = pokemon.scene;
  const view = (scene as any).nativePublicPokemon?.(pokemon);
  presentOnHost(scene, 'pokemon-enter', { pokemonId: pokemon.id, ...(view ? { view } : {}) });
  const ballType = pokemon.pokeball ?? PokeballType.POKEBALL;
  const ball = scene.addFieldSprite(player ? 36 : 248, player ? 80 : 44, 'pb', getPokeballAtlasKey(ballType));
  ball.setVisible(false); ball.setOrigin(0.5, 0.625); scene.field.add(ball);
  const offset = pokemon.getFieldPositionOffset();
  const tweens: Phaser.Tweens.Tween[] = [];
  const cancel = () => { tweens.forEach(t => t.stop()); ball.destroy(); pokemon.setScale(pokemon.getSpriteScale()); };
  signal?.addEventListener('abort', cancel, { once: true });
  const add = (config: any) => tweens.push(scene.tweens.add({ ...config, onComplete: () => {
    if (!signal?.aborted) config.onComplete?.();
  } }));
  ball.setVisible(true);
  add({ targets: ball, duration: 650, x: (player ? 100 : 236) + offset[0] });
  add({ targets: ball, duration: 150, ease: 'Cubic.easeOut', y: (player ? 70 : 34) + offset[1], onComplete: () => {
    add({ targets: ball, duration: 500, ease: 'Cubic.easeIn', angle: 1440,
      y: (player ? 132 : 86) + offset[1], onComplete: () => {
        scene.playSound('pb_rel'); ball.destroy(); scene.add.existing(pokemon); scene.field.add(pokemon);
        if (!player) {
          const front = scene.getPlayerPokemon();
          if (front?.visible) scene.field.moveBelow(pokemon, front);
        }
        hooks.seen?.();
        addPokeballOpenParticles(scene, pokemon.x, pokemon.y - 16, ballType, signal);
        hooks.released?.(); scene.updateFieldScale();
        pokemon.showInfo(); pokemon.playAnim(); pokemon.setVisible(true); pokemon.getSprite().setVisible(true);
        pokemon.setScale(0.5); pokemon.tint(getPokeballTintColor(ballType)); pokemon.untint(250, 'Sine.easeIn');
        scene.updateFieldScale();
        add({ targets: pokemon, duration: 250, ease: 'Sine.easeIn', scale: pokemon.getSpriteScale(), onComplete: () => {
          signal?.removeEventListener('abort', cancel);
          pokemon.cry(pokemon.getHpRatio() > 0.25 ? undefined : { rate: 0.85 }); pokemon.getSprite().clearTint();
          hooks.complete();
        } });
      } });
  } });
}
