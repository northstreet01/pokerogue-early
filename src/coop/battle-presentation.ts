import Phaser from 'phaser';
import i18next from '../i18n';
import type BattleScene from '../battle-scene';
import Pokemon, { PlayerPokemon, EnemyPokemon, FieldPosition, capturePokemonState, restorePokemonState } from '../field/pokemon';
import { getPokemonSpecies } from '../data/pokemon-species';
import { Type } from '../data/type';
import { getBiomeKey } from '../field/arena';
import { CommonBattleAnim, MoveAnim, initMoveAnim, loadMoveAnimAssets } from '../data/battle-anims';
import { trainerConfigs } from '../data/trainer-config';
import { getPokeballDisplayName as getPokeballName } from '../data/pokeball';
import { animatePokemonExit } from '../field/pokemon-exit-animation';
import { animatePokemonSummon } from '../field/pokemon-summon-animation';
import { CoopBattleAudio } from './battle-audio';
import { Biome } from '../data/enums/biome';
import { animateEncounterScroll, animateBiomeBackground } from '../field/encounter-animation';
import { presentOriginalEvolution } from './evolution-presentation';
import {renderPresentationText} from '../system/presentation-text.mjs';

export function captureResultText(event: any): string {
  const ball = getPokeballName(event.pokeballType);
  if (event.outcome === 'caught') return i18next.t('coop:captureCaught',{ball});
  if (event.outcome === 'failed') return i18next.t('coop:captureFailed',{ball});
  if (event.outcome === 'cancelled') return i18next.t('coop:captureCancelled');
  return i18next.t('coop:captureUnknown');
}

const within = async (task: Promise<unknown>, ms: number, signal: AbortSignal) => {
  if (signal.aborted) throw new Error('PRESENTATION_CANCELLED');
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  try {
    await Promise.race([task, new Promise<void>((_, reject) => {
      abort = () => reject(new Error('PRESENTATION_CANCELLED'));
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(new Error('PRESENTATION_TIMEOUT')), ms);
    })]);
    if (signal.aborted) throw new Error('PRESENTATION_CANCELLED');
  } finally { clearTimeout(timer!); signal.removeEventListener('abort', abort!); }
};
const wait = (ms: number, signal: AbortSignal) => within(new Promise(() => {}), ms, signal)
  .catch(error => { if (error.message !== 'PRESENTATION_TIMEOUT') throw error; });

/** A timed-out original effect must stop before final-state reconciliation. */
async function visual(start: (signal: AbortSignal, done: () => void) => void, ms: number, parent: AbortSignal) {
  const controller = new AbortController();
  let release: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { controller.abort(); clearTimeout(release); };
  if (parent.aborted) controller.abort();
  else parent.addEventListener('abort', cancel, { once: true });
  try { await within(new Promise<void>(done => start(controller.signal, done)), ms, parent); }
  catch (error) { controller.abort(); throw error; }
  finally {
    // The original summon particles finish shortly after the release tween.
    // Keep their cancellation linked until their own bounded lifetime ends.
    if (controller.signal.aborted) parent.removeEventListener('abort', cancel);
    else release = setTimeout(() => parent.removeEventListener('abort', cancel), 1500);
  }
}

