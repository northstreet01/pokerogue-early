import type BattleScene from '../battle-scene';
import Battle from '../battle';
import Trainer from '../field/trainer';
import { trainerConfigs } from '../data/trainer-config';
import { getPokemonSpecies } from '../data/pokemon-species';
import { Biome } from '../data/enums/biome';

/** Select through the original Battle/Trainer rules, play through original audio.
 * No battle construction, RNG, model mutation or independent music inventory. */
export class CoopBattleAudio {
  private controller = new AbortController();
  private key: string | null = null;
  private requestedAt=0;
  constructor(private scene: BattleScene) {}
  apply(snapshot: any) {
    if (typeof this.scene.playBgm !== 'function') return;
    const shared = snapshot.shared;
    const trainer = shared.trainer ? Object.assign(Object.create(Trainer.prototype), {
      config: trainerConfigs[shared.trainer.type], variant: shared.trainer.variant,
    }) : null;
    const battle = Object.assign(Object.create(Battle.prototype), shared, {
      started: true, gameMode: this.scene.gameMode, trainer,
      enemyParty: shared.field.slice(2).map((id: number | null) => shared.pokemon.find((p: any) => p.id === id))
        .filter(Boolean).map((view: any) => ({ ...view, species: getPokemonSpecies(view.speciesId) })),
    });
    const key = snapshot.personal?.decision.kind === 'preparation' && trainer
      ? trainer.config.victoryBgm : battle.getBgmOverride(this.scene) || Biome[shared.biome].toLowerCase();
    this.play(key);
  }
  play(key: string) {
    if (!key || typeof this.scene.playBgm !== 'function') return;
    if(key===this.key){
      const track=this.scene.getBgmState?.();
      if(typeof this.scene.isBgmPlaying!=='function'||track?.key===key&&this.scene.isBgmPlaying())return;
      if(!track&&Date.now()-this.requestedAt<5000)return; // One load may still be pending.
      if(track?.key===key&&track.isPaused&&!track.pendingRemove){this.scene.resumeBgm?.();return;}
    }
    this.controller.abort(); this.controller = new AbortController(); this.key = key;
    this.requestedAt=Date.now();
    // Arena's original loop point selection uses this bgm and biome.
    this.scene.playBgm(key, true, this.controller.signal);
  }
  stop() { this.controller.abort(); this.key = null; this.scene.fadeOutBgm?.(150, true); }
  invalidate() { this.controller.abort(); this.key = null; }
}
