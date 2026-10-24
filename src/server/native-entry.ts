import BattleScene from '../battle-scene';
import { Phase } from '../phase';
import Pokemon, { EnemyPokemon, FieldPosition, HitResult } from '../field/pokemon';
import { NewBattlePhase, EncounterPhase, ShowTrainerPhase, SummonPhase, SummonMissingPhase, PostSummonPhase, ToggleDoublePositionPhase,
  TurnInitPhase, CommandPhase, MessagePhase, ShinySparklePhase } from '../phases';
import { SelectTargetPhase, EnemyCommandPhase, TurnStartPhase, MovePhase, MoveEffectPhase,
  MoveEndPhase, DamagePhase, StatChangePhase, TurnEndPhase, PostTurnStatusEffectPhase, CommonAnimPhase, ObtainStatusEffectPhase, ShowAbilityPhase, BerryPhase, PokemonHealPhase } from '../phases';
import { FaintPhase, VictoryPhase, ExpPhase, ShowPartyExpBarPhase, HidePartyExpBarPhase, LevelUpPhase, LearnMovePhase, BattleEndPhase, EggLapsePhase, AttemptCapturePhase, TrainerVictoryPhase, MoneyRewardPhase, ModifierRewardPhase } from '../phases';
import { SelectModifierPhase, SelectBiomePhase, SwitchBiomePhase, NewBiomeEncounterPhase, PartyHealPhase, LevelCapPhase, WeatherEffectPhase } from '../phases';
import { preparationItemTarget, isPreparationModifier, isPreparationPersistent } from '../coop/preparation-item';
import { CheckSwitchPhase, SwitchPhase, SwitchSummonPhase, ReturnPhase } from '../phases';
import { Mode } from '../ui/ui';
import { GameData } from '../system/game-data';
import { GameStats } from '../system/game-stats';
import { BattleAnim } from '../data/battle-anims';
import { createOriginalRuntime, constructOriginalPokemon, constructSelectedStarterInstance, capturePokemonState } from './original-runtime';
import Trainer from '../field/trainer';
import { TrainerSlot } from '../data/trainer-config';
import { restoreStarterSelection } from '../coop/original-starter-selection';
import { originalDecisionStateCodec as codec, originalPhaseStateCodec as phases } from '../original-phase-checkpoints';
import { originalOwnedEggStateCodec } from '../original-phase-checkpoints';
import { createRuleTaskTracker, observeRulePromise } from '../battle-core/rule-task-tracker.mjs';
import { bindPresentationPort } from '../battle-core/presentation-port.mjs';
import { selectNextPhase, populatePhaseQueue } from '../battle-core/phase-queue.mjs';
import { emptyContinuation } from '../battle-core/phase-continuation.mjs';
import { advanceQueuedRulePhase } from '../battle-core/rule-phase-runner.mjs';
import { withOriginalRules } from '../../server/original-random-context.mjs';
import { SceneRandom } from '../battle-core/decision-state.mjs';
import { getMoveTargets, allMoves } from '../data/move';
import { resolveFightIntent } from '../battle-core/fight-command.mjs';
import { advanceCollectedFightCommands } from '../battle-core/fight-command.mjs';
import { bindCoopModifierScope } from '../battle-core/modifier-scope.mjs';
import { bindCoopFaint } from '../battle-core/faint-queue.mjs';
import { openPreparation, advancePreparation, validatePreparationAction, completeSharedPreparation, coopRewardExclusions } from '../battle-core/preparation-runner.mjs';
import { advancePreparationEffect, validatePreparationEffect } from '../battle-core/preparation-effects-runner.mjs';
import { advanceNextBattle } from '../battle-core/next-battle-runner.mjs';
import { originalSafeDecisionCodec } from '../original-phase-checkpoints';
import { captureModifierTypeState, getPlayerShopModifierTypeOptionsForWave, modifierTypes,
  ModifierTypeOption, restoreModifierTypeState } from '../modifier/modifier-type';
import { fixedBattles, BattleType } from '../battle';
import { Biome } from '../data/enums/biome';
import { PokeballType } from '../data/pokeball';
import { advancePreBattleSwitch } from '../battle-core/pre-battle-switch-runner.mjs';
import { createPreBattleSwitchDecision, createForcedSwitchDecision } from '../battle-core/switch-command.mjs';
import { advanceForcedSwitch } from '../battle-core/forced-switch-runner.mjs';
import PartyUiHandler, { PartyOption, PartyUiMode } from '../ui/party-ui-handler';
import { createCaptureChoice, validateCaptureChoice } from '../battle-core/capture-choice.mjs';
import { hasLegacyCaptures, legacyCaptureOptions, validateLegacyCapture } from '../battle-core/legacy-capture.mjs';
import { nextSafeDecisionId } from '../battle-core/safe-decisions.mjs';
import { PokemonHeldItemModifier, captureModifierState } from '../modifier/modifier';
import { EncoreTag, TrappedTag } from '../data/battler-tags';
import { CheckTrappedAbAttr, applyCheckTrappedAbAttrs } from '../data/ability';
import * as Utils from '../utils';
import { Command } from '../ui/command-ui-handler';
import { Moves } from '../data/enums/moves';
import { canonical, requireContract as check } from '../battle-core/coop-contract.mjs';
import { advanceProgressionChoice } from '../battle-core/progression-choice-runner.mjs';
import { createLearnDecision, inspectLearnMove } from '../battle-core/learn-command.mjs';
import { recoverVictoryParties } from '../battle-core/victory-aftermath-runner.mjs';
import { EvolutionPhase, EndEvolutionPhase } from '../evolution-phase';
import { evolutionReferenceCodec } from '../original-phase-checkpoints';
import { advancePreparationGrowth } from '../battle-core/preparation-growth-runner.mjs';
import { presentationText, resetPresentationText } from '../system/presentation-text.mjs';
import i18next from '../i18n';
import { QuietFormChangePhase } from '../form-change-phase';
import { GameOverPhase, UnlockPhase } from '../phases';
import { BattleSpec } from '../enums/battle-spec';
import { bindCoopGameOver } from '../battle-core/coop-game-over.mjs';
import { achvs } from '../system/achv';
import { vouchers } from '../system/voucher';

// Progression choices append a safe sequence suffix. Keep the legacy native
// counter for old checkpoints, and carry choice suffixes forward intact; parsing
// a suffixed ID as a number would produce a repeated "native-…-NaN" boundary.
function nextNativeDecisionId(c) {
  const last = c.decision.id.split('-').at(-1);
  if (!/^\d+$/.test(last)) return nextSafeDecisionId(c.decision.id);
  const sequence=Number(last)+1;
  check(Number.isSafeInteger(sequence),'DECISION_SEQUENCE_EXHAUSTED');
  return `native-${c.battle.waveIndex}-${sequence}`;
}
const partyWiped=c=>!c.roster.entries.some(e=>e.owner!==null&&e.group==='party'&&!e.pokemon.isFainted(true));
const defeatDecision=id=>({id,kind:'ended',requiredSeats:[],victory:false,reason:'defeat'});
const victoryDecision=id=>({id,kind:'ended',requiredSeats:[],victory:true,reason:'victory'});

// Trainer visuals are display-only. Native battle tests have no Phaser
// Container list; the original encounter/rules still construct the real
// Trainer and party, while the client projects its own trainer presentation.
(Trainer.prototype as any).initSprite = function () {};
(Trainer.prototype as any).playAnim = function () {};
(Trainer.prototype as any).getSprites = function () { return [new DisplayTarget()]; };
(Trainer.prototype as any).getTintSprites = function () { return [new DisplayTarget()]; };
(Trainer.prototype as any).tint = function () { return this; };
(Trainer.prototype as any).clearTint = function () { return this; };
(Trainer.prototype as any).destroy = function () {}; // Renderer disposal of the previous encounter only.

// Explicit display targets; unknown rendering methods remain unavailable.
class DisplayTarget {
  x = 0; y = 0; visible = false;
  setX(x) { this.x = x; return this; }
  setY(y) { this.y = y; return this; }
  setPosition(x, y) { this.x = x; this.y = y; return this; }
  setVisible(value) { this.visible = value; return this; }
  setOrigin(..._args) { return this; }
  setTexture(..._args) { return this; }
  setFrame(..._args) { return this; }
  setPipeline(..._args: any[]) { return this; }
  setBiome(..._args: any[]) { return this; }
  setScale(..._args) { return this; }
  setAlpha(..._args: any[]) { return this; }
  clearTint() { return this; }
  setTintFill(..._args: any[]) { return this; }
  destroy() {}
}

const supportedPhases = [SummonPhase, SummonMissingPhase, PostSummonPhase, ToggleDoublePositionPhase, TurnInitPhase, MessagePhase, ShinySparklePhase, ShowTrainerPhase,
  EnemyCommandPhase, TurnStartPhase, MovePhase, MoveEffectPhase, MoveEndPhase, DamagePhase, StatChangePhase, TurnEndPhase, PostTurnStatusEffectPhase, CommonAnimPhase, ObtainStatusEffectPhase, ShowAbilityPhase,
  FaintPhase, VictoryPhase, ExpPhase, ShowPartyExpBarPhase, HidePartyExpBarPhase, LevelUpPhase, LearnMovePhase, EvolutionPhase, EndEvolutionPhase, BattleEndPhase, EggLapsePhase, CheckSwitchPhase, SwitchPhase, SwitchSummonPhase, ReturnPhase, TrainerVictoryPhase, MoneyRewardPhase, ModifierRewardPhase, AttemptCapturePhase, BerryPhase, PokemonHealPhase, LevelCapPhase, WeatherEffectPhase, QuietFormChangePhase, GameOverPhase];
const supportsPhase = p => supportedPhases.some(ctor => Object.getPrototypeOf(p) === ctor.prototype);
const switchKind = p => p instanceof AttemptCapturePhase ? 'capture-select' : p instanceof CheckSwitchPhase ? 'switch-confirm'
  : p.isModal ? 'wait-switch' : 'switch-select';
const switchDecision = (id, c, p) => p instanceof AttemptCapturePhase
  ? createCaptureChoice(id, c, phases.capture(p, c).scope) : switchKind(p) === 'wait-switch'
  ? createForcedSwitchDecision(id, c, [p.fieldIndex])
  : createPreBattleSwitchDecision(id, c, p.fieldIndex, switchKind(p));

// These original methods only display; they never consume a move or change HP.
function installPokemonDisplayPort() {
  const proto: any = Pokemon.prototype;
  proto.init = function () { this.fieldPosition = FieldPosition.CENTER; };
  for (const name of ['tint', 'untint', 'cry', 'showInfo', 'hideInfo', 'playAnim', 'sparkle', 'updateScale', 'initBattleInfo'])
    proto[name] = function () {
      const view = name === 'showInfo' ? this.scene.nativePublicPokemon?.(this) : null;
      this.scene.nativeEvents.push({ kind: name, pokemonId: this.id, ...(view ? { view, scope:'shared' } : {}) });
      if (name === 'hideInfo') return Promise.resolve();
    };
  proto.loadAssets = function () { return Promise.resolve(); };
  proto.updateInfo = function () {
    const view = this.scene.nativePublicPokemon?.(this);
    if (view) this.scene.nativeEvents.push({ kind: 'pokemon-hp', scope:'shared', pokemonId: this.id, remainingHp: view.hp, maxHp: view.maxHp });
    const owner = this.scene.nativeOwner;
    if (owner === 0 || owner === 1) this.scene.nativeEvents.push({ kind: 'pokemon-progress', scope: owner,
      pokemonId: this.id, hp: this.hp, stats: [...this.stats], level: this.level, exp: this.exp, levelExp: this.levelExp });
    return Promise.resolve();
  };
  proto.faintCry = function (callback) {
    this.scene.nativeEvents.push({ kind: 'faint-cry', scope:'shared', pokemonId: this.id });
    this.scene.time.delayedCall(0, callback);
  };
  proto.getSprite = function () { return new DisplayTarget(); };
  proto.setFrameRate = function () {}; // Status slow-down only changes rendered sprite animations.
  proto.updateSpritePipelineData = function () { this.updateInfo(true); }; // Tera shader only; the original modifier owns the type/rules.
  proto.destroy = function () {}; // Renderer disposal only; the original release owns party/modifier changes.
  proto.setFieldPosition = function (position) { this.fieldPosition = position; return Promise.resolve(); };
  for (const name of ['setX', 'setY', 'setPosition', 'setVisible', 'setScale'])
    proto[name] = DisplayTarget.prototype[name];
  // EnemyPokemon overrides the abstract base display method. Boss encounter
  // adjustment and original segmented damage call it even in the Worker.
  (EnemyPokemon.prototype as any).initBattleInfo = function () {
    this.battleInfo = { updateBossSegments: pokemon => {
      const view = pokemon.scene.nativePublicPokemon?.(pokemon);
      if (view) pokemon.scene.nativeEvents.push({kind:'pokemon-hp',scope:'shared',pokemonId:pokemon.id,
        remainingHp:view.hp,maxHp:view.maxHp,bossSegments:pokemon.bossSegments,bossSegmentIndex:pokemon.bossSegmentIndex});
    } };
  };
}