/** Original display Container around a codec copy, without a Pokemon constructor. */
export function createCoopPokemonDisplay(scene: BattleScene, model: Pokemon, player = true, slot?: number): Pokemon {
  const display = new Phaser.GameObjects.Container(scene, player ? 106 : 236, player ? 148 : 84);
  Object.setPrototypeOf(display, Object.getPrototypeOf(model));
  Object.assign(display, model, { scene });
  Object.assign(display, { randSeedInt: () => { throw new Error('CLIENT_RULE_RNG_FORBIDDEN'); } });
  if (slot !== undefined) Object.assign(display, { getFieldIndex: () => slot % 2, getBattlerIndex: () => slot });
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
  private lifetime = new AbortController();
  private lastSnapshot: any = null;
  private field: (Pokemon | null)[] = [null, null, null, null];
  private pending: any = null;
  private modelKeys = new Map<number, string>();
  private looks = new Map<number, string>();
  private audio: CoopBattleAudio;
  private static readonly EVENT_STORAGE = 'coop-presentation-events-v1';
  constructor(private scene: BattleScene) {
    this.audio = new CoopBattleAudio(scene);
    try {
      const saved = globalThis.sessionStorage?.getItem(CoopBattlePresentation.EVENT_STORAGE);
      for (const id of saved ? JSON.parse(saved) : []) if (typeof id === 'string') this.playedEvents.add(id);
    } catch { /* replay storage never changes or commits rule state */ }
  }

  cancel() {
    this.lifetime.abort();
    for (const pokemon of this.displayed) {
      const info = (pokemon as any).battleInfo;
      if (info) for (const target of [info, info.hpBar, info.expBar].filter(Boolean)) this.scene.tweens.killTweensOf(target);
      const children = (pokemon as any).list ?? [];
      for (const child of children) this.scene.tweens.killTweensOf(child);
      if (!(pokemon as any).maskEnabled) children[1]?.setVisible(false).setAlpha(1);
    }
  }

  clear() {
    this.cancel();
    this.audio.stop();
    this.lifetime = new AbortController();
    for (const pokemon of this.displayed) {
      const info = (pokemon as any).battleInfo;
      if (info) this.scene.tweens.killTweensOf(info);
      this.scene.tweens.killTweensOf(pokemon);
      pokemon.destroy();
    }
    this.displayed = [];
    this.pending = null; this.lastSnapshot = null;
    this.field = [null, null, null, null]; this.modelKeys.clear(); this.looks.clear();
    this.displayedById.clear();
    if (this.trainerSprite && this.trainerSprite !== this.scene.trainer) this.trainerSprite.destroy?.();
    this.trainerSprite = null;
    this.scene.trainer?.setVisible(false);
  }

  /** Replay display-only events after the verified snapshot has been applied.
   * No rule state, RNG, PP, EXP or damage is recalculated here. */
  async playEvents(events: any[], context: { revision?: number; decisionId?: string;
    isCurrent?: () => boolean } = {}) {
    if (!Array.isArray(events)) return;
    const batch = this.pending;
    const ordered = [...events].sort((a, b) => (a.eventIndex ?? 0) - (b.eventIndex ?? 0));
    const started = Date.now();
    const budget = Math.min(120000, Math.max(20000, ordered.length * 5500));
    const signal = this.lifetime.signal;
    const hp = this.displayed.map(pokemon => [pokemon, pokemon.hp] as const);
    try {
      for (const event of ordered) {
        if (signal.aborted || context.isCurrent?.() === false) return;
        if (Date.now() - started > budget) throw new Error('PRESENTATION_TIMEOUT');
        if (!event || typeof event !== 'object') continue;
        const key = event.eventId ?? `${context.revision ?? 'r'}:${event.eventIndex ?? '?'}:${event.kind}`;
        if (this.playedEvents.has(key)) continue;
        try {
          if (event.kind === 'bgm') this.audio.play(event.key);
          else if (batch && !batch.replay && ['battle-animation', 'damage-display', 'pokemon-hp', 'pokemon-progress', 'level-stats', 'experience-bar', 'evolution-display', 'pokemon-exit', 'pokemon-enter', 'faint-cry', 'showInfo'].includes(event.kind)) continue;
          else if (event.kind === 'battle-animation') await this.playAnimation(event, signal);
          else if (event.kind === 'phase-start') await this.playPhase(event, signal);
          else if (event.kind === 'damage-display' || event.kind === 'pokemon-hp') await this.playDamage(event, signal);
          else if (event.kind === 'faint-cry') {
            const pokemon = this.displayedById.get(event.pokemonId);
            if (pokemon) await visual((local, done) => pokemon.faintCry(done, local), 3500, signal);
          } else if (event.kind === 'pokemon-exit') {
            const pokemon = this.displayedById.get(event.pokemonId);
            if (pokemon) await visual((local, done) => animatePokemonExit(pokemon, event.animation, done, local), 1500, signal);
          } else if (event.kind === 'pokemon-enter' || event.kind === 'showInfo') await this.showPokemon(event, signal);
          else if (event.kind === 'dialogue') await this.playDialogue(event, signal);
          else if (event.kind === 'message') await this.playMessage(event, signal);
          else if (event.kind === 'experience-bar') await this.playExperience(event, signal);
          else if (event.kind === 'pokemon-progress') await this.playProgress(event, signal);
          else if (event.kind === 'level-stats') await this.playLevelStats(event, signal);
          else if (event.kind === 'evolution-display') await this.playEvolution(event, signal);
          else if (event.kind === 'capture-result') await this.playMessage({ text: captureResultText(event) }, signal);
        } catch (error) { if (signal.aborted) return; throw error; }
        if (signal.aborted) return;
        this.playedEvents.add(key);
        this.playedEvents = new Set([...this.playedEvents].slice(-500));
        try { globalThis.sessionStorage?.setItem(CoopBattlePresentation.EVENT_STORAGE, JSON.stringify([...this.playedEvents])); }
        catch { /* see constructor */ }
        if (context.isCurrent?.() === false) return;
        await wait(40, signal);
      }
    } finally {
      // A shortened/failed replay must still leave the committed final frame.
      if (!signal.aborted && batch && this.pending === batch) await this.finish(batch, signal);
      else if (!signal.aborted && !batch) for (const [pokemon, finalHp] of hp) {
        pokemon.hp = finalHp;
        pokemon.setVisible?.(finalHp > 0);
        try { await within(Promise.resolve(pokemon.updateInfo?.(true)), 1200, signal); }
        catch { /* committed model remains separate from display copies */ }
      }
    }
  }

  private async playPhase(event: any, signal: AbortSignal) {
    if (event.phase === 'NextEncounterPhase' || event.phase === 'NewBiomeEncounterPhase') {
      const batch = this.pending;
      if (!batch || batch.encounterShown) return;
      batch.encounterShown = true;
      const next = this.scene.arenaNextEnemy;
      const biomeKey = getBiomeKey(batch.snapshot.shared.biome);
      if (next) { next.base.setTexture(`${biomeKey}_b`); next.setPosition(-300, 0).setVisible(true); }
      const enemies = batch.field.slice(2).filter(Boolean);
      for (const display of enemies) { display.x -= 300; display.setVisible(display.hp > 0); }
      const field = [...this.field.slice(0, 2), ...batch.field.slice(2)];
      this.attachField(field, batch.snapshot.shared);
      for (const display of enemies) this.displayedById.set(display.id, display);
      await visual((local, done) => animateEncounterScroll(this.scene,
        [this.scene.arenaEnemy, next, ...enemies, this.trainerSprite], done, local), 2600, signal);
      if (signal.aborted) return;
      this.paint(batch.snapshot.shared); next?.setVisible(false);
    } else if (event.phase === 'SwitchBiomePhase') {
      const batch = this.pending;
      if (!batch || batch.biomeShown) return;
      batch.biomeShown = true;
      await visual((local, done) => animateEncounterScroll(this.scene,
        [this.scene.arenaEnemy, ...this.field.slice(2), this.trainerSprite], done, local), 2600, signal);
      if (signal.aborted) return;
      const key = getBiomeKey(batch.snapshot.shared.biome);
      this.scene.arenaBgTransition.setTexture(`${key}_bg`).setAlpha(0).setVisible(true);
      const transition = this.scene.arenaPlayerTransition;
      transition.base.setTexture(`${key}_a`); transition.setAlpha(0).setVisible(true);
      await visual((local, done) => animateBiomeBackground(this.scene, done, local), 2600, signal);
      if (!signal.aborted) this.paint(batch.snapshot.shared);
    } else if (event.phase === 'ShowTrainerPhase') {
      const trainer = this.trainerSprite ?? this.scene.trainer;
      if (!trainer) return;
      trainer.setVisible(true).setX(-72);
      await this.tween({ targets: trainer, x: 106, duration: 600 }, signal);
    }
  }

  private async playAnimation(event: any, signal: AbortSignal) {
    const user = this.displayedById.get(event.sourceId);
    const target = this.displayedById.get(event.targetId);
    if (!user) return;
    const field = this.scene.getField();
    const targetIndex = target ? field.indexOf(target) : -1;
    if (targetIndex < 0) return;
    const playback = new AbortController();
    const cancel = () => playback.abort();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (Number.isInteger(event.moveId)) {
        await within(initMoveAnim(event.moveId), 3000, signal);
        await within(loadMoveAnimAssets(this.scene, [event.moveId], true), 3000, signal);
        const animation = new MoveAnim(event.moveId, user, targetIndex);
        await within(new Promise<void>(resolve => animation.play(this.scene, resolve, playback.signal)), 5000, signal);
      } else if (event.commonAnim !== undefined) {
        const animation = new CommonBattleAnim(event.commonAnim, user, target);
        await within(new Promise<void>(resolve => animation.play(this.scene, resolve, playback.signal)), 5000, signal);
      }
    } finally { signal.removeEventListener('abort', cancel); playback.abort(); }
  }

  private async playDamage(event: any, signal: AbortSignal) {
    const target = this.displayedById.get(event.pokemonId);
    if (!target) return;
    if (event.kind === 'damage-display') (this.scene as any).damageNumberHandler?.add(target, event.amount, event.result, event.critical);
    if (typeof event.remainingHp === 'number') {
      if (event.kind === 'pokemon-hp' && target.hp === event.remainingHp && target.getMaxHp() === event.maxHp) return;
      target.hp = event.remainingHp;
      if (typeof event.maxHp === 'number' && event.maxHp !== target.getMaxHp()) {
        if (Object.prototype.hasOwnProperty.call(target, 'getMaxHp')) target.getMaxHp = () => event.maxHp;
        else target.stats[0] = event.maxHp;
      }
      await within(Promise.resolve(target.updateInfo?.(false)), 5500, signal);
    }
  }

  private async showPokemon(event: any, signal: AbortSignal) {
    const batch = this.pending;
    if (!batch) return;
    let entry = batch.entries.get(event.pokemonId);
    if (!entry && event.view) {
      const model = this.model(event.view, batch.applied), display = this.container(model, event.view.owner !== null, event.view.fieldIndex);
      display.init(); this.scene.field.add(display); this.displayed.push(display);
      await within(display.loadAssets(true, signal), 5000, signal);
      if (signal.aborted) return;
      entry = { display, model, view: event.view, key: '' }; // May leave again before the final field snapshot.
      batch.entries.set(event.pokemonId, entry);
    }
    if (!entry) return;
    const display = entry.display;
    const slot = event.view?.fieldIndex ?? batch.snapshot.shared.field.indexOf(event.pokemonId);
    if (slot < 0 || slot > 3) return;
    const field = [...this.field]; field[slot] = display;
    this.displayedById.set(display.id, display); this.attachField(field, batch.snapshot.shared);
    void display.setFieldPosition(slot % 2 ? FieldPosition.RIGHT : FieldPosition.LEFT);
    if (event.kind === 'pokemon-enter') {
      if (event.view) {
        // A switch and the incoming Pokemon's damage can share one committed
        // snapshot. Release starts from the original entry event, not final HP.
        display.hp = event.view.hp;
        if (event.view.maxHp !== display.getMaxHp()) {
          if (Object.prototype.hasOwnProperty.call(display, 'getMaxHp')) display.getMaxHp = () => event.view.maxHp;
          else display.stats[0] = event.view.maxHp;
        }
        this.modelKeys.delete(display.id);
        await within(Promise.resolve(display.updateInfo(true)), 1200, signal);
        if (signal.aborted) return;
      }
      await visual((local, done) => animatePokemonSummon(display, slot < 2, { complete: done }, local), 3000, signal);
    } else if (!display.visible) {
      display.showInfo(); display.setVisible(display.hp > 0);
    }
  }

  private async playDialogue(event: any, signal: AbortSignal) {
    if(event.presentation)event={...event,text:this.localText(event.presentation)};
    if(event.speakerPresentation)event={...event,speaker:this.localText(event.speakerPresentation)};
    // Original UI.showDialogue forces a user prompt and chains page callbacks.
    // Use the same original message handler without a prompt for bounded replay.
    const handler: any = this.scene.ui.getMessageHandler?.();
    if (!event.text || !handler?.showDialogue) return;
    for (const page of event.text.split('$')) {
      if (signal.aborted) return;
      handler.showDialogue(page, event.speaker ?? '', 0, undefined, undefined, false);
      await wait(Math.min(1800, Math.max(500, page.length * 25)), signal);
    }
  }

  private async playMessage(event: any, signal: AbortSignal) {
    if(event.presentation)event={...event,text:this.localText(event.presentation)};
    if (['battle:switchQuestion','battle:levelUp','battle:expGain'].includes(event.messageKey)) {
      const pokemon = this.displayedById.get(event.pokemonId) ?? this.pending?.applied.byId.get(event.pokemonId)?.pokemon;
      const name=pokemon?.species.getName(pokemon.formIndex) ?? i18next.t('coop:pokemon');
      event = { ...event, text: i18next.t(event.messageKey, {...event.values,
        pokemonName:event.messageKey==='battle:switchQuestion'&&!event.useName?i18next.t('coop:pokemon'):name}) };
    }
    if (!event.text || typeof (this.scene.ui as any).showText !== 'function') return;
    if (signal.aborted) return;
    // Messages are display-only here. Do not wait for a click during the
    // authoritative ACK barrier; dialogue uses the explicit dialogue port.
    (this.scene.ui as any).showText(event.text, 0, undefined);
    await wait(Math.min(1800, Math.max(500, event.text.length * 25)), signal);
  }

  private localText(value:any):string {
    return String(renderPresentationText(value,i18next.t.bind(i18next),id=>{
      const pokemon=this.displayedById.get(id)??this.pending?.applied.byId.get(id)?.pokemon;
      return pokemon?.species.getName(pokemon.formIndex);
    }));
  }

  private async playExperience(event: any, signal: AbortSignal) {
    // Off-field party members use the original PartyExpBar too. The verified
    // instance stays detached; no Pokemon constructor or addExp runs here.
    const owned = this.pending?.applied?.byId.get(event.pokemonId);
    const target = this.displayedById.get(event.pokemonId)
      ?? (owned ? Object.assign(restorePokemonState(capturePokemonState(owned.pokemon)), {scene:this.scene}) : null);
    if (!target) return;
    try {
      await within(Promise.resolve(this.scene.partyExpBar?.showPokemonExp?.(target, event.exp)), 1000, signal);
      await wait(300, signal);
      await within(Promise.resolve(this.scene.partyExpBar?.hide?.()), 1000, signal);
    } finally {
      if (signal.aborted) {
        this.scene.tweens.killTweensOf(this.scene.partyExpBar);
        this.scene.partyExpBar?.setVisible(false);
        if (this.scene.partyExpBar) this.scene.partyExpBar.shown = false;
      }
    }
  }

  private async playProgress(event: any, signal: AbortSignal) {
    const target = this.displayedById.get(event.pokemonId);
    if (!target) return;
    Object.assign(target, {hp:event.hp, stats:[...event.stats], level:event.level, exp:event.exp, levelExp:event.levelExp});
    this.modelKeys.delete(target.id);
    await within(Promise.resolve(target.updateInfo(false)), 12000, signal);
  }

  private async playLevelStats(event: any, signal: AbortSignal) {
    const handler: any = this.scene.ui.getMessageHandler?.();
    if (!handler?.promptLevelUpStatsValues || !this.scene.showLevelUpStats) return;
    const audioPort:any=Object.create(this.scene),audioTimers:any[]=[];
    let active=true;
    audioPort.time={delayedCall:(delay,callback,...args)=>{
      const timer=this.scene.time.delayedCall(delay,()=>{if(active&&!signal.aborted)callback();},...args);
      audioTimers.push(timer);return timer;
    }};
    const sound=this.scene.playSoundWithoutBgm.call(audioPort,'level_up_fanfare',1500);
    // Reuse both original pages (increase, then total). A bounded automatic
    // advance also permits the original ACTION/CANCEL, without holding ACK
    // forever on a display-only panel.
    let timer: ReturnType<typeof setInterval>;
    const close = () => {
      if(!active)return;
      active=false;
      for(const timer of audioTimers)timer?.destroy();
      if(signal.aborted)sound?.stop();
      clearInterval(timer);
      handler.levelUpStatsContainer?.setVisible(false);
      handler.awaitingActionInput = false;
      handler.onActionInput = null;
    };
    signal.addEventListener('abort', close, {once:true});
    try {
      const task = handler.promptLevelUpStatsValues([...event.stats], [...event.previous], false);
      timer = setInterval(() => { if (!signal.aborted) handler.onActionInput?.(); }, 1500);
      await within(task, 4000, signal);
    } finally { close(); signal.removeEventListener('abort', close); }
  }

  private async playEvolution(event:any, signal:AbortSignal) {
    const controller=new AbortController(), cancel=()=>controller.abort();
    signal.addEventListener('abort',cancel,{once:true});
    const before = this.container(restorePokemonState(event.before),true) as PlayerPokemon;
    const after = this.container(restorePokemonState(event.after),true) as PlayerPokemon;
    let afterDestroyed=false;
    const destroy=after.destroy.bind(after);
    after.destroy=()=>{if (!afterDestroyed){afterDestroyed=true;destroy();}};
    try {
      before.init();after.init();
      (before as any).battleInfo?.setVisible(false);(after as any).battleInfo?.setVisible(false);
      await within(Promise.all([before.loadAssets(true,signal),after.loadAssets(true,signal)]),5000,signal);
      if (signal.aborted) return;
      await within(presentOriginalEvolution(this.scene,before,after,controller.signal),45000,signal);
    } finally {
      controller.abort();signal.removeEventListener('abort',cancel);
      before.destroy();after.destroy();
      // Evolution fades the original room music. Reset deduplication before
      // selecting the original battle/victory track for this committed frame.
      this.audio.invalidate();
      if (!signal.aborted && this.pending) this.audio.apply(this.pending.snapshot);
    }
  }

  private async fade(ms: number, signal: AbortSignal) {
    const ui: any = this.scene.ui;
    try {
      if (typeof ui.fadeOut === 'function') await within(Promise.resolve(ui.fadeOut(ms)), ms + 250, signal);
      if (!signal.aborted && typeof ui.fadeIn === 'function') await within(Promise.resolve(ui.fadeIn(ms)), ms + 250, signal);
    } finally { ui.cancelFade?.(); }
  }

  private async tween(config: any, signal: AbortSignal) {
    let tween: Phaser.Tweens.Tween;
    try { await within(new Promise<void>(resolve => { tween = this.scene.tweens.add({ ...config, onComplete: resolve }); }), 1200, signal); }
    finally { tween!?.stop(); }
  }

  private container(model: Pokemon, player: boolean, slot?: number): Pokemon {
    // Phaser's Container initializes events/transforms/list ownership. Copying
    // an uninitialized checkpoint directly into the display list cannot do so.
    return createCoopPokemonDisplay(this.scene, model, player, slot);
  }

  private publicModel(view: any): Pokemon {
    const model = Object.create(view.owner === null ? EnemyPokemon.prototype : PlayerPokemon.prototype);
    Object.assign(model, { species: getPokemonSpecies(view.speciesId), formIndex: view.formIndex,
      id: view.id, level: view.level, hp: view.hp, gender: view.gender, shiny: view.shiny, pokeball: view.pokeball,
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

  private model(view: any, applied: any): Pokemon {
    const owned = applied.byId.get(view.id);
    return owned ? restorePokemonState(capturePokemonState(owned.pokemon)) : this.publicModel(view);
  }

  private attachField(field: (Pokemon | null)[], shared: any) {
    this.field = field;
    (this.scene as any).party = field.slice(0, 2);
    this.scene.currentBattle = { ...shared, enemyParty: field.slice(2, 4),
      randSeedInt: () => { throw new Error('CLIENT_RULE_RNG_FORBIDDEN'); } } as any;
  }

  private paint(shared: any) {
    const key = getBiomeKey(shared.biome);
    this.scene.arena.biomeType = shared.biome; this.scene.arena.bgm = Biome[shared.biome].toLowerCase();
    this.scene.arenaBg.setTexture(`${key}_bg`).setPosition(0, 0);
    this.scene.arenaBgTransition.setVisible(false);
    this.scene.arenaPlayerTransition?.setVisible(false);
    for (const base of [this.scene.arenaPlayer, this.scene.arenaEnemy]) {
      base.base.setTexture(`${key}_${base.player ? 'a' : 'b'}`);
      base.add(base.base); base.setPosition(0, 0).setVisible(true); base.setAlpha?.(1);
      base.props.forEach(prop => prop.setVisible(false));
    }
  }

  private async finish(batch: any, signal: AbortSignal) {
    if (signal.aborted || this.pending !== batch) return;
    for (const [id, entry] of batch.entries) {
      if (!batch.snapshot.shared.field.includes(id)) continue;
      const { display, model, key } = entry;
      if (this.modelKeys.get(id) !== key) {
        Object.assign(display, model, { scene: this.scene });
        display.generateName();
        await within(Promise.resolve(display.updateInfo(true)), 1200, signal);
        if (signal.aborted || this.pending !== batch) return;
        this.modelKeys.set(id, key);
      }
      display.setVisible(display.hp > 0);
      (display as any).battleInfo?.setVisible(display.hp > 0);
    }
    const keep = new Set(batch.field.filter(Boolean));
    for (const display of this.displayed) if (!keep.has(display)) {
      this.scene.tweens.killTweensOf((display as any).battleInfo);
      this.scene.tweens.killTweensOf(display);
      this.scene.field?.remove?.(display);
      display.destroy();
    }
    this.displayed = [...keep] as Pokemon[];
    this.displayedById = new Map(this.displayed.map(display => [display.id, display]));
    if (batch.preserveFieldBinding) this.field = batch.field;
    else this.attachField(batch.field, batch.snapshot.shared);
    if (batch.sceneChanged) this.paint(batch.snapshot.shared);
    if (!batch.replay || !(batch.snapshot.events ?? []).some((event: any) => event.kind === 'bgm')) this.audio.apply(batch.snapshot);
    this.lastSnapshot = batch.snapshot; this.pending = null;
  }

  async apply(snapshot: any, applied: any, options: { replay?: boolean; preserveFieldBinding?: boolean } = {}) {
    this.cancel(); this.lifetime = new AbortController();
    const signal = this.lifetime.signal, shared = snapshot.shared;
    const continuous = !!this.lastSnapshot && this.lastSnapshot.runId === snapshot.runId
      && this.lastSnapshot.connectionEpoch === snapshot.connectionEpoch;
    const replay = !!options.replay && continuous;
    const entries = new Map<number, any>();
    const batch = { snapshot, applied, entries, field: [] as (Pokemon | null)[], replay, preserveFieldBinding: !!options.preserveFieldBinding };
    this.pending = batch;
    try {
      if (!options.preserveFieldBinding) this.attachField(this.field, shared);
      for (const view of shared.pokemon) {
        if (!shared.field.includes(view.id)) continue;
        const look = JSON.stringify([view.speciesId, view.formIndex, view.gender, view.shiny]);
        const model = this.model(view, applied);
        const key = applied.byId.has(view.id) ? JSON.stringify(capturePokemonState(model)) : JSON.stringify(view);
        let display = this.displayedById.get(view.id);
        if (!display || this.looks.get(view.id) !== look) {
          display = this.container(model, view.owner !== null, shared.field.indexOf(view.id));
          this.displayed.push(display);
          display.init(); this.scene.field.add(display);
          await within(display.loadAssets(true, signal), 5000, signal);
          if (signal.aborted) return;
          // Original immediate setFieldPosition does not resolve its Promise.
          const slot = shared.field.indexOf(view.id);
          void display.setFieldPosition(slot % 2 ? FieldPosition.RIGHT : FieldPosition.LEFT);
          await within(Promise.resolve(display.updateInfo(true)), 1200, signal);
          display.setVisible(!replay && display.hp > 0);
          (display as any).battleInfo.setVisible(!replay && display.hp > 0);
          this.looks.set(view.id, look);
          this.modelKeys.set(view.id, key);
        }
        entries.set(view.id, { display, model, key, view });
      }
      batch.field = shared.field.map((id: number | null) => id === null ? null : entries.get(id)?.display ?? null);
      if (!replay) this.attachField(batch.field, shared);
      const sceneChanged = !this.lastSnapshot || this.lastSnapshot.shared.biome !== shared.biome
        || this.lastSnapshot.shared.waveIndex !== shared.waveIndex;
      (batch as any).sceneChanged = sceneChanged;
      this.scene.waveCycleOffset = shared.waveCycleOffset;
      this.scene.arena.biomeType = shared.biome;
      this.scene.arena.bgm = Biome[shared.biome].toLowerCase();
      this.scene.arenaBg.pipelineData = { terrainColorRatio: shared.terrainColorRatio };
      if (sceneChanged && !replay) this.paint(shared);
      const trainer = shared.trainer;
      if (JSON.stringify(trainer) !== JSON.stringify(this.lastSnapshot?.shared.trainer) || !this.lastSnapshot) {
        this.scene.trainer.setVisible(false); this.trainerSprite = null;
        if (trainer?.spriteKey) {
          if (!this.scene.textures.exists(trainer.spriteKey))
            await within(trainerConfigs[trainer.type].loadAssets(this.scene, trainer.variant), 2000, signal);
          if (signal.aborted) return;
          this.scene.trainer.setTexture(trainer.spriteKey).setFrame(0).setPosition(106, 80).setVisible(true);
          this.trainerSprite = this.scene.trainer;
        }
      }
      if (!replay) await this.finish(batch, signal);
      return batch.field;
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
  }
}
