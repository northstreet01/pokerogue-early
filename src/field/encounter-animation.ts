import type BattleScene from '../battle-scene';

/** Original NextEncounter/NewBiomeEncounter/SwitchBiome display tweens. */
function play(scene: BattleScene, config: any, complete: () => void, signal?: AbortSignal) {
  if (signal?.aborted) return;
  let finished = false;
  const cancel = () => tween?.stop();
  const tween = scene.tweens.add({ ...config, onComplete: () => {
    finished = true; signal?.removeEventListener('abort', cancel);
    if (!signal?.aborted) complete();
  } });
  if (!finished) signal?.addEventListener('abort', cancel, { once: true });
}
export function animateEncounterScroll(scene: BattleScene, targets: any[], complete: () => void, signal?: AbortSignal) {
  play(scene, { targets: targets.flat().filter(Boolean), x: '+=300', duration: 2000 }, complete, signal);
}
export function animateBiomeBackground(scene: BattleScene, complete: () => void, signal?: AbortSignal) {
  play(scene, { targets: [scene.arenaPlayer, scene.arenaBgTransition, scene.arenaPlayerTransition],
    duration: 1000, delay: 1000, ease: 'Sine.easeInOut', alpha: (target: any) => target === scene.arenaPlayer ? 0 : 1 }, complete, signal);
}