function bindNativeScene(c: any, identity: any, inputs: any = {}) {
  installPokemonDisplayPort();
  const root: any = createOriginalRuntime(c.scene.seed, identity).scene;
  Object.assign(root, c.scene, { arena: c.arena, currentBattle: c.battle, enemyModifiers: c.enemyModifiers,
    nativeEvents: [], enableTutorials: false });
  const events = root.nativeEvents, intents = [], callbacks = [];
  let tick = 0, order = 0, ended = 0, waiting = null, nextId = 0;
  let completePhase: (() => void) | undefined;
  const ids = new WeakMap();
  const phaseScopes = new WeakMap();
  const schedule = (callback, delay = 0) => { if (callback) callbacks.push({ callback, tick: tick + delay, order: order++ }); };
  const parties = [0, 1].map(seat => c.roster.entries.filter(e => e.owner === seat && e.group === 'party')
    .sort((a, b) => a.index - b.index).map(e => e.pokemon));
  root.party = [parties[0][0], parties[1][0], ...parties[0].slice(1), ...parties[1].slice(1)].filter(Boolean);
  root.getParty = () => [parties[0][0], parties[1][0], ...parties[0].slice(1), ...parties[1].slice(1)].filter(Boolean);
  root.field = { list: [], add(p) { this.list.push(p); return this; },
    getIndex(p) { return this.list.indexOf(p); }, getAll() { return [...this.list]; },
    remove(p) { const i = this.getIndex(p); if (i >= 0) this.list.splice(i, 1); }, moveBelow() {} };
  const deferredData = () => ({ ...identity, unlocks: {}, gameStats: new GameStats(), getFormAttr: GameData.prototype.getFormAttr,
    setPokemonSeen: (p, incrementCount = true) => intents.push({ kind: 'seen', pokemonId: p.id,
      speciesId: p.species.speciesId, dexAttr: p.getDexAttr().toString(), incrementCount }),
    updateSpeciesDexIvs: (speciesId, ivs) => intents.push({ kind: 'dex-ivs', speciesId, ivs: [...ivs] }),
    setPokemonCaught: (p, incrementCount = true) => { intents.push({ kind: incrementCount ? 'capture-pending' : 'evolution-pending', pokemonId: p.id,
      speciesId: p.species.speciesId, dexAttr: p.getDexAttr().toString(), level: p.level,
      ivs: [...p.ivs], nature: p.nature, pokemon: capturePokemonState(p) }); return Promise.resolve(); },
    saveSystem: () => { throw new Error('PERMANENT_SAVE_UNAVAILABLE'); },
    saveSession: () => { throw new Error('PERSONAL_SESSION_SAVE_UNAVAILABLE'); } });
  root.gameData = deferredData();
  const views = parties.map((party, seat) => {
    const view = Object.create(root);
    Object.assign(view, { nativeOwner: seat, modifiers: c.players[seat].modifiers, money: c.players[seat].money,
      pokeballCounts: c.players[seat].pokeballCounts, gameData: deferredData(), getParty: () => party,
      getPlayerField: () => root.getPlayerField(), getEnemyField: () => root.getEnemyField(),
      getField: active => root.getField(active), getPokemonById: id => root.getPokemonById(id),
      getPlayerPokemon: () => root.getPlayerPokemon() });
    Object.defineProperty(view,'money',{configurable:true,get:()=>c.players[seat].money,set:value=>{c.players[seat].money=value;}});
    view.validateAchv = achv => { intents.push({kind:'achievement-check',id:achv.id,owner:seat});return false; };
    for (const name of ['applyModifiers', 'applyModifier', 'findModifiers', 'findModifier', 'getModifiers', 'removeModifier'])
      view[name] = BattleScene.prototype[name];
    for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue', 'phaseQueuePrependSpliceIndex', 'currentPhase', 'standbyPhase', 'waveSeed'])
      Object.defineProperty(view, key, { get: () => root[key], set: value => { root[key] = value; }, configurable: true });
    return view;
  });
  root.modifiers = c.players.flatMap(p => p.modifiers);
  // Original trainers may deliberately reuse one member seed. That can produce
  // the same generated id (also used by the original IV/shiny rules) twice.
  // Allocate only the co-op roster identity after construction, before items or
  // seen/participant references exist. Keep every generated field and RNG draw.
  const enemyIds = new Set<number>(c.roster.entries.map(e => e.pokemon.id).concat(c.roster.retiredIds));
  root.addEnemyPokemon = (...args) => {
    const pokemon = BattleScene.prototype.addEnemyPokemon.apply(root, args);
    if (enemyIds.has(pokemon.id)) {
      let id = 0;
      while (enemyIds.has(id)) id++;
      pokemon.id = id;
    }
    enemyIds.add(pokemon.id);
    return pokemon;
  };
  root.nativePublicPokemon = pokemon => {
    const owner = views.indexOf(pokemon.scene), index = owner >= 0 ? parties[owner].indexOf(pokemon) : root.getEnemyParty().indexOf(pokemon);
    if (index < 0 || (owner >= 0 ? index !== 0 : index > 1)) return null;
    return { ...publicPokemonView({ pokemon, owner: owner >= 0 ? owner : null, index }),
      fieldIndex: owner >= 0 ? owner : 2 + index, pokeball: pokemon.pokeball };
  };
  for (const { pokemon, owner } of c.roster.entries) {
    pokemon.scene = owner === null ? root : views[owner];
    if (pokemon instanceof EnemyPokemon && pokemon.isBoss()) pokemon.initBattleInfo();
    // M2 deliberately excludes display position. Reattach display coordinates
    // without replaying a Pokemon constructor or consuming rule randomness.
    pokemon.setPosition(owner === null ? 236 : 106, owner === null ? 84 : 148);
  }
  // Pokemon.name is presentation state and intentionally absent from the rule
  // codec. Original phase messages still read it, so rebuild the deterministic
  // display name after restore without replaying a constructor.
  for (const entry of c.roster.entries) entry.pokemon.generateName?.();
  for (const id of c.roster.field) if (id !== null) {
    const p = c.roster.entries.find(e => e.pokemon.id === id).pokemon;
    if (!p.isFainted(true)) root.field.add(p);
  }
  c.arena.scene = root;
  if (c.battle?.trainer) c.battle.trainer.scene = root;
  const trackers = [root, ...views].map(scene => createRuleTaskTracker(scene));
  const disposePorts = [root, ...views].map(scene => bindPresentationPort(scene, (kind, payload) => events.push({ kind, ...payload,
    ...(['pokemon-enter','pokemon-exit'].includes(kind) ? {scope:'shared'} : {}) })));
  root.deferEncounterPersistence = () => {
    intents.push({ kind: 'encounter-persistence-pending', waveIndex: root.currentBattle.waveIndex });
    return Promise.resolve();
  };
  root.shiftPhase = () => { check(++ended === 1, 'NATIVE_PHASE_COMPLETED_TWICE'); completePhase?.(); };
  root.initSession = () => { intents.push({ kind: 'session-start' }); };
  root.playBgm = (key, fadeOut) => {
    key ??= root.currentBattle.getBgmOverride(root) || root.arena.bgm || Biome[root.arena.biomeType].toLowerCase();
    events.push({ kind: 'bgm', key, fadeOut: !!fadeOut });
  };
  root.playSound = root.playSoundWithoutBgm = () => ({totalDuration:0,destroy() {}});
  root.isBgmPlaying = () => false;
  root.updateFieldScale = root.setFieldScale = () => Promise.resolve();
  root.updateUIPositions = root.updateWaveCountText = root.updateMoneyText = root.updateScoreText = () => {};
  root.trainer = root.arenaPlayer = root.arenaEnemy = root.arenaNextEnemy = new DisplayTarget();
  root.arenaBg = new DisplayTarget();root.arenaBgTransition = new DisplayTarget();root.arenaPlayerTransition = new DisplayTarget();
  root.showEnemyTrainer = root.hideEnemyTrainer = () => {};
  root.charSprite = { showCharacter: () => Promise.resolve(), hide: () => Promise.resolve() };
  root.showFieldOverlay = root.hideFieldOverlay = () => Promise.resolve();
  root.pbTray = root.pbTrayEnemy = { hide() {}, showPbTray() {} };
  root.modifierBar = root.enemyModifierBar = { updateModifiers() {} };
  root.partyExpBar = {
    showPokemonExp(pokemon, exp) {
      events.push({ kind: 'experience-bar', pokemonId: pokemon.id, exp });
      return Promise.resolve();
    },
    hide: () => Promise.resolve(),
  };
  root.pokemonInfoContainer = { show(pokemon) { events.push({ kind: 'capture-info', pokemonId: pokemon.id }); },
    hide() {} };
  root.addFaintedEnemyScore = BattleScene.prototype.addFaintedEnemyScore;
  root.queueCaptureAttempt = (phase, seat) => {
    check(seat === 0 || seat === 1, 'INVALID_CAPTURE_OWNER');
    phase.scene = views[seat];
    phase.coopTargetId = phase.getPokemon()?.id;
    root.unshiftPhase(phase);
  };
  root.abilityBar = { shown: false, showAbility(p) { this.shown = true; events.push({ kind: 'ability-display', pokemonId: p.id }); }, hide() { this.shown = false; } };
  root.add = { existing() {}, sprite: (..._args: any[]) => new DisplayTarget() };
  root.load = { atlas() {}, image() {}, spritesheet() {}, audio() {},
    isLoading() { return false; }, start() {},
    once(event, fn) { if (event === 'complete') schedule(fn); } };
  root.anims = { generateFrameNames() { return []; }, create() {} };
  root.addFieldSprite = (x, y) => new DisplayTarget().setPosition(x, y);
  root.validateAchv = (achv) => { intents.push({ kind: 'achievement-check', id: achv.id }); return false; };
  root.validateVoucher = voucher => {
    for(const owner of [0,1])intents.push({kind:'voucher-pending',owner,id:voucher.id,
      voucherType:voucher.voucherType,count:1,fallbackCatalogId:'VOUCHER',resolve:'original-unlock-or-repeat'});
    // Collection/gacha is explicitly deferred. Save each owned entitlement,
    // never write a balance or trigger the original repeat-voucher fallback now.
    return true;
  };
  root.time = { delayedCall: (delay, fn, args = [], scope = null) => {
    // Phaser Clock permits a timer without a callback and supports cancellation.
    const timer={active:true,destroy(){this.active=false;},remove(){this.active=false;}};
    schedule(()=>{if(timer.active&&fn)fn.apply(scope,args);},delay);return timer;
  } };
  root.time.addEvent = config => {
    check(config.repeat !== -1, 'UNSUPPORTED_REPEATING_RULE_TIMER');
    const timer = { repeatCount: config.repeat ?? 0, active: true, destroy() { this.active = false; } };
    const callback = () => {
      if (!timer.active) return;
      if(config.callback)config.callback.call(config.callbackScope);
      if (timer.repeatCount > 0) { timer.repeatCount--; schedule(callback, config.delay ?? 0); }
    };
    schedule(callback, config.delay ?? 0); return timer;
  };
  root.tweens = { add: config => { schedule(config.onComplete, config.duration ?? 0); return { stop() {} }; },
    addCounter: config => {
      const counter = {
        stopped: false,
        getValue: () => 0,
        stop() { this.stopped = true; },
      };
      const repeats = config.repeat ?? 0;
      for (let index = 0; index < repeats; index++)
        schedule(() => { if (!counter.stopped) config.onRepeat?.(); }, (index + 1) * ((config.duration ?? 0) + (config.repeatDelay ?? 0)));
      schedule(() => { if (!counter.stopped) config.onUpdate?.(counter); }, 0);
      schedule(() => { if (!counter.stopped) config.onComplete?.(); }, (repeats + 1) * ((config.duration ?? 0) + (config.repeatDelay ?? 0)));
      return counter;
    } };
  let messageHasPages=false;
  root.ui = { getMessageHandler: () => ({ promptLevelUpStats: (index, previous) => {
    const phase = root.currentPhase, owner = views.indexOf(phase?.scene);
    check(phase instanceof LevelUpPhase && (owner === 0 || owner === 1), 'INVALID_LEVEL_DISPLAY_OWNER');
    const pokemon = parties[owner][index];
    events.push({kind:'level-stats', scope:owner, pokemonId:pokemon.id, level:pokemon.level,
      previous:[...previous], stats:[...pokemon.stats]});
    return Promise.resolve();
  } }), setMode: (mode, seat, _move, callback) => {
    if (mode === Mode.COMMAND) {
      check(root.currentPhase instanceof CommandPhase, 'NATIVE_UI_DECISION_REQUIRED');
      const p = root.currentPhase, action = inputs[seat];
      if (action?.kind === 'fight') {
        check(Number.isInteger(action.cursor), 'NATIVE_UI_DECISION_REQUIRED');
        schedule(() => check(p.handleCommand(Command.FIGHT, action.cursor, false), 'NATIVE_COMMAND_REJECTED'));
      } else if (action?.kind === 'ball') {
        root.pokeballCounts = c.players[seat].pokeballCounts;
        schedule(() => {
          const ally = c.battle.turnCommands[seat - 1];
          const skip = ally?.skip;
          check(p.handleCommand(Command.BALL, action.pokeballType), 'NATIVE_COMMAND_REJECTED');
          // Solo's second battler shares its trainer's action. Co-op seats act
          // independently; undo only the skip introduced by the BALL branch.
          if (ally) { if (skip === undefined) delete ally.skip; else ally.skip = skip; }
        });
      } else {
        check(action?.kind === 'switch', 'NATIVE_UI_DECISION_REQUIRED');
        const entry = c.roster.entries.find(e => e.owner === seat && e.group === 'party'
          && e.pokemon.id === action.pokemonId);
        const cursor = entry ? root.getParty().indexOf(entry.pokemon) : -1;
        check(cursor >= 0, 'INVALID_SWITCH_INTENT');
        // The original CommandPhase validates traps/abilities and stores the
        // ordinary POKEMON command. SwitchSummonPhase owns the actual swap.
        schedule(() => check(p.handleCommand(Command.POKEMON, cursor, false), 'NATIVE_COMMAND_REJECTED'));
      }
    } else if (mode === Mode.TARGET_SELECT) {
      check(inputs[seat]?.kind === 'fight' && Number.isInteger(inputs[seat].target), 'NATIVE_UI_DECISION_REQUIRED');
      schedule(() => callback(inputs[seat].target));
    } else if (mode === Mode.CONFIRM && root.currentPhase instanceof AttemptCapturePhase) waiting = 'capture-select';
    else if (mode === Mode.CONFIRM && root.currentPhase instanceof CheckSwitchPhase) waiting = 'switch-confirm';
    else if (mode === Mode.PARTY && root.currentPhase instanceof SwitchPhase) waiting = 'switch-select';
    else check(mode === Mode.MESSAGE, 'NATIVE_UI_DECISION_REQUIRED');
    return Promise.resolve();
  },
    showDialogue: (...args: any[]) => {
      events.push({ kind: 'dialogue', text: args[0] ?? null, speaker: args[1] ?? null,
        presentation:presentationText(args[0]),speakerPresentation:presentationText(args[1]) });
      const callback = [...args].reverse().find(arg => typeof arg === 'function');
      schedule(callback);
    },
    showText: (text, _delay, callback, _callbackDelay?, _prompt?, _promptDelay?, metadata?) => {
      const owner = root.currentPhase instanceof MoneyRewardPhase || root.currentPhase instanceof ModifierRewardPhase || root.currentPhase instanceof CheckSwitchPhase
        || root.currentPhase instanceof ExpPhase || root.currentPhase instanceof LevelUpPhase || root.currentPhase instanceof LearnMovePhase
        ? views.indexOf(root.currentPhase.scene) : -1;
      const phase = root.currentPhase;
      const question = phase instanceof CheckSwitchPhase ? {
        messageKey: 'battle:switchQuestion', pokemonId: views[owner].getPlayerField()[(phase as any).fieldIndex].id,
        useName: !!(phase as any).useName,
      } : {};
      const source=phase instanceof MessagePhase
        ?((phase as any).textPresentation?JSON.parse((phase as any).textPresentation):null):presentationText(text);
      const presentation=source&&messageHasPages?{kind:'message-fragment',source,part:'head'}:source??null;
      events.push({ kind: 'message', text, presentation, ...question, ...metadata, ...(owner >= 0 ? {scope:owner} : {}) }); schedule(callback);
    } };
  root.damageNumberHandler = { add: (p, amount, result = HitResult.EFFECTIVE, critical = false) =>
    events.push({ kind: 'damage-display', scope:'shared', pokemonId: p.id, amount, result, critical, remainingHp: p.hp }) };
  root.ui.setModeForceTransition = root.ui.setMode;
  root.ui.fadeOut = root.ui.fadeIn = () => Promise.resolve();
  BattleAnim.prototype.play = function (scene: any, callback) {
    const animation = this as any;
    const event: any = { kind: 'battle-animation', animation: this.constructor.name,
      sourceId: animation.user?.id ?? null, targetId: animation.target?.id ?? null };
    if (animation.move !== undefined) event.moveId = animation.move;
    if (animation.commonAnim !== undefined) event.commonAnim = animation.commonAnim;
    scene.nativeEvents.push(event);
    scene.time.delayedCall(0, callback);
  };
  const update = BattleScene.prototype.updateModifiers;
  const pokemonUpdates = new Map<Pokemon, PropertyDescriptor | undefined>();
  const observePokemon = (pokemon: Pokemon) => {
    if (pokemonUpdates.has(pokemon)) return;
    pokemonUpdates.set(pokemon, Object.getOwnPropertyDescriptor(pokemon, 'updateInfo'));
    const updateInfo = pokemon.updateInfo;
    pokemon.updateInfo = (...args) => observeRulePromise(pokemon.scene, updateInfo.apply(pokemon, args));
  };
  c.roster.entries.forEach(entry => observePokemon(entry.pokemon));
  for (const scene of [root, ...views]) {
    scene.updateModifiers = function (...args) { return observeRulePromise(this, update.apply(this, args)); };
    scene.updatePartyForModifiers = function (party, ...args) {
      party.forEach(observePokemon);
      return observeRulePromise(this, BattleScene.prototype.updatePartyForModifiers.call(this, party, ...args));
    };
  }
  const generate = BattleScene.prototype.generateEnemyModifiers;
  root.generateEnemyModifiers = () => observeRulePromise(root, generate.call(root));
  root.newBattle = (...args) => {
    const wave = args[0] ?? (root.currentBattle?.waveIndex ?? 0) + 1;
    const fixed = fixedBattles[wave]?.battleType === BattleType.TRAINER ? fixedBattles[wave] : null;
    const oldDouble = fixed?.double;
    // Only the synchronous original constructor reads this config. Restore it
    // before any asynchronous encounter work or subsequent request can run.
    try {
      if (fixed) fixed.double = true;
      return BattleScene.prototype.newBattle.call(root, args[0], args[1], args[2], true);
    } finally { if (fixed) fixed.double = oldDouble; }
  };
  function bindPhase(p, existingScope?: number) {
    if(p instanceof MessagePhase&&!Object.prototype.hasOwnProperty.call(p,'textPresentation')){
      const source:any=root.currentPhase;
      const page=source instanceof MessagePhase?(source as any).text?.indexOf('$'):-1;
      const descriptor=page>=0&&source!==p&&(p as any).text===(source as any).text.slice(page+1)&&source.textPresentation
        ?{kind:'message-fragment',source:JSON.parse(source.textPresentation),part:'tail'}:presentationText((p as any).text);
      // Original display fields remain scalar-only; persist the descriptor as
      // display JSON without admitting objects into the Phase rule schema.
      (p as any).textPresentation=descriptor?JSON.stringify(descriptor):null;
    }
    // Capture is personal, but its Victory starts the shared encounter/EXP
    // lifecycle. Do not let the catcher's temporary reserve view own it.
    if (p instanceof VictoryPhase && views.includes((p as any).scene)) (p as any).scene = root;
    // TurnStart creates root-scene switches with a composite party cursor.
    // Normalize while the phase is queued, before its first checkpoint: later
    // execution and restart must not depend on the already consumed inputs.
    if (p instanceof SwitchSummonPhase && (p as any).player && (p as any).scene === root
      && Number.isInteger((p as any).slotIndex) && (p as any).slotIndex >= 0) {
      const seat = (p as any).fieldIndex;
      const target = root.getParty()[(p as any).slotIndex];
      const index = parties[seat]?.indexOf(target);
      check(index > 0, 'INVALID_SWITCH_TARGET');
      (p as any).slotIndex = index;
    }
    let scope = existingScope;
    if (scope === undefined) scope = phaseScopes.get(p);
    if (scope === undefined) scope = views.includes(p.scene) ? views.indexOf(p.scene)
      : p.player === true || p instanceof CommandPhase || p instanceof CheckSwitchPhase || p instanceof SwitchPhase ? p.fieldIndex
        : p.pokemon?.isPlayer() ? c.roster.entries.find(e => e.pokemon === p.pokemon)?.owner : null;
    phaseScopes.set(p, scope);
    if (p instanceof SummonPhase && (p as any).player) (p as any).partyMemberIndex = 0;
    p.scene = scope === null ? root : views[scope];
    return scope;
  }
  for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue']) {
    root[key] = c.continuation[key].map(d => {
      const scope = phases.capture(d.phase, c).scope; bindPhase(d.phase, scope);
      ids.set(d.phase, d.phaseId); nextId = Math.max(nextId, d.phaseId + 1); return d.phase;
    });
  }
  root.phaseQueuePrependSpliceIndex = c.continuation.phaseQueuePrependSpliceIndex;
  root.currentPhase = null; root.standbyPhase = null;
  if (c.continuation.currentPhase?.kind === 'original-phase') {
    const p = c.continuation.currentPhase.phase;
    // A selected descriptor has already left the queues. Its persisted owner
    // still takes precedence over local party fieldIndex (both owners use 0).
    bindPhase(p, phases.capture(p, c).scope);
    ids.set(p, c.continuation.currentPhase.phaseId);
    nextId = Math.max(nextId, c.continuation.currentPhase.phaseId + 1);
  }
  function validateTrainerReward(p) {
    const type = p.modifierType;
    const candidates=(c.battle.trainer?.config.modifierRewardFuncs??[]).map(factory=>factory());
    // Ask the original aftermath to declare milestone rewards. Never copy its
    // wave/offsetGym formulas or run experience, loot, or the queued phases.
    const declaration=Object.create(root);
    declaration.currentBattle=Object.assign(Object.create(Object.getPrototypeOf(c.battle)),c.battle);
    declaration.pushPhase=phase=>{if(Object.getPrototypeOf(phase)===ModifierRewardPhase.prototype)candidates.push((phase as any).modifierType);};
    const aftermath=new VictoryPhase(declaration,2);aftermath.end=()=>{};aftermath.queueAftermath();
    check(Object.getPrototypeOf(p) === ModifierRewardPhase.prototype && preparationItemTarget(type) === 'none'
      && isPreparationPersistent(type.newModifier()) && candidates.some(candidate =>
        canonical(captureModifierTypeState(candidate)) === canonical(captureModifierTypeState(type))),
    'UNSUPPORTED_NATIVE_TRAINER_REWARD');
  }
  function sync() {
    if (c.battle && root.currentBattle !== c.battle) c.roster.retiredIds.push(...c.battle.enemyParty.map(p => p.id));
    c.battle = root.currentBattle; c.enemyModifiers = root.enemyModifiers;c.arena=root.arena;
    c.roster.entries = parties.flatMap((party, owner) => party.map((pokemon, index) => ({ owner, group: 'party', index, pokemon })))
      .concat(c.roster.entries.filter(e => e.owner !== null && e.group === 'reserve')).concat((root.currentBattle?.enemyParty ?? [])
      .map((pokemon, index) => ({ owner: null, group: 'enemy', index, pokemon })));
    c.roster.field = root.getField().map((p, slot) => p && !(p as any).__coopCaptured && (root.field.getIndex(p) >= 0
      || p.isFainted() && c.roster.field[slot] === p.id) ? p.id : null);
    for (const key of ['seed', 'waveSeed', 'waveCycleOffset', 'offsetGym', 'score']) c.scene[key] = root[key];
    if (Object.prototype.hasOwnProperty.call(root, 'lastEnemyTrainer')) c.scene.lastEnemyTrainer = root.lastEnemyTrainer;
    for (const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue']) root[key] = root[key].flatMap(p => {
      if (p instanceof ModifierRewardPhase) {
        validateTrainerReward(p);
        if (views.includes((p as any).scene)) return [p];
        check(root.phaseQueuePrependSpliceIndex === -1,'UNSAFE_TRAINER_REWARD_QUEUE_SPLIT');
        const type = captureModifierTypeState((p as any).modifierType);
        // Fixed trainer progression rewards belong to each personal party.
        // Persist one owned original phase per seat; recovery never reruns the
        // trainer victory or copies the already completed seat's grant.
        return views.map(view => new ModifierRewardPhase(view, () => restoreModifierTypeState(type)));
      }
      if (!(p instanceof MoneyRewardPhase) || views.includes((p as any).scene)) return [p];
      check(c.battle.battleType === BattleType.TRAINER
        && (p as any).moneyMultiplier === c.battle.trainer.config.moneyMultiplier,'UNSUPPORTED_NATIVE_MONEY_REWARD');
      check(root.phaseQueuePrependSpliceIndex === -1,'UNSAFE_MONEY_QUEUE_SPLIT');
      // One original award becomes two owned original phases. Their persisted
      // scopes prevent either share from being reapplied after restoration.
      return views.map(view => new MoneyRewardPhase(view,(p as any).moneyMultiplier));
    });
    for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue']) c.continuation[key] = root[key].map(p => {
      const scope = bindPhase(p);
      try { phases.capture(p, c, scope); }
      catch(error){error.stack+=`\nNATIVE_QUEUED_PHASE ${p.constructor.name} battlerIndex=${(p as any).battlerIndex} fieldIndex=${(p as any).fieldIndex}`;throw error;}
      if (!ids.has(p)) ids.set(p, nextId++);
      return { kind: 'original-phase', phaseId: ids.get(p), phase: p, remaining: 'start' };
    });
    c.continuation.phaseQueuePrependSpliceIndex = root.phaseQueuePrependSpliceIndex;
  }
  return { root, views, events, intents, bindPhase, sync,
    async drainTasks() {
      const results = await Promise.allSettled(trackers.map(tracker => tracker.drain()));
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    },
    async execute(p, resume?) {
      // Provenance is phase-local; warming a Worker or evicting an older name
      // must not change event metadata after a checkpoint restart. Queued
      // MessagePhase metadata travels with its existing display-only fields.
      resetPresentationText();
      for(const entry of c.roster.entries)entry.pokemon.generateName?.();
      messageHasPages=p instanceof MessagePhase&&(p as any).text?.includes('$');
      ended = 0; waiting = null;
      const completed = new Promise<void>(resolve => { completePhase = resolve; });
      let captureSeat: number | null = null, captureParty: Pokemon[] | null = null;
      let captureTarget: any = null, captureTargetScene: any = null;
      let captureBallCount: number | null = null;
      let priorParty: Set<Pokemon> | null = null;
      let cancelCapture = false;
      const captureChecks=[];
      const captureEventIndex=events.length;
      if (p instanceof AttemptCapturePhase) {
        captureSeat = views.indexOf((p as any).scene);
        check(captureSeat === 0 || captureSeat === 1, 'INVALID_CAPTURE_OWNER');
        const command = c.battle.turnCommands[captureSeat];
        captureTarget = (p as any).getPokemon?.();
        check(command?.command === Command.BALL && command.cursor === (p as any).pokeballType
          && Number.isSafeInteger((p as any).coopTargetId), 'INVALID_CAPTURE_TARGET');
        cancelCapture = (p as any).coopTargetId !== captureTarget?.id;
        check(parties[captureSeat].length <= 6, 'PERSONAL_PARTY_LIMIT');
        check(!c.roster.entries.some(e => e.owner === captureSeat && e.group === 'reserve'), 'LEGACY_RESERVE_REQUIRES_REVIEW');
        priorParty = new Set(parties[captureSeat]);
        captureParty = [];
        if (resume) (p as any).pokeball = new DisplayTarget();
        // addPlayerPokemon calculates a personal Pokemon; its scene must be the
        // seat view so modifier ownership is unambiguous.
        captureTargetScene = captureTarget?.scene;
        if (captureTarget) captureTarget.scene = views[captureSeat];
        root.pokeballCounts = c.players[captureSeat].pokeballCounts;
        captureBallCount = root.pokeballCounts[(p as any).pokeballType];
      }
      const scope = bindPhase(p); root.currentPhase = p;
      if (p instanceof ModifierRewardPhase) {
        check(scope === 0 || scope === 1,'INVALID_TRAINER_REWARD_SCOPE');
        validateTrainerReward(p);
      }
      if (p instanceof MoneyRewardPhase) check((scope === 0 || scope === 1)
        && c.battle.battleType === BattleType.TRAINER
        && (p as any).moneyMultiplier === c.battle.trainer.config.moneyMultiplier,'INVALID_TRAINER_MONEY_SCOPE');
      const changes = [];
      const patch = (object, key, value) => { changes.push([object, key, Object.getOwnPropertyDescriptor(object, key)]);
        Object.defineProperty(object, key, { value, writable: true, configurable: true }); };
      if(p instanceof QuietFormChangePhase){
        patch(p,'playFormChangeAnimation',function(changeForm,onComplete){
          observeRulePromise(root,changeForm().then(()=>{
            const pokemon=this.pokemon;
            events.push({kind:'form-change',scope:'shared',pokemonId:pokemon.id,view:root.nativePublicPokemon(pokemon)});
            onComplete();
          }));
        });
      }
      if(p instanceof AttemptCapturePhase&&!resume){
        const play=p.playCaptureAnimation;
        patch(p,'playCaptureAnimation',function(pokemon,checkCapture){
          return play.call(this,pokemon,count=>{const result=checkCapture(count);captureChecks.push({...result});return result;});
        });
      }
      if (p instanceof ModifierRewardPhase) {
        const reward = p.doReward;
        patch(p,'doReward',() => observeRulePromise((p as any).scene,reward.call(p)));
      }
      if (p instanceof MoneyRewardPhase) patch((p as any).scene,'getWaveMoneyAmount',multiplier => {
        const total = BattleScene.prototype.getWaveMoneyAmount.call(root,multiplier);
        check(Number.isSafeInteger(total) && total >= 0 && total % 2 === 0,'INVALID_TRAINER_MONEY_TOTAL');
        return total / 2;
      });
      if (p instanceof SwitchPhase) {
        const battle = Object.create(c.battle); battle.getBattlerCount = () => 1;
        patch((p as any).scene, 'currentBattle', battle);
      }
      if (p instanceof SwitchSummonPhase && (p as any).player) {
        (p as any).fieldIndex = scope;
        const swap = SwitchSummonPhase.prototype.switchAndSummon;
        const summon = SummonPhase.prototype.summon;
        patch(p, 'switchAndSummon', function () {
          this.fieldIndex = 0;
          try { return swap.call(this); } finally { this.fieldIndex = scope; }
        });
        patch(p, 'summon', function () {
          const fieldIndex = this.fieldIndex; this.fieldIndex = scope;
          try { return summon.call(this); } finally { this.fieldIndex = fieldIndex; }
        });
      }
      const creating = p instanceof NewBattlePhase || p instanceof EncounterPhase
        || p instanceof SelectBiomePhase || p instanceof SwitchBiomePhase || p instanceof PartyHealPhase;
      if (creating) check(c.players.every(player => player.modifiers.every(isPreparationPersistent)), 'UNSUPPORTED_NATIVE_ENCOUNTER_PLAYER_MODIFIERS');
      // Encounter constructs a new enemy list before sync. Original Pokemon
      // methods still use their personal scenes; enemy generation uses root.
      const disposeModifiers = creating ? () => {} : bindCoopModifierScope(c, root, views, p);
      const disposeFaint = p instanceof FaintPhase ? bindCoopFaint(p, c) : () => {};
      const disposeEnding=p instanceof GameOverPhase?bindCoopGameOver(p,()=>{
        check((p as any).victory===true&&c.battle.gameMode.isClassic&&c.battle.gameMode.isWaveFinal(c.battle.waveIndex)
          &&c.battle.battleType===BattleType.CLEAR&&c.battle.battleSpec===BattleSpec.FINAL_BOSS
          &&c.battle.enemyParty.every(pokemon=>pokemon.isFainted(true))&&!partyWiped(c),'INVALID_COOP_VICTORY');
        // Declare unlock candidates using the original method, but defer the
        // per-profile transaction (including first-clear vs repeat rewards).
        for(const owner of [0,1]){
          const unlocks=[];
          const declaration=Object.create(views[owner]);
          declaration.unshiftPhase=phase=>{check(phase instanceof UnlockPhase,'INVALID_CLEAR_UNLOCK');unlocks.push((phase as any).unlockable);};
          GameOverPhase.prototype.handleUnlocks.call({scene:declaration,victory:true} as any);
          intents.push({kind:'completion-pending',owner,waveIndex:c.battle.waveIndex,mode:c.battle.gameMode.modeId,
            achievementId:achvs.CLASSIC_VICTORY.id,unlockCandidates:unlocks,sessionsWon:1,resolve:'original-personal-clear'});
          const voucher=vouchers[achvs.CLASSIC_VICTORY.id];check(voucher,'ORIGINAL_CLEAR_VOUCHER_UNAVAILABLE');
          intents.push({kind:'voucher-pending',owner,id:voucher.id,voucherType:voucher.voucherType,count:1,
            fallbackCatalogId:'VOUCHER_PREMIUM',resolve:'original-unlock-or-repeat'});
        }
        for(const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'])root[key]=[];
        root.phaseQueuePrependSpliceIndex=-1;
        events.push({kind:'run-ended',scope:'shared',victory:true,reason:'victory'});
        Phase.prototype.end.call(p);
      }):()=>{};
      const oldExperience = p.queueExperience;
      if (p instanceof VictoryPhase) {
        check(c.roster.entries.some(e => e.owner !== null && !e.pokemon.isFainted()), 'UNCONFIRMED_SIMULTANEOUS_WIPE');
        p.queueExperience = function () {
          const host = this.scene, value = this.getPokemon().getExpValue();
          try {
            for (const scene of views) { this.scene = scene; VictoryPhase.prototype.queueExperience.call(this, value); }
          } finally { this.scene = host; }
        };
      }
      if (p instanceof EggLapsePhase) {
        check(c.eggState, 'EGG_INVENTORY_REQUIRED');
        for (const seat of [0, 1]) views[seat].gameData.eggs = c.eggState.players[seat];
      }
      try { await withOriginalRules(c, async () => {
        let failure;
        events.push({ kind: resume ? 'phase-resume' : 'phase-start', phase: p.constructor.name });
        try {
          if (cancelCapture) {
            events.push({ kind: 'capture-cancelled', reason: 'target-left', pokemonId: (p as any).coopTargetId });
            p.end();
          } else if (resume) resume();
          else if (p instanceof SwitchSummonPhase && !(p as any).player && (p as any).slotIndex === -1
            && !c.battle.enemyParty.slice(c.battle.getBattlerCount()).some(pokemon => !pokemon.isFainted()
              && (!c.battle.trainer.isDouble() || pokemon.trainerSlot === (!(p as any).fieldIndex ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER)))) {
            // Both faints can queue a replacement before either consumes the
            // final reserve. Do not run a second summon/ability for a dead slot.
            events.push({kind:'enemy-switch-cancelled',reason:'no-reserve',fieldIndex:(p as any).fieldIndex});
            Phase.prototype.end.call(p);
          }
          else if (p instanceof SummonMissingPhase && (p as any).player) {
            const party = parties[scope];
            if (!party.some(pokemon => !pokemon.isFainted())) Phase.prototype.end.call(p);
            else if (party[0].isFainted()) SummonPhase.prototype.preSummon.call(p);
            else p.start();
          }
          else if (p instanceof SwitchPhase) {
            const seat = (p as any).fieldIndex; (p as any).fieldIndex = 0;
            try { p.start(); } finally { (p as any).fieldIndex = seat; }
          } else if (p instanceof EggLapsePhase) {
            // Same original phase once per personal inventory, in the room's
            // established order. Its original hatch phases retain their owner.
            for (const scene of views) { ended = 0; new EggLapsePhase(scene).start(); }
          } else p.start();
        } catch (error) { failure = error; }
        let idle = 0;
        for (let budget = 0; budget < 10000; budget++) {
          await Promise.resolve();
          if (callbacks.length) {
            callbacks.sort((a, b) => a.tick - b.tick || a.order - b.order);
            const next = callbacks.shift(); tick = next.tick;
            try { next.callback(); } catch (error) { failure ??= error; }
            idle = 0;
          } else if (trackers.every(t => t.pendingTasks === 0)) {
            if (++idle >= 16) break;
          } else await new Promise(resolve => setImmediate(resolve));
          check(budget < 9999, 'NATIVE_CALLBACK_BUDGET_EXCEEDED');
        }
        // The original off-field EXP phase ends after its 500ms display timer.
        // Await that boundary; do not replace addExp or skip the original phase.
        if (!failure && p instanceof ShowPartyExpBarPhase) await completed;
        const settled = await Promise.allSettled(trackers.map(t => t.drain()));
        const failed = settled.find(r => r.status === 'rejected');
        if (failure) throw failure;
        if (failed?.status === 'rejected') throw failed.reason;
        if (p instanceof BattleEndPhase && c.battle.enemyParty.length > 0
          && c.battle.enemyParty.every(pokemon => pokemon.isFainted(true))) events.push(...recoverVictoryParties(c, pokemon => {
          const revive = modifierTypes.REVIVE().newModifier(pokemon);
          check(revive.shouldApply([pokemon]), 'REVIVE_NOT_APPLICABLE');
          return revive.apply([pokemon]);
        }));
      }); } finally {
        if (p instanceof VictoryPhase) {
          if (Object.prototype.hasOwnProperty.call(p, 'queueExperience')) delete p.queueExperience;
          check(p.queueExperience === oldExperience, 'INVALID_NATIVE_VICTORY_BINDING');
        }
        disposeEnding(); disposeFaint(); disposeModifiers();
        if (captureTarget) captureTarget.scene = captureTargetScene;
        for (const [object, key, descriptor] of changes.reverse()) {
          if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key];
        }
      }
      if (priorParty) captureParty = parties[captureSeat!].filter(pokemon => !priorParty!.has(pokemon));
      if (p instanceof AttemptCapturePhase && captureTarget) {
        for (const intent of intents) if (['capture-pending', 'dex-ivs'].includes(intent.kind)) {
          intent.owner = captureSeat; intent.sourcePokemonId = captureTarget.id;
          intent.pokemonId ??= captureTarget.id;
        }
      }
      if (captureParty?.length) {
        // EnemyPokemon.addToParty copies the wild instance id as its dataSource
        // id. In co-op the wild roster entry is still present until the original
        // Victory phase finishes, so give the new individual a fresh stable id
        // without consuming rule RNG or dropping any converted fields.
        const used = new Set<number>(c.roster.entries.map(entry => entry.pokemon.id as number).concat(c.roster.retiredIds));
        let nextId = 0;
        if (!intents.some(i => i.kind === 'capture-pending')) {
          await views[captureSeat!].gameData.setPokemonCaught(captureTarget);
          views[captureSeat!].gameData.updateSpeciesDexIvs(captureTarget.species.speciesId, captureTarget.ivs);
        }
        for (const pokemon of captureParty) {
          while (used.has(nextId)) nextId++;
          pokemon.id = nextId; used.add(nextId); nextId++;
          for (const intent of intents) {
            if ((intent.kind === 'capture-pending' && intent.pokemonId === captureTarget.id)
              || (intent.kind === 'dex-ivs' && intent.speciesId === pokemon.species.speciesId
                && (intent.pokemonId === undefined || intent.pokemonId === captureTarget.id))) {
              intent.owner = captureSeat;
              intent.sourcePokemonId = captureTarget.id;
              intent.pokemonId = pokemon.id;
              if (intent.kind === 'capture-pending') intent.pokemon = capturePokemonState(pokemon);
            }
          }
        }
      }
      if (captureTarget && !cancelCapture && ended === 1 && captureTarget.hp === 0) {
        {
          (captureTarget as any).__coopCaptured = true;
          // Its queued action no longer has a field owner. Keep the next
          // per-phase checkpoint valid, rather than relying on TurnEnd to clear it.
          c.battle.turnCommands[(p as any).battlerIndex] = null;
          const fieldIndex = root.field.getIndex(captureTarget);
          if (fieldIndex >= 0) root.field.list.splice(fieldIndex, 1);
        }
        // A successful capture ends the encounter; any already queued player or
        // enemy MovePhase still references the removed wild instance. Drop those
        // stale action phases after the original capture has already won.
        for (const queue of [root.phaseQueue, root.phaseQueuePrepend])
          for (let index = queue.length - 1; index >= 0; index--)
            if (queue[index] instanceof MovePhase) queue.splice(index, 1);
      }
      if (p instanceof AttemptCapturePhase && !resume && captureSeat !== null) {
        // Report what the original phase actually did. This port never rolls
        // capture RNG, changes inventory, or grants an additional individual.
        const spent = captureBallCount! - c.players[captureSeat].pokeballCounts[(p as any).pokeballType];
        check(spent === 0 || spent === 1, 'INVALID_CAPTURE_CONSUMPTION');
        if(spent===1)events.splice(captureEventIndex+1,0,{kind:'capture-animation',scope:'shared',seat:captureSeat,
          targetId:(p as any).coopTargetId,pokeballType:(p as any).pokeballType,checks:captureChecks});
        events.push({ kind: 'capture-result', seat: captureSeat,
          targetId: (p as any).coopTargetId, pokeballType: (p as any).pokeballType,
          outcome: spent === 0 ? 'cancelled' : waiting === 'capture-select' || captureTarget?.hp === 0 ? 'caught' : 'failed' });
      }
      check(ended === 1 || ended === 0 && waiting, 'INCOMPLETE_NATIVE_PHASE');
      if(partyWiped(c)){
        for(const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'])root[key]=[];
        root.phaseQueuePrependSpliceIndex=-1;
        events.push({kind:'run-ended',scope:'shared',victory:false,reason:'defeat'});
      }
      root.currentPhase = null; sync();
      if (waiting) return { completed: false, suspended: true, pendingTasks: 0, events: [...events], grants: [] };
      return { completed: true, pendingTasks: 0, events: [...events], grants: [] };
    },
    dispose() {
      for (const [pokemon, descriptor] of pokemonUpdates) {
        if (descriptor) Object.defineProperty(pokemon, 'updateInfo', descriptor); else delete (pokemon as any).updateInfo;
      }
      disposePorts.forEach(fn => fn()); trackers.forEach(t => t.close());
    }
  };
}

