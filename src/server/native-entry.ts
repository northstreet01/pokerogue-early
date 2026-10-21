import BattleScene from '../battle-scene';
import { Phase } from '../phase';
import Pokemon, { FieldPosition, HitResult } from '../field/pokemon';
import { NewBattlePhase, EncounterPhase, ShowTrainerPhase, SummonPhase, SummonMissingPhase, PostSummonPhase, ToggleDoublePositionPhase,
  TurnInitPhase, CommandPhase, MessagePhase, ShinySparklePhase } from '../phases';
import { SelectTargetPhase, EnemyCommandPhase, TurnStartPhase, MovePhase, MoveEffectPhase,
  MoveEndPhase, DamagePhase, StatChangePhase, TurnEndPhase, PostTurnStatusEffectPhase, CommonAnimPhase, ObtainStatusEffectPhase, ShowAbilityPhase } from '../phases';
import { FaintPhase, VictoryPhase, ExpPhase, ShowPartyExpBarPhase, HidePartyExpBarPhase, LevelUpPhase, LearnMovePhase, BattleEndPhase, EggLapsePhase, AttemptCapturePhase } from '../phases';
import { SelectModifierPhase } from '../phases';
import { CheckSwitchPhase, SwitchPhase, SwitchSummonPhase, ReturnPhase } from '../phases';
import { Mode } from '../ui/ui';
import { GameData } from '../system/game-data';
import { GameStats } from '../system/game-stats';
import { BattleAnim } from '../data/battle-anims';
import { createOriginalRuntime, constructOriginalPokemon, constructSelectedStarterInstance, capturePokemonState } from './original-runtime';
import Trainer from '../field/trainer';
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
import { openPreparation, advancePreparation, validatePreparationAction, coopRewardExclusions } from '../battle-core/preparation-runner.mjs';
import { advancePreparationEffect, validatePreparationEffect } from '../battle-core/preparation-effects-runner.mjs';
import { advanceNextBattle } from '../battle-core/next-battle-runner.mjs';
import { originalSafeDecisionCodec } from '../original-phase-checkpoints';
import { captureModifierTypeState, getPlayerShopModifierTypeOptionsForWave, modifierTypes,
  ModifierTypeOption, PokemonHpRestoreModifierType, PokemonReviveModifierType, restoreModifierTypeState } from '../modifier/modifier-type';
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
import { PokemonHeldItemModifier, AddPokeballModifier, PokemonHpRestoreModifier } from '../modifier/modifier';
import { EncoreTag, TrappedTag } from '../data/battler-tags';
import { CheckTrappedAbAttr, applyCheckTrappedAbAttrs } from '../data/ability';
import * as Utils from '../utils';
import { Command } from '../ui/command-ui-handler';
import { Moves } from '../data/enums/moves';
import { canonical, requireContract as check } from '../battle-core/coop-contract.mjs';
import { advanceProgressionChoice } from '../battle-core/progression-choice-runner.mjs';
import { createLearnDecision, inspectLearnMove } from '../battle-core/learn-command.mjs';
import { recoverVictoryParties } from '../battle-core/victory-aftermath-runner.mjs';

// Trainer visuals are display-only. Native battle tests have no Phaser
// Container list; the original encounter/rules still construct the real
// Trainer and party, while the client projects its own trainer presentation.
(Trainer.prototype as any).initSprite = function () {};
(Trainer.prototype as any).playAnim = function () {};
(Trainer.prototype as any).getSprites = function () { return [new DisplayTarget()]; };
(Trainer.prototype as any).getTintSprites = function () { return [new DisplayTarget()]; };
(Trainer.prototype as any).tint = function () { return this; };
(Trainer.prototype as any).clearTint = function () { return this; };

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
  setScale(..._args) { return this; }
  setAlpha(..._args: any[]) { return this; }
  clearTint() { return this; }
  setTintFill(..._args: any[]) { return this; }
  destroy() {}
}

