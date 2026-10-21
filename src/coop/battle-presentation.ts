import Phaser from 'phaser';
import type BattleScene from '../battle-scene';
import Pokemon, { PlayerPokemon, EnemyPokemon, FieldPosition, capturePokemonState, restorePokemonState } from '../field/pokemon';
import { getPokemonSpecies } from '../data/pokemon-species';
import { Type } from '../data/type';
import { getBiomeKey } from '../field/arena';
import { CommonBattleAnim, MoveAnim, initMoveAnim, loadMoveAnimAssets } from '../data/battle-anims';
import { trainerConfigs } from '../data/trainer-config';
import { Mode } from '../ui/ui';

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const within = async (task: Promise<unknown>, ms: number) => {
  let timer: ReturnType<typeof setTimeout>;
  try { await Promise.race([task, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]); }
  finally { clearTimeout(timer!); }
};

/** Original display Container around a codec copy, without a Pokemon constructor. */
export function createCoopPokemonDisplay(scene: BattleScene, model: Pokemon, player = true): Pokemon {
  const display = new Phaser.GameObjects.Container(scene, player ? 106 : 236, player ? 148 : 84);
  Object.setPrototypeOf(display, Object.getPrototypeOf(model));
  Object.assign(display, model, { scene });
  Object.assign(display, { randSeedInt: () => { throw new Error('CLIENT_RULE_RNG_FORBIDDEN'); } });
  (display as Pokemon).generateName();
  return display as Pokemon;
}

/** Display copies only. Never run a Pokemon constructor (which consumes RNG),
 * and never attach Phaser state to the consumer's verified rule instances. */
export class CoopBattlePresentation {
  private displayed: Pokemon[] = [];
  private displayedById = new Map<number, Pokemon>();
  private playedEvents = new Set<string>();
  private trainerSprite: any = null;
  private static readonly EVENT_STORAGE = 'coop-presentation-events-v1';
  constructor(private scene: BattleScene) {
    try {
      const saved = globalThis.sessionStorage?.getItem(CoopBattlePresentation.EVENT_STORAGE);
      for (const id of saved ? JSON.parse(saved) : []) if (typeof id === 'string') this.playedEvents.add(id);
    } catch { /* storage is an optimization; correctness never depends on it */ }
  }

  clear() {
    for (const pokemon of this.displayed) {
      const info = (pokemon as any).battleInfo;
      if (info) this.scene.tweens.killTweensOf(info);
      this.scene.tweens.killTweensOf(pokemon);
      pokemon.destroy();
    }
    this.displayed = [];
    this.displayedById.clear();
    if (this.trainerSprite && this.trainerSprite !== this.scene.trainer) this.trainerSprite.destroy?.();
    this.trainerSprite = null;
    this.scene.trainer?.setVisible(false);
  }

  /** Replay display-only events after the verified snapshot has been applied.
   * No rule state, RNG, PP, EXP or damage is recalculated here. */
  async playEvents(events: any[], context: { revision?: number; decisionId?: string;
    isCurrent?: () => boolean } = {}) {
    if (!Array.isArray(events) || !events.length) return;
    const ordered = [...events].sort((a, b) => (a.eventIndex ?? 0) - (b.eventIndex ?? 0));
    const started = Date.now();
    for (const event of ordered) {
      if (!event || typeof event !== 'object' || context.isCurrent?.() === false || Date.now() - started > 6000) return;
      const key = event.eventId ?? `${context.revision ?? 'r'}:${event.eventIndex ?? '?'}:${event.kind}`;
      if (this.playedEvents.has(key)) continue;
      this.playedEvents.add(key);
      try {
        const saved = [...this.playedEvents].slice(-500);
        globalThis.sessionStorage?.setItem(CoopBattlePresentation.EVENT_STORAGE, JSON.stringify(saved));
      } catch { /* see constructor */ }
      try {
        if (event.kind === 'battle-animation') await this.playAnimation(event);
        else if (event.kind === 'phase-start') await this.playPhase(event);
        else if (event.kind === 'damage-display') this.playDamage(event);
        else if (event.kind === 'dialogue') await this.playDialogue(event);
        else if (event.kind === 'message') await this.playMessage(event);
        else if (event.kind === 'experience-bar') await this.playExperience(event);
      } catch { /* presentation must never turn a verified snapshot into a failed ACK */ }
      if (context.isCurrent?.() === false) return;
      await wait(40);
    }
  }