function actionDecision(c, root, id) {
  const saved = c.battle.captureRandomState();
  try {
    const seats = [0, 1].filter(seat => {
      const pokemon = root.getPlayerField()[seat];
      return pokemon && pokemon.isActive(true) && pokemon.hp > 0;
    });
    const options = withOriginalRules({ ...c, sceneRandom: new SceneRandom(c.sceneRandom.capture()) }, () => Object.fromEntries(seats.map(seat => {
      const pokemon = root.getPlayerField()[seat];
      const switchOptions = c.roster.entries.filter(e => e.owner === seat && e.group === 'party'
        && e.index > 0 && e.pokemon.hp > 0 && !c.roster.field.includes(e.pokemon.id))
        .sort((a, b) => a.index - b.index).map(e => ({ kind: 'switch', pokemonId: e.pokemon.id }));
      const activeEnemies = root.getEnemyField().filter((enemy: any) => enemy.isActive(true));
      const captureOptions = !hasLegacyCaptures(c, seat) && activeEnemies.length === 1 && c.battle.battleType !== BattleType.TRAINER
        && c.arena.biomeType !== Biome.END && !(activeEnemies[0].isBoss() && activeEnemies[0].bossSegmentIndex >= 1)
        && !c.enemyModifiers.some(m => m instanceof PokemonHeldItemModifier && m.pokemonId === activeEnemies[0].id)
        ? Object.values(PokeballType).filter(value => Number.isInteger(value) && Number(value) < 5)
          .filter(ball => (c.players[seat].pokeballCounts[ball] ?? 0) > 0)
          .map(ball => ({ kind: 'ball', pokeballType: ball, targetId: activeEnemies[0].id }))
        : [];
      const hasUsableMove = pokemon.getMoveset().some(move => move.isUsable(pokemon));
      return [seat, [
        ...pokemon.getMoveset().flatMap((move, cursor) => {
          if (hasUsableMove && !move.isUsable(pokemon)) return [];
          // Original CommandPhase selects Struggle when no move is usable.
          // Keep a legal original cursor; never synthesize a rule command here.
          const targets = getMoveTargets(pokemon, hasUsableMove ? move.moveId : Moves.STRUGGLE);
          return (targets.targets.length > 1 && !targets.multiple ? targets.targets : [null]).map(target => {
            const intent = { kind: 'fight', pokemonId: pokemon.id, cursor, target };
            resolveFightIntent(pokemon, seat, intent, { fightCommand: Command.FIGHT, noneMove: Moves.NONE,
              struggleMove: Moves.STRUGGLE, getMoveTargets, getEncoreTag: p => p.getTag(EncoreTag) });
            return intent;
          });
        }),
        ...switchOptions,
        ...captureOptions,
      ]];
    })));
    return { id, kind: 'wait-actions', requiredSeats: seats, options };
  } finally { c.battle.restoreRandomState(saved); }
}