const supportedPhases = [SummonPhase, SummonMissingPhase, PostSummonPhase, ToggleDoublePositionPhase, TurnInitPhase, MessagePhase, ShinySparklePhase, ShowTrainerPhase,
  EnemyCommandPhase, TurnStartPhase, MovePhase, MoveEffectPhase, MoveEndPhase, DamagePhase, StatChangePhase, TurnEndPhase, PostTurnStatusEffectPhase, CommonAnimPhase, ObtainStatusEffectPhase, ShowAbilityPhase,
  FaintPhase, VictoryPhase, ExpPhase, ShowPartyExpBarPhase, HidePartyExpBarPhase, LevelUpPhase, LearnMovePhase, BattleEndPhase, EggLapsePhase, CheckSwitchPhase, SwitchPhase, SwitchSummonPhase, ReturnPhase, AttemptCapturePhase];
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
      this.scene.nativeEvents.push({ kind: name, pokemonId: this.id });
      if (name === 'hideInfo') return Promise.resolve();
    };
  proto.loadAssets = function () { return Promise.resolve(); };
  proto.updateInfo = function () { return Promise.resolve(); };
  proto.faintCry = function (callback) { this.scene.time.delayedCall(0, callback); };
  proto.getSprite = function () { return new DisplayTarget(); };
  proto.destroy = function () {}; // Renderer disposal only; the original release owns party/modifier changes.
  proto.setFieldPosition = function (position) { this.fieldPosition = position; return Promise.resolve(); };
  for (const name of ['setX', 'setY', 'setPosition', 'setVisible', 'setScale'])
    proto[name] = DisplayTarget.prototype[name];
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
    setPokemonCaught: p => { intents.push({ kind: 'capture-pending', pokemonId: p.id,
      speciesId: p.species.speciesId, dexAttr: p.getDexAttr().toString(), level: p.level,
      ivs: [...p.ivs], nature: p.nature, pokemon: capturePokemonState(p) }); return Promise.resolve(); },
    saveSystem: () => { throw new Error('PERMANENT_SAVE_UNAVAILABLE'); },
    saveSession: () => { throw new Error('PERSONAL_SESSION_SAVE_UNAVAILABLE'); } });
  root.gameData = deferredData();
  const views = parties.map((party, seat) => {
    const view = Object.create(root);
    Object.assign(view, { modifiers: c.players[seat].modifiers, money: c.players[seat].money,
      pokeballCounts: c.players[seat].pokeballCounts, gameData: deferredData(), getParty: () => party,
      getPlayerField: () => root.getPlayerField(), getEnemyField: () => root.getEnemyField(),
      getField: active => root.getField(active), getPokemonById: id => root.getPokemonById(id),
      getPlayerPokemon: () => root.getPlayerPokemon() });
    for (const name of ['applyModifiers', 'applyModifier', 'findModifiers', 'findModifier', 'getModifiers', 'removeModifier'])
      view[name] = BattleScene.prototype[name];
    for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue', 'phaseQueuePrependSpliceIndex', 'currentPhase', 'standbyPhase', 'waveSeed'])
      Object.defineProperty(view, key, { get: () => root[key], set: value => { root[key] = value; }, configurable: true });
    return view;
  });
  root.modifiers = c.players.flatMap(p => p.modifiers);
  for (const { pokemon, owner } of c.roster.entries) {
    pokemon.scene = owner === null ? root : views[owner];
    // M2 deliberately excludes display position. Reattach display coordinates
    // without replaying a Pokemon constructor or consuming rule randomness.
    pokemon.setPosition(owner === null ? 236 : 106, owner === null ? 84 : 148);
  }
  for (const id of c.roster.field) if (id !== null) {
    const p = c.roster.entries.find(e => e.pokemon.id === id).pokemon;
    if (!p.isFainted(true)) root.field.add(p);
  }
  c.arena.scene = root;
  if (c.battle?.trainer) c.battle.trainer.scene = root;
  const trackers = [root, ...views].map(scene => createRuleTaskTracker(scene));
  const disposePorts = [root, ...views].map(scene => bindPresentationPort(scene, (kind, payload) => events.push({ kind, ...payload })));
  root.deferEncounterPersistence = () => {
    intents.push({ kind: 'encounter-persistence-pending', waveIndex: root.currentBattle.waveIndex });
    return Promise.resolve();
  };
  root.shiftPhase = () => { check(++ended === 1, 'NATIVE_PHASE_COMPLETED_TWICE'); completePhase?.(); };
  root.initSession = () => { intents.push({ kind: 'session-start' }); };
  root.playBgm = root.playSound = root.playSoundWithoutBgm = () => {};
  root.updateFieldScale = root.setFieldScale = () => Promise.resolve();
  root.updateUIPositions = root.updateWaveCountText = root.updateMoneyText = root.updateScoreText = () => {};
  root.trainer = root.arenaPlayer = root.arenaEnemy = root.arenaNextEnemy = new DisplayTarget();
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
  root.validateVoucher = () => { throw new Error('VOUCHER_POLICY_UNCONFIRMED'); };
  root.time = { delayedCall: (delay, fn, args = [], scope = null) => schedule(() => fn.apply(scope, args), delay) };
  root.time.addEvent = config => {
    check(config.repeat !== -1, 'UNSUPPORTED_REPEATING_RULE_TIMER');
    const timer = { repeatCount: config.repeat ?? 0, active: true, destroy() { this.active = false; } };
    const callback = () => {
      if (!timer.active) return;
      config.callback.call(config.callbackScope);
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
  root.ui = { getMessageHandler: () => ({ promptLevelUpStats: () => Promise.resolve() }), setMode: (mode, seat, _move, callback) => {
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
      const callback = [...args].reverse().find(arg => typeof arg === 'function');
      schedule(callback);
    },
    showText: (text, _delay, callback) => { events.push({ kind: 'message', text }); schedule(callback); } };
  root.damageNumberHandler = { add: (p, amount, result = HitResult.EFFECTIVE, critical = false) =>
    events.push({ kind: 'damage-display', pokemonId: p.id, amount, result, critical }) };
  BattleAnim.prototype.play = function (scene: any, callback) {
    scene.nativeEvents.push({ kind: 'battle-animation', animation: this.constructor.name });
    scene.time.delayedCall(0, callback);
  };
  const update = BattleScene.prototype.updateModifiers;
  for (const scene of [root, ...views]) scene.updateModifiers = function (...args) {
    return observeRulePromise(this, update.apply(this, args));
  };
  const generate = BattleScene.prototype.generateEnemyModifiers;
  root.generateEnemyModifiers = () => observeRulePromise(root, generate.call(root));
  root.newBattle = (...args) => {
    const wave = args[0] ?? (root.currentBattle?.waveIndex ?? 0) + 1;
    const fixed = wave === 5 ? fixedBattles[wave] : null;
    const oldDouble = fixed?.double;
    // Only the synchronous original constructor reads this config. Restore it
    // before any asynchronous encounter work or subsequent request can run.
    try {
      if (fixed) fixed.double = true;
      return BattleScene.prototype.newBattle.call(root, args[0], args[1], args[2], true);
    } finally { if (fixed) fixed.double = oldDouble; }
  };
  function bindPhase(p, existingScope?: number) {
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
  function sync() {
    if (c.battle && root.currentBattle !== c.battle) c.roster.retiredIds.push(...c.battle.enemyParty.map(p => p.id));
    c.battle = root.currentBattle; c.enemyModifiers = root.enemyModifiers;
    c.roster.entries = parties.flatMap((party, owner) => party.map((pokemon, index) => ({ owner, group: 'party', index, pokemon })))
      .concat(c.roster.entries.filter(e => e.owner !== null && e.group === 'reserve')).concat((root.currentBattle?.enemyParty ?? [])
      .map((pokemon, index) => ({ owner: null, group: 'enemy', index, pokemon })));
    c.roster.field = root.getField().map((p, slot) => p && !(p as any).__coopCaptured && (root.field.getIndex(p) >= 0
      || p.isFainted() && c.roster.field[slot] === p.id) ? p.id : null);
    for (const key of ['seed', 'waveSeed', 'waveCycleOffset', 'offsetGym', 'score']) c.scene[key] = root[key];
    if (Object.prototype.hasOwnProperty.call(root, 'lastEnemyTrainer')) c.scene.lastEnemyTrainer = root.lastEnemyTrainer;
    for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue']) c.continuation[key] = root[key].map(p => {
      const scope = bindPhase(p); phases.capture(p, c, scope);
      if (!ids.has(p)) ids.set(p, nextId++);
      return { kind: 'original-phase', phaseId: ids.get(p), phase: p, remaining: 'start' };
    });
    c.continuation.phaseQueuePrependSpliceIndex = root.phaseQueuePrependSpliceIndex;
  }
  return { root, views, events, intents, bindPhase, sync,
    drainTasks: () => Promise.all(trackers.map(tracker => tracker.drain())),
    async execute(p, resume?) {
      ended = 0; waiting = null;
      const completed = new Promise<void>(resolve => { completePhase = resolve; });
      let captureSeat: number | null = null, captureParty: Pokemon[] | null = null;
      let captureTarget: any = null, captureTargetScene: any = null;
      let priorParty: Set<Pokemon> | null = null;
      let cancelCapture = false;
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
      }
      const scope = bindPhase(p); root.currentPhase = p;
      const changes = [];
      const patch = (object, key, value) => { changes.push([object, key, Object.getOwnPropertyDescriptor(object, key)]);
        Object.defineProperty(object, key, { value, writable: true, configurable: true }); };
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
      const creating = p instanceof NewBattlePhase || p instanceof EncounterPhase;
      if (creating) check(c.players.every(player => player.modifiers.length === 0), 'UNSUPPORTED_NATIVE_ENCOUNTER_PLAYER_MODIFIERS');
      const disposeModifiers = creating ? () => {} : bindCoopModifierScope(c, root, views, p);
      const disposeFaint = p instanceof FaintPhase ? bindCoopFaint(p, c) : () => {};
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
        disposeFaint(); disposeModifiers();
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
      check(ended === 1 || ended === 0 && waiting, 'INCOMPLETE_NATIVE_PHASE'); root.currentPhase = null; sync();
      if (waiting) return { completed: false, suspended: true, pendingTasks: 0, events: [...events], grants: [] };
      return { completed: true, pendingTasks: 0, events: [...events], grants: [] };
    },
    dispose() { disposePorts.forEach(fn => fn()); trackers.forEach(t => t.close()); }
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
      try { const result = await binding.execute(p); intents = binding.intents; return result; }
      finally { binding.dispose(); }
    },
    suspendBoundary(c, p, id) {
      return { remaining: switchKind(p), decision: switchDecision(id, c, p) };
    },
    finishBoundary(c, p, id) {
      if (!c.continuation.phaseQueue.length && !c.continuation.phaseQueuePrepend.length)
        populatePhaseQueue(c.continuation, () => ({ kind: 'original-phase', phaseId: Math.max(-1, ...c.continuation.nextCommandPhaseQueue.map(d => d.phaseId)) + 1,
          phase: new TurnInitPhase(undefined), remaining: 'start' }));
      if (!(p instanceof TurnInitPhase)) return { id, kind: 'continuing', requiredSeats: [], reason: 'effects' };
      const binding = bindNativeScene(c, runtime.scene.gameData);
      try { return actionDecision(c, binding.root, id); }
      finally { binding.dispose(); }
    }
  }, { decisionId: `native-${input.battle.waveIndex}-${Number(input.decision.id.split('-').at(-1)) + 1}` });
  return { checkpoint: codec.capture(result.context), events: result.events, intents };
}