  private async playPhase(event: any) {
    if (event.phase === 'NewBattlePhase' || event.phase === 'NextEncounterPhase'
      || event.phase === 'TrainerVictoryPhase') {
      await this.fade(90);
    } else if (event.phase === 'ShowTrainerPhase') {
      const trainer = this.trainerSprite ?? this.scene.trainer;
      if (!trainer) return;
      trainer.setVisible(true).setX(-72);
      await this.tween({ targets: trainer, x: 106, duration: 600 });
    }
  }

  private async playAnimation(event: any) {
    const user = this.displayedById.get(event.sourceId);
    const target = this.displayedById.get(event.targetId);
    if (!user) return;
    const field = this.scene.getField();
    const targetIndex = target ? field.indexOf(target) : -1;
    if (targetIndex < 0) { await wait(120); return; }
    if (Number.isInteger(event.moveId)) {
      await within(initMoveAnim(event.moveId), 1200);
      await within(loadMoveAnimAssets(this.scene, [event.moveId], true), 1500);
      const animation = new MoveAnim(event.moveId, user, targetIndex);
      await within(new Promise<void>(resolve => animation.play(this.scene, resolve)), 900);
    } else if (event.commonAnim !== undefined) {
      const animation = new CommonBattleAnim(event.commonAnim, user, target);
      await within(new Promise<void>(resolve => animation.play(this.scene, resolve)), 700);
    }
  }

  private playDamage(event: any) {
    const target = this.displayedById.get(event.pokemonId);
    if (!target) return;
    (this.scene as any).damageNumberHandler?.add(target, event.amount, event.result, event.critical);
    if (typeof event.remainingHp === 'number') {
      target.hp = event.remainingHp;
      (target as any).updateInfo?.(true);
    }
  }

  private async playDialogue(event: any) {
    if (!event.text || typeof (this.scene.ui as any).showDialogue !== 'function') return;
    await within(new Promise<void>(resolve =>
      (this.scene.ui as any).showDialogue(event.text, event.speaker ?? '', null, resolve)), 1200);
  }

  private async playMessage(event: any) {
    if (!event.text || typeof (this.scene.ui as any).showText !== 'function') return;
    await this.scene.ui.setMode?.(Mode.MESSAGE);
    // Messages are display-only here. Do not wait for a click during the
    // authoritative ACK barrier; dialogue uses the explicit dialogue port.
    try { (this.scene.ui as any).showText(event.text, 120, undefined); } catch { return; }
    await wait(120);
  }

  private async playExperience(event: any) {
    const target = this.displayedById.get(event.pokemonId);
    if (!target) return;
    await within(Promise.resolve(this.scene.partyExpBar?.showPokemonExp?.(target, event.exp)), 500);
  }

  private async fade(ms: number) {
    const ui: any = this.scene.ui;
    if (typeof ui.fadeOut === 'function') await within(Promise.resolve(ui.fadeOut(ms)), ms + 250);
    if (typeof ui.fadeIn === 'function') await within(Promise.resolve(ui.fadeIn(ms)), ms + 250);
  }

  private tween(config: any) {
    return within(new Promise<void>(resolve => this.scene.tweens.add({ ...config, onComplete: resolve })), 900);
  }

  private container(model: Pokemon, player: boolean): Pokemon {
    // Phaser's Container initializes events/transforms/list ownership. Copying
    // an uninitialized checkpoint directly into the display list cannot do so.
    return createCoopPokemonDisplay(this.scene, model, player);
  }