export async function openNativeBattle(runtime, payload) {
  check(payload && ['parties', 'eggState,parties', 'identities,parties', 'eggState,identities,parties']
    .includes(Object.keys(payload).sort().join(',')) && Array.isArray(payload.parties) && payload.parties.length === 2
    && payload.parties.every(p => Array.isArray(p) && p.length === 3), 'INVALID_NATIVE_PARTIES');
  if (Object.prototype.hasOwnProperty.call(payload, 'identities')) {
    check(Array.isArray(payload.identities) && payload.identities.length === 2
      && payload.identities.every(identity => identity && Number.isInteger(identity.trainerId)
        && identity.trainerId >= 0 && identity.trainerId < 65536 && Number.isInteger(identity.secretId)
        && identity.secretId >= 0 && identity.secretId < 65536), 'INVALID_TRAINER_IDENTITY');
  }
  const fork = createOriginalRuntime(runtime.scene.seed, runtime.scene.gameData, runtime.context.sceneRandom.capture());
  const root: any = fork.scene; root.initializeRunResources();
  const entries = payload.parties.flatMap((party, owner) => party.map((id, index) => {
    if (payload.identities) {
      root.gameData.trainerId = payload.identities[owner].trainerId;
      root.gameData.secretId = payload.identities[owner].secretId;
    }
    return { owner, group: 'party', index, pokemon: constructOriginalPokemon(fork, id, root.gameMode.getStartingLevel()) };
  }));
  if (payload.identities) {
    root.gameData.trainerId = payload.identities[0].trainerId;
    root.gameData.secretId = payload.identities[0].secretId;
  }
  const c: any = { ...fork.context, roster: { entries, field: [null, null, null, null], retiredIds: [] }, battle: null, arena: root.arena,
    scene: { seed: root.seed, waveSeed: root.waveSeed, waveCycleOffset: root.waveCycleOffset, offsetGym: root.offsetGym, score: 0, gameMode: root.gameMode },
    players: [0, 1].map(() => ({ money: root.money, pokeballCounts: structuredClone(root.pokeballCounts), modifiers: [] })),
    enemyModifiers: [], decision: { id: 'native-1-0', kind: 'continuing', requiredSeats: [], reason: 'effects' },
    pendingEffects: [], continuation: emptyContinuation() };
  if (Object.prototype.hasOwnProperty.call(payload, 'eggState')) c.eggState = originalOwnedEggStateCodec.restore(payload.eggState);
  const binding = bindNativeScene(c, runtime.scene.gameData);
  try {
    await binding.execute(new NewBattlePhase(binding.root));
    await binding.execute(new EncounterPhase(binding.root));
    return { checkpoint: codec.capture(c), events: binding.events, intents: binding.intents };
  } finally { binding.dispose(); }
}