// Continuous original queue execution, without restoring Pokemon/Battle/Arena
// between phases. Recovery executes the same bodies via native-step instead.
// Learning is a personal one-seat decision. The phase remains the original
// suspended LearnMovePhase; only the confirmed forget branch or cancel end is
// resumed, then the normal queue continues.
function progressionContext(c, seat) {
  const d = c.decision, current = c.continuation.currentPhase, phase = current?.phase;
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
  check((phase as any).moveId === d.learn.moveId, 'INVALID_PROGRESSION_PHASE');
  return true;
}

export async function chooseNativeProgression(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'action,checkpoint,seat', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
  const seat = payload.seat;
  progressionContext(c, seat);
  const result = await advanceProgressionChoice(c, { [seat]: payload.action }, codec, originalSafeDecisionCodec, {
    async resumeLearning(candidate, phase, { action }) {
      const binding = bindNativeScene(candidate, runtime.scene.gameData);
      try {
        if (action.slot === null) return await binding.execute(phase, () => phase.end());
        return await binding.execute(phase, () => phase.forgetMove(action.slot, Mode.MESSAGE));
      } finally { binding.dispose(); }
    },
  }, { decisionId: `native-${c.battle.waveIndex}-${Number(c.decision.id.split('-').at(-1)) + 1}` });
  return { checkpoint: codec.capture(result.context), events: result.events, intents: [] };
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
      const p = selectNextPhase(binding.root, () => populatePhaseQueue(binding.root, () => new TurnInitPhase(binding.root))).phase;
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
          const id = `native-${c.battle.waveIndex}-${Number(c.decision.id.split('-').at(-1)) + 1}`;
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
      const id = `native-${c.battle.waveIndex}-${Number(c.decision.id.split('-').at(-1)) + 1}`;
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
  }, { decisionId: `native-${c.battle.waveIndex}-${Number(c.decision.id.split('-').at(-1)) + 1}`, allowSwitch: true });
  return { checkpoint: codec.capture(result.context), events: result.events, intents };
}