  private publicModel(view: any): Pokemon {
    const model = Object.create(view.owner === null ? EnemyPokemon.prototype : PlayerPokemon.prototype);
    Object.assign(model, { species: getPokemonSpecies(view.speciesId), formIndex: view.formIndex,
      id: view.id, level: view.level, hp: view.hp, gender: view.gender, shiny: view.shiny,
      moveset: [], exp: 0, levelExp: 0,
      // These methods expose public display facts, not invented combat stats,
      // ability, moves, IVs or random state for a teammate/enemy.
      getMaxHp: () => view.maxHp, getTeraType: () => Type.UNKNOWN,
      getDexAttr: () => 0n,
      randSeedInt: () => { throw new Error('CLIENT_RULE_RNG_FORBIDDEN'); },
    });
    model.name = model.species.getName(model.formIndex);
    return model;
  }

  async apply(snapshot: any, applied: any) {
    this.clear();
    const shared = snapshot.shared;
    const make = (id: number | null): Pokemon | null => {
      if (id === null) return null;
      const view = shared.pokemon.find((p: any) => p.id === id);
      if (!view) throw new Error('PUBLIC_FIELD_MODEL_MISSING');
      const owned = applied.byId.get(id);
      const model = owned ? restorePokemonState(capturePokemonState(owned.pokemon)) : this.publicModel(view);
      const display = this.container(model, view.owner !== null);
      this.displayed.push(display);
      this.displayedById.set(view.id, display);
      return display;
    };
    const field = shared.field.map(make);
    // Preserve both global seats, including an empty/fainted seat. Never shift
    // seat 1 or a private bench member into seat 0's field position.
    (this.scene as any).party = field.slice(0, 2);
    this.scene.currentBattle = { ...shared, enemyParty: field.slice(2, 4),
      randSeedInt: () => { throw new Error('CLIENT_RULE_RNG_FORBIDDEN'); } } as any;
    const biomeKey = getBiomeKey(shared.biome);
    // Original shaders read these scene/arena values. A browser's fresh scene
    // offset would otherwise give each seat (and each refresh) different light.
    this.scene.waveCycleOffset = shared.waveCycleOffset;
    this.scene.arena.biomeType = shared.biome;
    this.scene.arenaBg.setTexture(`${biomeKey}_bg`).setPosition(0, 0);
    this.scene.arenaBg.pipelineData = { terrainColorRatio: shared.terrainColorRatio };
    this.scene.arenaBgTransition.setVisible(false);
    // Reuse the original base containers/textures without calling setBiome's
    // decorative RNG or starting an EncounterPhase on the browser.
    for (const base of [this.scene.arenaPlayer, this.scene.arenaEnemy]) {
      base.base.setTexture(`${biomeKey}_${base.player ? 'a' : 'b'}`);
      base.add(base.base);
      base.setPosition(0, 0).setVisible(true);
      base.props.forEach(prop => prop.setVisible(false));
    }
    this.scene.trainer.setVisible(false);
    this.trainerSprite = null;
    const trainer = shared.trainer;
    if (trainer?.spriteKey && this.scene.trainer) {
      try {
        if (!this.scene.textures.exists(trainer.spriteKey)) {
          await within(trainerConfigs[trainer.type].loadAssets(this.scene, trainer.variant), 2000);
        }
        this.scene.trainer.setTexture(trainer.spriteKey).setPosition(-72, 80).setVisible(true);
        this.trainerSprite = this.scene.trainer;
      } catch { this.scene.trainer.setVisible(false); }
    }
    try {
      for (const pokemon of this.displayed) {
        pokemon.init();
        this.scene.field.add(pokemon);
        await pokemon.loadAssets();
        // The original immediate branch changes position but does not resolve
        // its Promise; do not await that legacy presentation-only return value.
        void pokemon.setFieldPosition(pokemon.getFieldIndex() ? FieldPosition.RIGHT : FieldPosition.LEFT);
        await pokemon.updateInfo(true);
        // Snapshot application shows the final frame, without replaying rule
        // phases or their animation callbacks.
        (pokemon as any).battleInfo.setVisible(true);
        pokemon.setVisible(pokemon.hp > 0);
      }
    } catch (error) { this.clear(); throw error; }
    return field;
  }
}