// Selected-entry counterpart of openNativeBattle. It consumes the complete v2
// starter descriptions (not species IDs), binds each owner's trainer identity,
// and runs the same NewBattle/Encounter phases as the numeric fixture.
export async function openNativeSelectedBattle(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'eggState,identities,starterSelections',
    'INVALID_NATIVE_SELECTED_ENTRY');
  check(Array.isArray(payload.identities) && payload.identities.length === 2
    && payload.identities.every(identity => identity && !Array.isArray(identity)
      && Object.keys(identity).sort().join(',') === 'secretId,trainerId' && Number.isInteger(identity.trainerId)
      && identity.trainerId >= 0 && identity.trainerId < 65536 && Number.isInteger(identity.secretId)
      && identity.secretId >= 0 && identity.secretId < 65536), 'INVALID_TRAINER_IDENTITY');
  check(Array.isArray(payload.starterSelections) && payload.starterSelections.length === 2
    && payload.starterSelections.every(party => Array.isArray(party) && party.length >= 1 && party.length <= 6),
    'INVALID_STARTER_SELECTION');
  // Validate every description before touching a candidate runtime.
  const selections = payload.starterSelections.map(party => party.map(selection => restoreStarterSelection(selection)));
  check(selections.every(party => new Set(party.map(selection => selection.species.speciesId)).size === party.length),
    'INVALID_STARTER_SELECTION');
  const eggState = originalOwnedEggStateCodec.restore(payload.eggState);
  check(eggState && Array.isArray(eggState.players) && eggState.players.length === 2
    && eggState.players.every(player => player === null || Array.isArray(player)), 'INVALID_EGG_STATE');

  const fork = createOriginalRuntime(runtime.scene.seed, runtime.scene.gameData, runtime.context.sceneRandom.capture());
  const root: any = fork.scene; root.initializeRunResources();
  root.money = root.gameMode.getStartingMoney();
  const entries = withOriginalRules(fork.context, () => selections.flatMap((party, owner) =>
    party.map((selection, index) => {
      root.gameData.trainerId = payload.identities[owner].trainerId;
      root.gameData.secretId = payload.identities[owner].secretId;
      return { owner, group: 'party', index, pokemon: constructSelectedStarterInstance(fork, selection) };
    })));
  root.gameData.trainerId = payload.identities[0].trainerId;
  root.gameData.secretId = payload.identities[0].secretId;
  const c: any = { ...fork.context, roster: { entries, field: [null, null, null, null], retiredIds: [] }, battle: null, arena: root.arena,
    scene: { seed: root.seed, waveSeed: root.waveSeed, waveCycleOffset: root.waveCycleOffset, offsetGym: root.offsetGym, score: 0, gameMode: root.gameMode },
    players: [0, 1].map(() => ({ money: root.money, pokeballCounts: structuredClone(root.pokeballCounts), modifiers: [] })),
    enemyModifiers: [], decision: { id: 'native-1-0', kind: 'continuing', requiredSeats: [], reason: 'effects' },
    pendingEffects: [], continuation: emptyContinuation(), eggState };
  const binding = bindNativeScene(c, runtime.scene.gameData);
  try {
    await binding.execute(new NewBattlePhase(binding.root));
    await binding.execute(new EncounterPhase(binding.root));
    return { checkpoint: codec.capture(c), events: binding.events, intents: binding.intents };
  } finally { binding.dispose(); }
}

export async function stepNativeEntry(runtime, checkpoint) {
  const input = codec.restore(checkpoint);
  let intents = [];
  const result = await advanceQueuedRulePhase(input, codec, {
    supports: (_c, p) => supportsPhase(p),
    async execute(c, p) {
      const binding = bindNativeScene(c, runtime.scene.gameData);
      if (p instanceof EvolutionPhase) {
        binding.bindPhase(p); binding.dispose();
        return {completed:false, suspended:true, pendingTasks:0, events:[], grants:[]};
      }
      try { const result = await binding.execute(p); intents = binding.intents; return result; }
      finally { binding.dispose(); }
    },
    suspendBoundary(c, p, id) {
      if (p instanceof EvolutionPhase) return evolutionBoundary(c, p, id);
      return { remaining: switchKind(p), decision: switchDecision(id, c, p) };
    },
    finishBoundary(c, p, id) {
      if(partyWiped(c))return defeatDecision(id);
      if(p instanceof GameOverPhase)return victoryDecision(id);
      const front=c.continuation.phaseQueuePrepend.at(-1)??c.continuation.phaseQueue[0];
      if(front?.phase instanceof NewBattlePhase)return {id,kind:'continuing',requiredSeats:[],reason:'next-battle'};
      if (!c.continuation.phaseQueue.length && !c.continuation.phaseQueuePrepend.length)
        populatePhaseQueue(c.continuation, () => ({ kind: 'original-phase', phaseId: Math.max(-1, ...c.continuation.nextCommandPhaseQueue.map(d => d.phaseId)) + 1,
          phase: new TurnInitPhase(undefined), remaining: 'start' }));
      if (!(p instanceof TurnInitPhase)) return { id, kind: 'continuing', requiredSeats: [], reason: 'effects' };
      const binding = bindNativeScene(c, runtime.scene.gameData);
      try { return actionDecision(c, binding.root, id); }
      finally { binding.dispose(); }
    }
  }, { decisionId: nextNativeDecisionId(input) });
  return { checkpoint: codec.capture(result.context), events: result.events, intents };
}

// Continuous original queue execution, without restoring Pokemon/Battle/Arena
// between phases. Recovery executes the same bodies via native-step instead.
// Learning is a personal one-seat decision. The phase remains the original
// suspended LearnMovePhase; only the confirmed forget branch or cancel end is
// resumed, then the normal queue continues.
function progressionContext(c, seat) {
  const d = c.decision, current = c.continuation.currentPhase, phase = current?.phase;
  if (d.kind === 'evolution') {
    check(d.requiredSeats.length === 1 && d.requiredSeats[0] === seat && phase instanceof EvolutionPhase
      && current?.kind === 'original-phase' && c.continuation.standbyPhase === null
      && current.remaining === (d.stage === 'pause-confirm' ? 'evolution-pause' : 'evolution-apply')
      && phases.capture(phase,c).scope === seat && (phase as any).pokemon.id === d.pokemonId
      && canonical(evolutionReferenceCodec.capture((phase as any).evolution)) === canonical(d.reference)
      && (phase as any).lastLevel === d.lastLevel, 'INVALID_PROGRESSION_PHASE');
    return {d,current,phase,party:null};
  }
  check(d.kind === 'learn-move' && d.requiredSeats.length === 1 && d.requiredSeats[0] === seat
    && current?.kind === 'original-phase' && current.remaining === 'learn-apply'
    && c.continuation.standbyPhase === null && phase instanceof LearnMovePhase
    && phases.capture(phase, c).scope === seat, 'INVALID_PROGRESSION_PHASE');
  const party = c.roster.entries.filter(entry => entry.owner === seat && entry.group === 'party')
    .sort((a, b) => a.index - b.index);
  check(party[(phase as any).partyMemberIndex]?.pokemon.id === d.learn.pokemonId
    && (phase as any).moveId === d.learn.moveId, 'INVALID_PROGRESSION_PHASE');
  return { d, current, phase, party };
}

export function validateNativeProgression(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'action,checkpoint,seat', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  const { d, phase } = progressionContext(c, payload.seat);
  codec.validateAction(c, payload.seat, payload.action);
  if (d.kind === 'learn-move') check((phase as any).moveId === d.learn.moveId, 'INVALID_PROGRESSION_PHASE');
  return true;
}

export async function chooseNativeProgression(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'action,checkpoint,seat', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  const seat = payload.seat;
  progressionContext(c, seat);
  const intents=[];
  const result = await advanceProgressionChoice(c, { [seat]: payload.action }, codec, originalSafeDecisionCodec, nativeProgressionDriver(runtime,intents),
    { decisionId: nextSafeDecisionId(c.decision.id) });
  return { checkpoint: codec.capture(result.context), events: result.events, intents };
}

function nativeProgressionDriver(runtime, intents=[]) {
  return {
    async resumeLearning(candidate, phase, { action }) {
      const binding = bindNativeScene(candidate, runtime.scene.gameData);
      try {
        if (action.slot === null) return await binding.execute(phase, () => phase.end());
        return await binding.execute(phase, () => phase.forgetMove(action.slot, Mode.MESSAGE));
      } finally { binding.dispose(); }
    },
    async resumeEvolution(candidate, phase, {seat, cancelled}) {
      const binding = bindNativeScene(candidate,runtime.scene.gameData), pokemon = (phase as any).pokemon;
      const before = capturePokemonState(pokemon);
      try {
        const result = await binding.execute(phase, () => observeRulePromise(phase.scene, (async () => {
          if (!cancelled) await (phase as any).applyEvolution();
          phase.end();
        })()));
        if (!cancelled) result.events.push({kind:'evolution-display', scope:seat, pokemonId:pokemon.id,
          before, after:capturePokemonState(pokemon)});
        // Original collection hooks stay deferred and follow the same durable
        // candidate transaction as the evolved rule state.
        intents.push(...binding.intents);
        return result;
      } finally { binding.dispose(); }
    },
    async stageEvolutionPause(candidate, phase) {
      const binding = bindNativeScene(candidate,runtime.scene.gameData);
      try {
        withOriginalRules(candidate, () => (phase as any).queueEndEvolution());
        binding.sync();
        return {completed:false,suspended:true,pendingTasks:0,events:[],grants:[]};
      } finally { binding.dispose(); }
    },
  };
}

function evolutionBoundary(c, p, id) {
  const seat = phases.capture(p,c).scope;
  check(seat === 0 || seat === 1,'INVALID_EVOLUTION_OWNER');
  return {remaining:'evolution-apply',decision:{id,kind:'evolution',requiredSeats:[seat],pokemonId:(p as any).pokemon.id,
    reference:evolutionReferenceCodec.capture((p as any).evolution),lastLevel:(p as any).lastLevel,stage:'evolve-or-cancel'}};
}