export async function openNativePreparation(runtime, checkpoint) {
  const c = codec.restore(checkpoint);
  const result = await openPreparation(c, codec, {
    async openPersonalMenu(candidate, _queued, { seat }) {
      const binding = bindNativeScene(candidate, runtime.scene.gameData), scene = binding.views[seat];
      const phase = new SelectModifierPhase(scene);
      let menu;
      (phase as any).getExcludedModifierIds = () => coopRewardExclusions;
      scene.ui = { setMode: (mode, _player, options, callback, cost) => {
        check(mode === Mode.MODIFIER_SELECT, 'NATIVE_UI_DECISION_REQUIRED'); menu = { options, callback, cost };
      } };
      try {
        const shop = await withOriginalRules(candidate, () => {
          phase.start();
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
  }, { decisionId: `native-${c.battle.waveIndex}-${Number(c.decision.id.split('-').at(-1)) + 1}` });
  return { checkpoint: codec.capture(result.context), events: result.events, intents: [] };
}

function preparationEffectDriver(runtime) {
  return {
    validate(c, seat, action) {
      if (['skip-reward', 'ready', 'unready'].includes(action.operation)) return;
      check(action.operation === 'reward', 'PREPARATION_EFFECT_UNAVAILABLE');
      const row = c.decision.players[seat];
      const option = row.rewards.find(o => o.id === action.optionId);
      check(option, 'INVALID_PREPARATION_OPTION');
      const type = restoreModifierTypeState(option.type);
      check(!(type instanceof PokemonReviveModifierType), 'PREPARATION_EFFECT_UNAVAILABLE');
      if (type instanceof PokemonHpRestoreModifierType) {
        check(action.pokemonId !== null && action.moveIndex === null && action.fusionId === null,
          'INVALID_PREPARATION_TARGET');
        const entry = c.roster.entries.find(e => e.owner === seat && e.group === 'party'
          && e.pokemon.id === action.pokemonId);
        check(entry, 'INVALID_PREPARATION_OWNER');
        check(type.selectFilter(entry.pokemon) === null, 'INVALID_PREPARATION_TARGET');
        return;
      }
      let modifier;
      try { modifier = type.newModifier(); } catch { modifier = null; }
      if (modifier instanceof AddPokeballModifier) {
        check(action.pokemonId === null && action.moveIndex === null && action.fusionId === null,
          'INVALID_PREPARATION_TARGET');
        return;
      }
      check(false, 'PREPARATION_EFFECT_UNAVAILABLE');
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
      let ended = false;
      view.shiftPhase = () => { ended = true; };
      view.ui = {
        clearText() {}, playError() { throw new Error('ORIGINAL_MENU_REJECTED'); },
        getHandler: () => ({ updateCostText() {} }),
        setMode: () => Promise.resolve(),
        setModeWithoutClear(mode, _partyMode, _unused, callback, filter) {
          check(mode === Mode.PARTY, 'UNSUPPORTED_MENU_MODE');
          const index = party.findIndex(pokemon => pokemon.id === action.pokemonId);
          const target = party[index];
          check(target && filter(target) === null, 'INVALID_PREPARATION_TARGET');
          return callback(index, undefined);
        },
      };
      view.addModifier = (...args) => {
        const modifier = args[0];
        check(modifier instanceof AddPokeballModifier || modifier instanceof PokemonHpRestoreModifier
          && !modifier.fainted, 'PREPARATION_EFFECT_UNAVAILABLE');
        return observeRulePromise(view, BattleScene.prototype.addModifier.apply(view, args));
      };
      try {
        const row = c.decision.players[seat];
        const typeOptions = row.rewards.map(option =>
          new ModifierTypeOption(restoreModifierTypeState(option.type), 0, option.cost));
        const callback = phase.createModifierSelectCallback(typeOptions);
        const index = row.rewards.findIndex(option => option.id === action.optionId);
        check(index >= 0, 'INVALID_PREPARATION_OPTION');
        await withOriginalRules(c, async () => {
          callback(1, index);
          // The original Party callback schedules addModifier on a microtask.
          // Keep the scope bound until that original task and its effects settle.
          await Promise.resolve();
          await binding.drainTasks();
        });
        check(ended, 'INCOMPLETE_PREPARATION_EFFECT');
        return { completed: true, pendingTasks: 0, ended: true,
          events: [{ kind: 'preparation-effect', seat, operation: 'reward' }], grants: [] };
      } finally { binding.dispose(); }
    },
  };
}

export async function chooseNativePreparation(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'action,checkpoint,seat', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
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
  const result = await advancePreparationEffect(c, payload.seat, payload.action, codec, originalSafeDecisionCodec, preparationEffectDriver(runtime));
  return { checkpoint: codec.capture(result.context), events: result.events, intents: [] };
}

export async function nextNativeBattle(runtime, checkpoint) {
  const c = codec.restore(checkpoint), intents = [];
  check(![0,1].some(seat => hasLegacyCaptures(c,seat)), 'LEGACY_CAPTURE_PENDING');
  const fixed = fixedBattles[c.battle.waveIndex + 1];
  check(!fixed || (c.battle.waveIndex + 1 === 5 && fixed.battleType === BattleType.TRAINER), 'UNSUPPORTED_NATIVE_NEXT_BATTLE');
    const result = await advanceNextBattle(c, codec, {
      phaseKind: p => p.constructor.name,
      validateTrainerTransition(before, after) {
        const expected = codec.restore(codec.capture(before));
        const binding = bindNativeScene(expected, runtime.scene.gameData);
        try {
          expected.battle.waveIndex = after.battle.waveIndex;
          expected.arena.updatePoolsForTimeOfDay();
          expected.arena.removeAllTags();
          for (const id of before.roster.field.slice(0, 2)) {
            const pokemon = expected.roster.entries.find(e => e.pokemon.id === id)?.pokemon;
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
        check(candidate.battle.battleType === 0 || candidate.battle.waveIndex === 5
          && candidate.battle.battleType === BattleType.TRAINER, 'UNSUPPORTED_NATIVE_NEXT_BATTLE');
        check(candidate.battle.battleSpec === 0 && candidate.battle.waveIndex % 10 !== 0, 'UNSUPPORTED_NATIVE_NEXT_BATTLE');
        check(candidate.players.every(player => player.modifiers.length === 0), 'UNSUPPORTED_NATIVE_ENCOUNTER_PLAYER_MODIFIERS');
      },
      async execute(candidate, p) {
        const binding = bindNativeScene(candidate, runtime.scene.gameData);
        try { const result = await binding.execute(p); intents.push(...binding.intents); return result; }
        finally { binding.dispose(); }
      },
      validateEnemyModifiers: candidate => candidate.enemyModifiers.every(m => m instanceof PokemonHeldItemModifier
        && candidate.battle.enemyParty.some(p => p.id === m.pokemonId) && m.stackCount > 0 && m.virtualStackCount === 0)
    }, { decisionId: `native-${c.battle.waveIndex + 1}-0` });
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
      c.decision = { id: `native-${c.battle.waveIndex}-${Number(c.decision.id.split('-').at(-1)) + 1}`,
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
    }, { decisionId: `native-${c.battle.waveIndex}-${Number(c.decision.id.split('-').at(-1)) + 1}` });
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
  }, { decisionId: `native-${c.battle.waveIndex}-${Number(c.decision.id.split('-').at(-1)) + 1}` });
  return { checkpoint: codec.capture(result.context), events: result.events, intents: [] };
}

// Pure validators/projection for the formal adapter. They restore the original
// model, read it, and never mutate the committed checkpoint or consume RNG.
export function validateNativePreparation(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'action,checkpoint,seat', 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
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
  };
}

export function projectNativeSnapshot(runtime, payload) {
  check(payload && Object.keys(payload).sort().join(',') === 'checkpoint,seat'
    && (payload.seat === 0 || payload.seat === 1), 'INVALID_NATIVE_ACTION');
  const c = codec.restore(payload.checkpoint);
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
    // Public day/night presentation schedule; never expose the seed or RNG state.
    waveCycleOffset: c.scene.waveCycleOffset,
    terrainColorRatio: c.arena.getBgTerrainColorRatioForBiome(),
    field: fieldIds,
    pokemon: fieldEntries.filter(Boolean).map(publicPokemonView),
    decision: { id: c.decision.id, kind: c.decision.kind, requiredSeats: [...c.decision.requiredSeats] },
  };
  const player = c.players[payload.seat];
  check(Array.isArray(player.modifiers) && player.modifiers.length === 0, 'UNSUPPORTED_PERSONAL_MODIFIERS');
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
      modifiers: [],
    },
    decision: {
      id: c.decision.id,
      kind: c.decision.kind,
      requiredSeats: [...c.decision.requiredSeats],
      options: c.decision.options?.[payload.seat] ?? null,
      players: c.decision.kind === 'preparation' ? c.decision.players[payload.seat] : null,
      learn: c.decision.kind === 'learn-move' && c.decision.requiredSeats.includes(payload.seat) ? c.decision.learn : null,
      switch: ['switch-confirm', 'switch-select'].includes(c.decision.kind)
        ? { outgoing: c.decision.switch?.outgoing?.[payload.seat] ?? null } : null,
      ...(legacyCaptureOptions(c, payload.seat) ? { legacyCapture: legacyCaptureOptions(c, payload.seat) } : {}),
    },
  };
  return { shared, personal };
}