function nativePreparationGrowthDriver(runtime,intents) {
  return {...nativeProgressionDriver(runtime,intents),
    supports:(_c,p)=>[LevelUpPhase,LearnMovePhase,EvolutionPhase,EndEvolutionPhase].some(ctor=>Object.getPrototypeOf(p)===ctor.prototype),
    async execute(c,p) {
      const binding=bindNativeScene(c,runtime.scene.gameData);
      try {
        const seat=binding.bindPhase(p);
        if (p instanceof EvolutionPhase || p instanceof LearnMovePhase
          && inspectLearnMove(binding.views[seat].getParty()[(p as any).partyMemberIndex],(p as any).moveId).kind==='choose') {
          phases.capture(p,c,seat);
          return {completed:false,suspended:true,pendingTasks:0,events:[],grants:[]};
        }
        const result=await binding.execute(p);intents.push(...binding.intents);return result;
      } finally {binding.dispose();}
    },
    suspendBoundary(c,p,id) {
      if (p instanceof EvolutionPhase) return evolutionBoundary(c,p,id);
      const seat=phases.capture(p,c).scope;
      const pokemon=c.roster.entries.find(e=>e.owner===seat&&e.group==='party'&&e.index===(p as any).partyMemberIndex).pokemon;
      return {remaining:'learn-apply',decision:createLearnDecision(id,c,seat,pokemon.id,(p as any).moveId,id=>!!allMoves[id])};
    },
    finishBoundary:(_c,_p,id)=>({id,kind:'continuing',requiredSeats:[],reason:'effects'}),
  };
}

export async function runNativeUntilBoundary(runtime, checkpoint) {
  const c = codec.restore(checkpoint);
  check(c.decision.kind === 'continuing' && c.decision.reason === 'effects'
    && !c.continuation.currentPhase && !c.continuation.standbyPhase, 'UNSAFE_NATIVE_CONTINUATION');
  const binding = bindNativeScene(c, runtime.scene.gameData);
  try {
    for (let index = 0; index < 500; index++) {
      const next = binding.root.phaseQueuePrepend.at(-1) ?? binding.root.phaseQueue[0];
      if (next instanceof SelectModifierPhase) return { checkpoint: codec.capture(c), events: binding.events, intents: binding.intents };
      if(next instanceof NewBattlePhase){c.decision={...c.decision,reason:'next-battle'};return {checkpoint:codec.capture(c),events:binding.events,intents:binding.intents};}
      const p = selectNextPhase(binding.root, () => populatePhaseQueue(binding.root, () => new TurnInitPhase(binding.root))).phase;
      if (p instanceof EvolutionPhase) {
        binding.bindPhase(p); binding.sync();
        const stop = evolutionBoundary(c,p,nextSafeDecisionId(c.decision.id));
        c.continuation.currentPhase = {kind:'original-phase',phaseId:Math.max(-1,
          ...Object.values(c.continuation).flat().filter((d:any)=>d?.phaseId!==undefined).map((d:any)=>d.phaseId))+1,
          phase:p,remaining:stop.remaining};
        c.decision = stop.decision;
        return {checkpoint:codec.capture(c),events:binding.events,intents:binding.intents};
      }
      if (p instanceof LearnMovePhase) {
        const partyIndex = (p as any).partyMemberIndex, moveId = (p as any).moveId;
        const seat = binding.bindPhase(p);
        check(seat === 0 || seat === 1, 'INVALID_LEARN_OWNER');
        const entry = c.roster.entries.find(item => item.owner === seat && item.group === 'party'
          && item.index === partyIndex);
        check(entry, 'INVALID_LEARN_OWNER');
        const selection = inspectLearnMove(entry.pokemon, moveId);
        if (selection.kind === 'choose') {
          // selectNextPhase removed this phase from the bound queues. Persist
          // that removal before saving it as current, otherwise decline would
          // reopen the very same learning choice after recovery.
          binding.sync();
          const id = nextNativeDecisionId(c);
          phases.capture(p, c, seat);
          c.continuation.currentPhase = { kind: 'original-phase', phaseId: Math.max(-1,
            ...Object.values(c.continuation).flat().filter((d: any) => d?.phaseId !== undefined).map((d: any) => d.phaseId)) + 1,
            phase: p, remaining: 'learn-apply' };
          c.decision = createLearnDecision(id, c, seat, entry.pokemon.id, moveId, id => !!allMoves[id]);
          return { checkpoint: codec.capture(c), events: binding.events, intents: binding.intents };
        }
      }
      check(supportsPhase(p), 'UNSUPPORTED_NATIVE_ENTRY_PHASE');
      const result = await binding.execute(p);
      const id = nextNativeDecisionId(c);
      if(partyWiped(c)){
        c.decision=defeatDecision(id);
        return {checkpoint:codec.capture(c),events:binding.events,intents:binding.intents};
      }
      if(p instanceof GameOverPhase){
        c.decision=victoryDecision(id);
        return {checkpoint:codec.capture(c),events:binding.events,intents:binding.intents};
      }
      if (result.suspended) {
        const kind = switchKind(p);
        // Retain the actual current phase, just as the per-phase runner does.
        const descriptor = { kind: 'original-phase', phaseId: Math.max(-1,
          ...Object.values(c.continuation).flat().filter((d: any) => d?.phaseId !== undefined).map((d: any) => d.phaseId)) + 1,
          phase: p, remaining: kind };
        c.continuation.currentPhase = descriptor;
        c.decision = switchDecision(id, c, p);
        return { checkpoint: codec.capture(c), events: binding.events, intents: binding.intents };
      }
      c.decision = p instanceof TurnInitPhase ? actionDecision(c, binding.root, id)
        : { id, kind: 'continuing', requiredSeats: [], reason: 'effects' };
      if (p instanceof TurnInitPhase) return { checkpoint: codec.capture(c), events: binding.events, intents: binding.intents };
    }
    throw new Error('NATIVE_PHASE_BUDGET_EXCEEDED');
  } finally { binding.dispose(); }
}

// Normal uninterrupted server entry. It calls the same complete original
// phases; per-phase execution above is the recovery/diagnostic counterpart.
async function runOpenedToInput(runtime, opened) {
  const c = codec.restore(opened.checkpoint);
  const binding = bindNativeScene(c, runtime.scene.gameData);
  try {
    for (let index = 0; index < 100; index++) {
      const selected = selectNextPhase(binding.root, () => populatePhaseQueue(binding.root, () => new TurnInitPhase(binding.root)));
      const p = selected.phase;
      check([SummonPhase, PostSummonPhase, ToggleDoublePositionPhase, TurnInitPhase, MessagePhase, ShinySparklePhase]
        .some(ctor => Object.getPrototypeOf(p) === ctor.prototype), 'UNSUPPORTED_NATIVE_ENTRY_PHASE');
      await binding.execute(p);
      if (p instanceof TurnInitPhase) {
        c.decision = actionDecision(c, binding.root, `native-${c.battle.waveIndex}-${index + 1}`);
        return { checkpoint: codec.capture(c), events: [...opened.events, ...binding.events], intents: [...opened.intents, ...binding.intents] };
      }
    }
    throw new Error('NATIVE_ENTRY_PHASE_BUDGET_EXCEEDED');
  } finally { binding.dispose(); }
}

export async function openNativeBattleToInput(runtime, payload) {
  return runOpenedToInput(runtime, await openNativeBattle(runtime, payload));
}

export async function openNativeSelectedBattleToInput(runtime, payload) {
  return runOpenedToInput(runtime, await openNativeSelectedBattle(runtime, payload));
}

function validateCaptureIntent(c, binding, seat, action) {
  check(!hasLegacyCaptures(c, seat), 'LEGACY_RESERVE_REQUIRES_REVIEW');
  check(action && Object.keys(action).sort().join(',') === 'kind,pokeballType,targetId'
    && action.kind === 'ball', 'INVALID_CAPTURE_INTENT');
  check(Number.isInteger(action.pokeballType) && action.pokeballType < 5 && Object.values(PokeballType).includes(action.pokeballType),
    'INVALID_POKEBALL');
  check((c.players[seat].pokeballCounts[action.pokeballType] ?? 0) > 0, 'NO_POKEBALL');
  check(c.battle.battleType !== BattleType.TRAINER, 'CAPTURE_TRAINER_BATTLE');
  check(c.arena.biomeType !== Biome.END, 'CAPTURE_FORBIDDEN_BIOME');
  const enemies = binding.root.getEnemyField().filter((enemy: any) => enemy.isActive(true));
  check(enemies.length === 1 && enemies[0].id === action.targetId, 'INVALID_CAPTURE_TARGET');
  check(!(enemies[0].isBoss() && enemies[0].bossSegmentIndex >= 1), 'CAPTURE_BOSS');
  check(!c.enemyModifiers.some(m => m instanceof PokemonHeldItemModifier && m.pokemonId === action.targetId),
    'UNSUPPORTED_CAPTURE_HELD_ITEMS');
  return enemies[0];
}

function validateActiveSwitch(c, binding, seat, action) {
  check(action && Object.keys(action).sort().join(',') === 'kind,pokemonId' && action.kind === 'switch', 'INVALID_SWITCH_INTENT');
  const entry = c.roster.entries.find(e => e.owner === seat && e.group === 'party'
    && e.pokemon.id === action.pokemonId);
  check(entry && entry.index > 0 && entry.pokemon.hp > 0, 'INVALID_SWITCH_TARGET');
  check(!c.roster.field.includes(entry.pokemon.id), 'INVALID_SWITCH_TARGET');
  const player = binding.root.getPlayerField()[seat];
  check(player?.hp > 0, 'INVALID_SWITCH_OWNER');
  const trapTag = player.findTag((tag: any) => tag instanceof TrappedTag);
  const trapped = new Utils.BooleanHolder(false);
  binding.root.getEnemyField().forEach((enemy: any) => applyCheckTrappedAbAttrs(CheckTrappedAbAttr, enemy, trapped));
  check(!trapTag && !trapped.value, 'POKEMON_TRAPPED');
  return entry;
}

export function validateNativeAction(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'action,checkpoint,seat', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  codec.validateAction(c, payload.seat, payload.action);
  const binding = bindNativeScene(c, runtime.scene.gameData);
  const saved = c.battle.captureRandomState();
  try {
    if (payload.action.kind === 'switch') {
      validateActiveSwitch(c, binding, payload.seat, payload.action);
      return true;
    }
    if (payload.action.kind === 'ball') {
      validateCaptureIntent(c, binding, payload.seat, payload.action);
      return true;
    }
    return withOriginalRules(c, () => resolveFightIntent(binding.root.getPlayerField()[payload.seat], payload.seat, payload.action,
      { fightCommand: Command.FIGHT, noneMove: Moves.NONE, struggleMove: Moves.STRUGGLE, getMoveTargets, getEncoreTag: p => p.getTag(EncoreTag) }));
  } finally { c.battle.restoreRandomState(saved); binding.dispose(); }
}

export async function submitNativeActions(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'checkpoint,inputs', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  let intents = [];
  const result = await advanceCollectedFightCommands(c, payload.inputs, codec, {
    validateInput(candidate, seat, action) {
      const binding = bindNativeScene(candidate, runtime.scene.gameData);
      const saved = candidate.battle.captureRandomState();
      try {
        if (action.kind === 'switch') { validateActiveSwitch(candidate, binding, seat, action); return true; }
        if (action.kind === 'ball') { validateCaptureIntent(candidate, binding, seat, action); return true; }
        return withOriginalRules({ ...candidate, sceneRandom: new SceneRandom(candidate.sceneRandom.capture()) }, () =>
          resolveFightIntent(binding.root.getPlayerField()[seat], seat, action, {
            fightCommand: Command.FIGHT, noneMove: Moves.NONE, struggleMove: Moves.STRUGGLE,
            getMoveTargets, getEncoreTag: p => p.getTag(EncoreTag)
          }));
      }
      finally { candidate.battle.restoreRandomState(saved); binding.dispose(); }
    },
    async executeCollected(candidate, inputs) {
      const binding = bindNativeScene(candidate, runtime.scene.gameData, inputs);
      try {
        for (let budget = 0; budget < 10; budget++) {
          const next = binding.root.phaseQueuePrepend.at(-1) ?? binding.root.phaseQueue[0];
          if (!(next instanceof CommandPhase || next instanceof SelectTargetPhase)) break;
          const p = selectNextPhase(binding.root, () => { throw new Error('NATIVE_COMMAND_QUEUE_EMPTY'); }).phase;
          await binding.execute(p);
        }
        const inputSeats = Object.keys(inputs).map(Number);
        check(inputSeats.every(seat => [Command.FIGHT, Command.POKEMON, Command.BALL].includes(candidate.battle.turnCommands[seat]?.command)),
          'INCOMPLETE_NATIVE_COMMANDS');
        intents = binding.intents;
        return { completed: true, pendingTasks: 0, events: binding.events, grants: [] };
      } finally { binding.dispose(); }
    }
  }, { decisionId: nextNativeDecisionId(c), allowSwitch: true });
  return { checkpoint: codec.capture(result.context), events: result.events, intents };
}

export async function openNativePreparation(runtime, checkpoint, sharedMarket = false) {
  const c = codec.restore(checkpoint);
  const result = await openPreparation(c, codec, {
    openPersonalMenu: (candidate, _queued, { seat }) => openNativePersonalMenu(candidate, runtime, seat, null, sharedMarket),
    copySharedMenu(candidate, template, {seat}) {
      const binding = bindNativeScene(candidate, runtime.scene.gameData);
      try {
        const phase = new SelectModifierPhase(binding.views[seat]);
        phases.capture(phase, candidate, seat);
        return {...template, phase, events: []};
      } finally { binding.dispose(); }
    },
  }, { decisionId: nextNativeDecisionId(c), sharedMarket });
  return { checkpoint: codec.capture(result.context), events: result.events, intents: [] };
}

async function openNativePersonalMenu(candidate, runtime, seat, rerolledPhase = null, sharedMarket = false) {
  const binding = bindNativeScene(candidate, runtime.scene.gameData), scene = binding.views[seat];
  const phase = rerolledPhase ?? new SelectModifierPhase(scene);
  phase.scene = scene;
  let menu;
  (phase as any).getExcludedModifierIds = () => coopRewardExclusions;
  scene.ui = { setMode: (mode, _player, options, callback, cost) => {
    check(mode === Mode.MODIFIER_SELECT, 'NATIVE_UI_DECISION_REQUIRED'); menu = { options, callback, cost };
  } };
  try {
    const shop = await withOriginalRules(candidate, () => {
      const ownParty = scene.getParty, ownModifiers = scene.modifiers;
      if (sharedMarket) {
        const party = [seat, 1-seat].flatMap(owner => binding.views[owner].getParty());
        scene.getParty = () => party;
        scene.modifiers = candidate.players.flatMap(player => player.modifiers);
      }
      try { phase.start(); }
      finally { scene.getParty = ownParty; scene.modifiers = ownModifiers; }
      const shop = getPlayerShopModifierTypeOptionsForWave(candidate.battle.waveIndex, scene.getWaveMoneyAmount(1));
      for (const option of shop) if (!option.type.id) option.type.id = Object.keys(modifierTypes).find(id => {
        const type = modifierTypes[id](); return type.constructor === option.type.constructor && type.name === option.type.name;
      });
      return shop;
    });
    delete (phase as any).getExcludedModifierIds;
    check(menu, 'NATIVE_REWARD_MENU_MISSING'); binding.sync();
    phases.capture(phase, candidate, seat);
    const pack = (list, prefix) => list.map((option, index) => ({ id: `${prefix}-${index}`,
      type: captureModifierTypeState(option.type), cost: option.cost }));
    return { completed: false, suspended: true, pendingTasks: 0, phase,
      rewards: pack(menu.options, 'reward'), shop: pack(shop, 'shop'), rerollCost: menu.cost,
      events: [{ kind: 'preparation-open', seat }], grants: [] };
  } finally { delete (phase as any).getExcludedModifierIds; binding.dispose(); }
}

function preparationEffectDriver(runtime, intents = []) {
  return {
    validate(c, seat, action) {
      if (['skip-reward', 'ready', 'unready'].includes(action.operation)) return;
      const row = c.decision.players[seat];
      if (action.operation === 'reroll') {
        const phase = new SelectModifierPhase({ currentBattle: c.battle } as any, row.rerollCount);
        check(row.rerollCost === phase.getRerollCost(), 'STALE_REROLL_PRICE');
        return;
      }
      check(['reward', 'buy'].includes(action.operation), 'PREPARATION_EFFECT_UNAVAILABLE');
      const options = action.operation === 'buy' ? row.shop : row.rewards;
      const option = options.find(o => o.id === action.optionId);
      check(option, 'INVALID_PREPARATION_OPTION');
      check(!option.type.catalogId.startsWith('VOUCHER'), 'COOP_VOUCHER_RULE_UNCONFIRMED');
      if (action.operation === 'buy') {
        const shop = getPlayerShopModifierTypeOptionsForWave(c.battle.waveIndex,
          BattleScene.prototype.getWaveMoneyAmount.call({ currentBattle: c.battle }, 1));
        const live = shop[options.indexOf(option)];
        check(live && live.cost === option.cost, 'STALE_PREPARATION_SHOP');
        live.type.id = option.type.catalogId;
        check(canonical(captureModifierTypeState(live.type)) === canonical(option.type), 'STALE_PREPARATION_SHOP');
      }
      const type: any = restoreModifierTypeState(option.type);
      const targetKind = preparationItemTarget(type);
      check(targetKind !== null, 'PREPARATION_EFFECT_UNAVAILABLE');
      if (targetKind !== 'none') {
        check(action.pokemonId !== null && action.fusionId === null,
          'INVALID_PREPARATION_TARGET');
        const entry = c.roster.entries.find(e => e.owner === seat && e.group === 'party'
          && e.pokemon.id === action.pokemonId);
        check(entry, 'INVALID_PREPARATION_OWNER');
        // Held-item filters read Pokemon.scene and the owner's current stacks.
        // Bind only a detached codec copy so validation cannot mutate the input.
        const candidate = codec.restore(codec.capture(c)), binding = bindNativeScene(candidate, runtime.scene.gameData);
        try {
          const target = candidate.roster.entries.find(e => e.owner === seat && e.pokemon.id === action.pokemonId).pokemon;
          check(type.selectFilter(target) === null, 'INVALID_PREPARATION_TARGET');
          if (targetKind === 'move') check(action.moveIndex !== null && target.getMoveset()[action.moveIndex]
            && type.moveSelectFilter(target.getMoveset()[action.moveIndex]) === null, 'INVALID_PREPARATION_MOVE');
          else check(action.moveIndex === null, 'INVALID_PREPARATION_MOVE');
        } finally { binding.dispose(); }
        return;
      }
      check(action.pokemonId === null && action.moveIndex === null && action.fusionId === null, 'INVALID_PREPARATION_TARGET');
    },
    async execute(c, phase, { seat, action }) {
      check(phases.isPhase(phase), 'INVALID_PREPARATION_PHASE');
      const binding = bindNativeScene(c, runtime.scene.gameData), view = binding.views[seat];
      phase.scene = view;
      const party = c.roster.entries.filter(e => e.owner === seat && e.group === 'party')
        .sort((a, b) => a.index - b.index).map(e => e.pokemon);
      view.party = party;
      view.getParty = () => party;
      view.pokeballCounts = c.players[seat].pokeballCounts;
      view.sound = { get: () => null };
      Object.defineProperty(view, 'money', { configurable: true, get: () => c.players[seat].money,
        set: value => { c.players[seat].money = value; } });
      let ended = false, next = null;
      const growth=[];
      const beforeMoney = c.players[seat].money;
      const displayTasks = party.map(pokemon => {
        const descriptor = Object.getOwnPropertyDescriptor(pokemon, 'updateInfo'), update = pokemon.updateInfo;
        pokemon.updateInfo = (...args) => observeRulePromise(view, update.apply(pokemon, args));
        return () => { if (descriptor) Object.defineProperty(pokemon, 'updateInfo', descriptor); else delete (pokemon as any).updateInfo; };
      });
      view.unshiftPhase = phase => {
        if (phase instanceof LevelUpPhase) {phases.capture(phase,c,seat);growth.unshift(phase);return;}
        check(!next && phase instanceof SelectModifierPhase, 'UNEXPECTED_PREPARATION_PHASE'); next = phase;
      };
      view.validateAchvs = BattleScene.prototype.validateAchvs; // validateAchv is the existing deferred owned port.
      // The original max-stack fallback queues a prompt. Preparation has no
      // battle queue to consume it; publish that display text privately instead.
      view.queueMessage = text => binding.events.push({kind:'message',scope:seat,text,presentation:presentationText(text)});
      view.shiftPhase = () => { ended = true; };
      view.ui = {
        clearText() {}, playError() { throw new Error('ORIGINAL_MENU_REJECTED'); },
        getHandler: () => ({ updateCostText() {} }),
        setMode: () => Promise.resolve(),
        setModeWithoutClear(mode, _partyMode, _unused, callback, filter, moveFilter) {
          check(mode === Mode.PARTY, 'UNSUPPORTED_MENU_MODE');
          const index = party.findIndex(pokemon => pokemon.id === action.pokemonId);
          const target = party[index];
          check(target && filter(target) === null, 'INVALID_PREPARATION_TARGET');
          if (moveFilter) check(moveFilter(target.getMoveset()[action.moveIndex]) === null, 'INVALID_PREPARATION_MOVE');
          return callback(index, action.moveIndex === null ? undefined : PartyOption.MOVE_1 + action.moveIndex);
        },
      };
      view.addModifier = (...args) => {
        const modifier = args[0];
        check(isPreparationModifier(modifier), 'PREPARATION_EFFECT_UNAVAILABLE');
        return observeRulePromise(view, BattleScene.prototype.addModifier.apply(view, args));
      };
      try {
        const row = c.decision.players[seat];
        const typeOptions = row.rewards.map(option =>
          new ModifierTypeOption(restoreModifierTypeState(option.type), 0, option.cost));
        const callback = phase.createModifierSelectCallback(typeOptions);
        await withOriginalRules(c, async () => {
          if (action.operation === 'reroll') callback(0, 0);
          else {
            const options = action.operation === 'buy' ? row.shop : row.rewards;
            const index = options.findIndex(option => option.id === action.optionId);
            check(index >= 0, 'INVALID_PREPARATION_OPTION');
            const rowCursor = action.operation === 'reward' ? 1 : options.length > 6 && index < 6 ? 3 : 2;
            callback(rowCursor, action.operation === 'buy' && options.length > 6 && index >= 6 ? index - 6 : index);
          }
          // The original Party callback schedules addModifier on a microtask.
          // Keep the scope bound until that original task and its effects settle.
          await Promise.resolve();
          await binding.drainTasks();
        });
        check(ended === (action.operation !== 'buy'), 'INCOMPLETE_PREPARATION_EFFECT');
        intents.push(...binding.intents);
        const events = [...binding.events, { kind: 'preparation-effect', seat, operation: action.operation }];
        if (c.players[seat].money !== beforeMoney) {
          const text=i18next.t('coop:moneyChange',{direction:i18next.t(c.players[seat].money>beforeMoney?'coop:moneyIncrease':'coop:moneySpend'),
            amount:Math.abs(c.players[seat].money-beforeMoney),balance:c.players[seat].money});
          events.push({kind:'message',scope:seat,text,presentation:presentationText(text)} as any);
        }
        if (action.operation === 'reroll') {
          check(next instanceof SelectModifierPhase, 'INCOMPLETE_ORIGINAL_REROLL');
          binding.dispose();
          const menu = await openNativePersonalMenu(c, runtime, seat, next, !!c.decision.shared);
          return { completed: true, pendingTasks: 0, ended, events: [...events, ...menu.events], grants: [], menu, phase: menu.phase };
        }
        check(next === null, 'UNEXPECTED_PREPARATION_PHASE');
        return { completed: true, pendingTasks: 0, ended, events, grants: [], ...(growth.length?{growth}: {}) };
      } finally { displayTasks.forEach(restore => restore()); binding.dispose(); }
    },
  };
}

export async function chooseNativePreparation(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'action,checkpoint,seat', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  if (c.decision.kind==='preparation' && c.decision.players[payload.seat]?.subdecision) {
    const intents=[];
    const result=await advancePreparationGrowth(c,payload.seat,payload.action,codec,originalSafeDecisionCodec,nativePreparationGrowthDriver(runtime,intents));
    completeSharedPreparation(result,codec);
    return {checkpoint:codec.capture(result.context),events:result.events,intents};
  }
  check(payload.action?.operation !== 'reserve-swap', 'RESERVE_STORAGE_DISABLED');
  if (payload.action?.operation === 'legacy-capture') {
    validateLegacyCapture(c, payload.seat, payload.action, codec, originalSafeDecisionCodec);
    const { seat, action } = payload, incoming = c.roster.entries.find(e => e.owner === seat && e.group === 'reserve'
      && e.pokemon.id === action.pokemonId);
    const binding = bindNativeScene(c, runtime.scene.gameData);
    try {
      const party = binding.views[seat].getParty();
      if (action.choice === 'keep' && action.releaseId !== null) {
        const index = party.findIndex(p => p.id === action.releaseId);
        check(index >= 0, 'INVALID_LEGACY_CAPTURE_CHOICE');
        releaseNativePartyMember(c, binding, seat, index, () => {});
      }
      c.roster.entries = c.roster.entries.filter(e => e !== incoming);
      if (action.choice === 'keep') party.push(incoming.pokemon);
      else c.roster.retiredIds.push(incoming.pokemon.id);
      await binding.drainTasks();
      binding.sync();
      c.decision.id = nextSafeDecisionId(c.decision.id);
      return { checkpoint: codec.capture(c), events: [{ kind:'legacy-capture-choice', seat,
        pokemonId:action.pokemonId, choice:action.choice }], intents:[] };
    } finally { binding.dispose(); }
  }
  check(!hasLegacyCaptures(c, payload.seat) || payload.action?.operation === 'unready', 'LEGACY_CAPTURE_PENDING');
  const intents = [];
  let result = await advancePreparationEffect(c, payload.seat, payload.action, codec, originalSafeDecisionCodec, preparationEffectDriver(runtime, intents));
  if (result.context.pendingEffects.some(e=>e.id.startsWith(`preparation-growth-${payload.seat}-`))) {
    const grown=await advancePreparationGrowth(result.context,payload.seat,null,codec,originalSafeDecisionCodec,nativePreparationGrowthDriver(runtime,intents));
    grown.events.unshift(...result.events);result=grown;
  }
  completeSharedPreparation(result, codec);
  return { checkpoint: codec.capture(result.context), events: result.events, intents };
}

export async function nextNativeBattle(runtime, checkpoint) {
  const c = codec.restore(checkpoint), intents = [];
  check(![0,1].some(seat => hasLegacyCaptures(c,seat)), 'LEGACY_CAPTURE_PENDING');
  const fixed = fixedBattles[c.battle.waveIndex + 1];
  check(!fixed || fixed.battleType === BattleType.TRAINER, 'UNSUPPORTED_NATIVE_NEXT_BATTLE');
    let selectedBiome;
    const result = await advanceNextBattle(c, codec, {
      isFinalEncounter:(before,after)=>before.battle.gameMode.isClassic&&after.battle.battleType===BattleType.WILD
        &&after.battle.battleSpec===BattleSpec.FINAL_BOSS&&after.battle.gameMode.isWaveFinal(after.battle.waveIndex)
        &&after.battle.waveIndex===before.battle.waveIndex+1,
      isBiomeTransition: candidate => candidate.battle.gameMode.isClassic && candidate.battle.waveIndex % 10 === 0,
      async validateBiomeTransition(before, after) {
        if(selectedBiome===undefined||after.arena.biomeType!==selectedBiome)return false;
        const expected=codec.restore(codec.capture(before));expected.battle.waveIndex=after.battle.waveIndex;
        const binding=bindNativeScene(expected,runtime.scene.gameData);
        try{
          for(const entry of expected.roster.entries.filter(e=>e.owner!==null)){
            entry.pokemon.resetBattleData();
            if(entry.index===0&&entry.group==='party'){entry.pokemon.resetTurnData();entry.pokemon.resetSummonData();}
          }
          await binding.execute(new PartyHealPhase(binding.root,false));
          const party=value=>value.roster.entries.filter(e=>e.owner!==null).map(e=>{
            const p=capturePokemonState(e.pokemon);delete p.fields.battleData;return {owner:e.owner,index:e.index,pokemon:p};
          });
          const referenceParty=party(expected),actualParty=party(after);
          for(let i=0;i<referenceParty.length;i++)for(const key of Object.keys(referenceParty[i].pokemon.fields))
            check(canonical(referenceParty[i].pokemon.fields[key])===canonical(actualParty[i]?.pokemon.fields[key]),'BIOME_PARTY_MISMATCH_'+key.toUpperCase());
          if(canonical(referenceParty)!==canonical(actualParty))return false;
          expected.arena=binding.root.newArena(selectedBiome);
          const reference=codec.capture(expected).arena,actual=codec.capture(after).arena;
          delete reference.weather;delete actual.weather;
          for(const key of Object.keys(reference))check(canonical(reference[key])===canonical(actual[key]),'BIOME_ARENA_MISMATCH_'+key.toUpperCase());
          return canonical(reference)===canonical(actual);
        }finally{binding.dispose();}
      },
      phaseKind: p => p.constructor.name,
      validateWildTransition(before,after) {
        const expected=codec.restore(codec.capture(before));
        const binding=bindNativeScene(expected,runtime.scene.gameData);
        try {
          expected.battle.waveIndex=after.battle.waveIndex;
          // Original newBattle refreshes the time-of-day pool at each xx5.
          // Compare the complete original Arena result, including unchanged
          // weather, terrain and tags; never omit pool fields from validation.
          if(after.battle.waveIndex%10===5)expected.arena.updatePoolsForTimeOfDay();
          return canonical(codec.capture(expected).arena)===canonical(codec.capture(after).arena);
        }finally{binding.dispose();}
      },
      validateTrainerTransition(before, after) {
        const expected = codec.restore(codec.capture(before));
        const binding = bindNativeScene(expected, runtime.scene.gameData);
        try {
          expected.battle.waveIndex = after.battle.waveIndex;
          if(after.battle.waveIndex%10===5)expected.arena.updatePoolsForTimeOfDay();
          expected.arena.removeAllTags();
          for (const entry of expected.roster.entries.filter(e=>e.owner!==null&&e.group==='party'&&e.index===0)) {
            const pokemon = entry.pokemon;
            if (pokemon) { pokemon.resetTurnData(); pokemon.resetSummonData(); }
          }
          const reference = codec.capture(expected), actual = codec.capture(after);
          const resets = s => s.roster.entries.filter(e => e.owner !== null)
            .map(e => ({id:e.pokemon.fields.id, summonData:e.pokemon.fields.summonData??null, turnData:e.pokemon.fields.turnData??null}));
          return canonical(reference.arena) === canonical(actual.arena)
            && canonical(resets(reference)) === canonical(resets(actual));
        } finally { binding.dispose(); }
      },
      validateBranch(candidate) {
        check(candidate.battle.battleType === 0 || candidate.battle.battleType === BattleType.TRAINER,
          'UNSUPPORTED_NATIVE_NEXT_BATTLE');
        check(candidate.battle.battleSpec === 0, 'UNSUPPORTED_NATIVE_NEXT_BATTLE');
        check(candidate.players.every(player => player.modifiers.every(isPreparationPersistent)), 'UNSUPPORTED_NATIVE_ENCOUNTER_PLAYER_MODIFIERS');
      },
      async execute(candidate, p) {
        const binding = bindNativeScene(candidate, runtime.scene.gameData);
        try { if(p instanceof SwitchBiomePhase)selectedBiome=(p as any).nextBiome;
          const result = await binding.execute(p); intents.push(...binding.intents); return result; }
        finally { binding.dispose(); }
      },
      validateEnemyModifiers: candidate => candidate.enemyModifiers.every(m => m instanceof PokemonHeldItemModifier
        && candidate.battle.enemyParty.some(p => p.id === m.pokemonId) && m.stackCount > 0 && m.virtualStackCount === 0)
    }, { decisionId: `native-${c.battle.waveIndex + 1}-0` });
    if (result.context.battle.battleType !== BattleType.TRAINER)check(result.context.battle.enemyParty.every(p => !p.isBoss() || Number.isSafeInteger(p.bossSegments)
      && p.bossSegments > 0 && p.bossSegmentIndex === p.bossSegments - 1), 'INVALID_NATIVE_ENCOUNTER_BOSS');
    return { checkpoint: codec.capture(result.context), events: result.events, intents };
}

function releaseNativePartyMember(c, binding, seat, index, callback) {
  const party = binding.views[seat].getParty();
  if (c.roster.field[seat] === party[index].id) {
    binding.root.field.remove(party[index]);
    c.roster.field[seat] = null;
    // That member's command has already produced this catch. The next original
    // Encounter/Summon must deploy a survivor, rather than pretending a bench
    // member has already been summoned (preSummon also handles a fainted first).
    c.battle.turnCommands[seat] = null;
  }
  c.roster.retiredIds.push(party[index].id);
  // Original release owns modifier removal, splice, destruction and callback.
  PartyUiHandler.prototype.doRelease.call({ scene: binding.views[seat], cursor:index,
    partyUiMode:PartyUiMode.RELEASE, clearPartySlots() {}, populatePartySlots() {}, setCursor() {},
    getReleaseMessage: name => name, showText: (_text, _delay, done) => done?.(), selectCallback:callback,
  } as any, index);
}

export async function chooseNativeSwitch(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'checkpoint,inputs', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  if (c.decision.kind === 'capture-choice') {
    const seats = Object.keys(payload.inputs ?? {});
    check(seats.length === 1, 'INVALID_CAPTURE_CHOICE');
    const seat = Number(seats[0]), action = payload.inputs[seat];
    validateCaptureChoice(c, seat, action);
    const phase = c.continuation.currentPhase.phase, binding = bindNativeScene(c, runtime.scene.gameData);
    try {
      await binding.execute(phase, () => {
        if (action.releaseId === null) { phase.finishCatch(false); return; }
        const party = binding.views[seat].getParty(), index = party.findIndex(p => p.id === action.releaseId);
        check(index >= 0, 'INVALID_CAPTURE_CHOICE');
        releaseNativePartyMember(c, binding, seat, index, () => phase.finishCatch(true));
      });
      c.continuation.currentPhase = null;
      c.decision = { id: nextNativeDecisionId(c),
        kind: 'continuing', requiredSeats: [], reason: 'effects' };
      return { checkpoint: codec.capture(c), events: binding.events, intents: binding.intents };
    } finally { binding.dispose(); }
  }
  if (c.decision.kind === 'wait-switch') {
    const result = await advanceForcedSwitch(c, payload.inputs, codec, {
      async resumeSwitch(candidate, phase, { seat, partyIndex }) {
        const binding = bindNativeScene(candidate, runtime.scene.gameData);
        try { return await binding.execute(phase, () => phase.createSwitchSelectCallback(0)(partyIndex, PartyOption.SEND_OUT)); }
        finally { binding.dispose(); }
      },
    }, { decisionId: nextNativeDecisionId(c) });
    return { checkpoint: codec.capture(result.context), events: result.events, intents: [] };
  }
  const result = await advancePreBattleSwitch(c, payload.inputs, codec, {
    finishBoundary(candidate, _phase, id) {
      if (!candidate.continuation.phaseQueue.length && !candidate.continuation.phaseQueuePrepend.length)
        populatePhaseQueue(candidate.continuation, () => ({ kind: 'original-phase',
          phaseId: Math.max(-1, ...candidate.continuation.nextCommandPhaseQueue.map(d => d.phaseId)) + 1,
          phase: new TurnInitPhase(undefined), remaining: 'start' }));
      return { id, kind: 'continuing', requiredSeats: [], reason: 'effects' };
    },
    async resumeChoice(candidate, phase, { seat, kind, action }) {
      const binding = bindNativeScene(candidate, runtime.scene.gameData);
      try { return await binding.execute(phase, () => {
        if (kind === 'switch-confirm') phase.createSwitchConfirmCallbacks()[action.accept ? 'accept' : 'cancel']();
        else {
          const entry = candidate.roster.entries.find(e => e.owner === seat && e.pokemon.id === action.pokemonId);
          phase.createSwitchSelectCallback(0)(entry?.index ?? 6, entry ? PartyOption.SEND_OUT : PartyOption.CANCEL);
        }
      }); } finally { binding.dispose(); }
    }
  }, { decisionId: nextNativeDecisionId(c) });
  return { checkpoint: codec.capture(result.context), events: result.events, intents: [] };
}

// Pure validators/projection for the formal adapter. They restore the original
// model, read it, and never mutate the committed checkpoint or consume RNG.
export function validateNativePreparation(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'action,checkpoint,seat', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  if (c.decision.kind==='preparation' && c.decision.players[payload.seat]?.subdecision) {
    codec.validateAction(c,payload.seat,payload.action);return true;
  }
  check(payload.action?.operation !== 'reserve-swap', 'RESERVE_STORAGE_DISABLED');
  if (payload.action?.operation === 'legacy-capture') {
    validateLegacyCapture(c, payload.seat, payload.action, codec, originalSafeDecisionCodec); return true;
  }
  check(!hasLegacyCaptures(c, payload.seat) || payload.action?.operation === 'unready', 'LEGACY_CAPTURE_PENDING');
  validatePreparationEffect(c, payload.seat, payload.action, originalSafeDecisionCodec,
    preparationEffectDriver(runtime));
  return true;
}

export function validateNativeSwitch(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'action,checkpoint,seat', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  check(['switch-confirm', 'switch-select', 'wait-switch', 'capture-choice'].includes(c.decision.kind), 'INVALID_ACTION');
  codec.validateAction(c, payload.seat, payload.action);
  return true;
}

export function validateNativeCheckpoint(runtime, checkpoint) {
  codec.validate(checkpoint);
  return true;
}

export function validateNativeEggs(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'players', 'INVALID_EGG_STATE');
  originalOwnedEggStateCodec.restore(payload);
  return true;
}

function publicPokemonView(entry: any) {
  const pokemon = entry.pokemon;
  return {
    id: pokemon.id,
    owner: entry.owner,
    index: entry.index,
    speciesId: pokemon.species.speciesId,
    formIndex: pokemon.formIndex ?? 0,
    level: pokemon.level,
    hp: pokemon.hp,
    maxHp: pokemon.getMaxHp(),
    gender: pokemon.gender ?? 0,
    shiny: !!pokemon.shiny,
    teraType: pokemon.getTeraType(),
    ...(pokemon.isBoss() ? {bossSegments:pokemon.bossSegments,bossSegmentIndex:pokemon.bossSegmentIndex} : {}),
  };
}

export function projectNativeSnapshot(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'checkpoint,seat'
    && (payload.seat === 0 || payload.seat === 1), 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  const binding=bindNativeScene(c,runtime.scene.gameData);
  try {
  const fieldIds = c.roster.field.slice(0, 4);
  const fieldEntries = fieldIds.map(id => id === null ? null
    : c.roster.entries.find(entry => entry.pokemon.id === id) ?? null);
  const shared = {
    format: 1,
    stage: 'battle',
    waveIndex: c.battle.waveIndex,
    turn: c.battle.turn,
    double: c.battle.double,
    battleType: c.battle.battleType,
    battleSpec: c.battle.battleSpec,
    biome: c.arena.biomeType,
    // Public trainer presentation only; never expose the enemy party, seed or AI state.
    trainer: c.battle.battleType === BattleType.TRAINER && c.battle.trainer ? {
      type: c.battle.trainer.config.trainerType,
      variant: c.battle.trainer.variant,
      name: c.battle.trainer.name ?? null,
      partnerName: c.battle.trainer.partnerName ?? null,
      spriteKey: c.battle.trainer.getKey(),
      double: c.battle.trainer.isDouble(),
    } : null,
    // Public day/night presentation schedule; never expose the seed or RNG state.
    waveCycleOffset: c.scene.waveCycleOffset,
    terrainColorRatio: c.arena.getBgTerrainColorRatioForBiome(),
    field: fieldIds,
    pokemon: fieldEntries.filter(Boolean).map(publicPokemonView),
    decision: { id: c.decision.id, kind: c.decision.kind, requiredSeats: [...c.decision.requiredSeats] },
  };
  const player = c.players[payload.seat];
  check(Array.isArray(player.modifiers), 'INVALID_PERSONAL_MODIFIERS');
  const party = c.roster.entries
    .filter(entry => entry.owner === payload.seat && entry.group === 'party')
    .sort((a, b) => a.index - b.index)
    .map(entry => ({
      id: entry.pokemon.id,
      owner: payload.seat,
      index: entry.index,
      group: 'party',
      pokemon: capturePokemonState(entry.pokemon),
    }));
  const reserve = c.roster.entries
    .filter(entry => entry.owner === payload.seat && entry.group === 'reserve')
    .sort((a, b) => a.index - b.index)
    .map(entry => ({
      id: entry.pokemon.id,
      owner: payload.seat,
      index: entry.index,
      group: 'reserve',
      pokemon: capturePokemonState(entry.pokemon),
    }));
  const personal = {
    format: 1,
    stage: 'battle',
    seat: payload.seat,
    party,
    reserve,
    eggs: c.eggState ? originalOwnedEggStateCodec.capture(c.eggState).players[payload.seat] : null,
    resources: {
      money: player.money,
      pokeballs: JSON.parse(JSON.stringify(player.pokeballCounts)),
      modifiers: player.modifiers.map(captureModifierState),
    },
    decision: {
      id: c.decision.id,
      kind: c.decision.kind,
      requiredSeats: [...c.decision.requiredSeats],
      options: c.decision.options?.[payload.seat] ?? null,
      ...(c.decision.kind==='ended'?{reason:c.decision.reason,victory:c.decision.victory}:{}),
      players: c.decision.kind === 'preparation' ? c.decision.players[payload.seat] : null,
      ...(c.decision.kind === 'preparation' && c.decision.shared ? {sharedMarket: {...c.decision.shared,
        finished:c.decision.players.map(p=>p.ready),rerollLocked:c.decision.players.some(p=>p.rewardResolved)}} : {}),
      learn: c.decision.kind === 'learn-move' && c.decision.requiredSeats.includes(payload.seat) ? c.decision.learn : null,
      ...(c.decision.kind === 'evolution' && c.decision.requiredSeats.includes(payload.seat)
        ? {evolution:{pokemonId:c.decision.pokemonId,stage:c.decision.stage}} : {}),
      switch: ['switch-confirm', 'switch-select'].includes(c.decision.kind)
        ? { outgoing: c.decision.switch?.outgoing?.[payload.seat] ?? null } : null,
      ...(legacyCaptureOptions(c, payload.seat) ? { legacyCapture: legacyCaptureOptions(c, payload.seat) } : {}),
    },
  };
  return { shared, personal };
  } finally { binding.dispose(); }
}
