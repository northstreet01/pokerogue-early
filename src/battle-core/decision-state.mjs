import { captureModifierPoolState, restoreModifierPoolState } from './modifier-pool-state.mjs';
import { createForcedSwitchDecision,createPreBattleSwitchDecision } from './switch-command.mjs';
import { createLearnDecision } from './learn-command.mjs';
import { restoreContinuation } from './phase-continuation.mjs';
import { safeDecisionKinds } from './safe-decisions.mjs';
import { captureTurnCommands, restoreTurnCommands } from './command-state.mjs';
import {captureCommandTargetGroups,restoreCommandTargetGroups} from './command-target-state.mjs';
import { copy, canonical, requireContract as check } from './coop-contract.mjs';
import { RandomDataGenerator, readBattleRandomCheckpoint, shiftSeed } from './random.mjs';

const uint = v => Number.isSafeInteger(v) && v >= 0;
const exact = (v, names) => check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...names].sort().join(','), 'INVALID_CHECKPOINT');
export const battleCheckpointFields = Object.freeze(['gameMode','waveIndex','battleType','battleSpec','trainer','enemyLevels','enemyParty','seenEnemyPartyMemberIds','double','started','turn','turnCommands','playerParticipantIds','battleScore','postBattleLoot','escapeAttempts','lastMove','battleSeed','battleSeedState']);
export const arenaCheckpointFields = Object.freeze(['scene','biomeType','weather','terrain','tags','bgm','ignoreAbilities','lastTimeOfDay','pokemonPool','trainerPool']);
// Only bgm and the runtime scene reference are excluded from the arena projection.
const battleScalars = ['waveIndex','battleType','battleSpec','double','started','turn','battleScore','escapeAttempts'];
const arenaScalars = ['biomeType','ignoreAbilities','lastTimeOfDay','pokemonPool','trainerPool'];
const sceneFields = ['seed','waveSeed','waveCycleOffset','offsetGym','score'];

/** Room-owned equivalent of the original scene stream. Never swaps global RND. */
export class SceneRandom {
  constructor(state) {
    readBattleRandomCheckpoint({ version: 1, seed: '', turn: 0, state });
    check(state !== null, 'INVALID_SCENE_RANDOM');
    this.generator = new RandomDataGenerator(state);
  }
  capture() { return this.generator.state(); }
  integer(range, min = 0) { return range <= 1 ? min : this.generator.integerInRange(min, min + range - 1); }
  scoped(seed, offset, callback) {
    check(typeof callback === 'function' && callback.constructor.name !== 'AsyncFunction', 'ASYNC_RANDOM_SCOPE');
    const scoped = new RandomDataGenerator([shiftSeed(seed, offset)]);
    const result = callback(scoped);
    check(!result || typeof result.then !== 'function', 'ASYNC_RANDOM_SCOPE');
    return result;
  }
}

/** Explicit safe-boundary assembly. Trusted component codecs must fail closed
 * for every trainer/modifier they do not support; no ModifierData constructors. */
export function createDecisionStateCodec({ roster, effects, Battle, Arena, getGameMode, components, hasMove, safeDecisions, phaseState, arenaPools }) {
  const encodeRaw = (kind, value) => {
    if (value === null) return null;
    check(components?.[kind]?.capture && components?.[kind]?.restore, 'COMPONENT_UNAVAILABLE');
    return components[kind].capture(value);
  };
  const decodeRaw = (kind, value) => {
    if (value === null) return null;
    check(components?.[kind]?.capture && components?.[kind]?.restore, 'COMPONENT_UNAVAILABLE');
    return components[kind].restore(value);
  };
  const optional = (object, key, encode = v => copy(v)) => !Object.hasOwn(object, key) ? { presence: 'absent' } : object[key] === undefined ? { presence: 'undefined' } : { presence: 'value', value: object[key] === null ? null : encode(object[key]) };
  function restoreOptional(target, key, saved, decode = v => copy(v)) {
    check(saved && ['absent','undefined','value'].includes(saved.presence), 'INVALID_CHECKPOINT');
    exact(saved, saved.presence === 'value' ? ['presence','value'] : ['presence']);
    if (saved.presence !== 'absent') Object.defineProperty(target, key, { value: saved.presence === 'undefined' ? undefined : saved.value === null ? null : decode(saved.value), writable: true, enumerable: true, configurable: true });
  }
  function validateDecision(decision, candidate) {
    if(['switch-confirm','switch-select'].includes(decision.kind)){
      const seat=decision.requiredSeats?.[0],active=candidate.continuation?.currentPhase;
      check(decision.requiredSeats?.length===1&&canonical(createPreBattleSwitchDecision(decision.id,candidate,seat,decision.kind))===canonical(decision),
        'INVALID_PRE_BATTLE_SWITCH');
      check(active?.kind==='original-phase'&&active.remaining===decision.kind&&candidate.continuation.standbyPhase===null
        &&phaseState?.isPhase(active.phase),'INVALID_PRE_BATTLE_SWITCH');
      const p=phaseState.capture(active.phase,candidate);
      check(p.scope===seat&&p.type===(decision.kind==='switch-confirm'?'CheckSwitchPhase':'SwitchPhase')
        &&active.phase.fieldIndex===seat&&(decision.kind==='switch-confirm'||active.phase.isModal===false&&active.phase.doReturn===true),
        'INVALID_PRE_BATTLE_SWITCH');return;
    }
    if (safeDecisionKinds.includes(decision.kind)) {
      check(safeDecisions?.validate,'SAFE_DECISION_CODEC_UNAVAILABLE');safeDecisions.validate(decision,candidate);return;
    }
    if (decision.kind === 'wait-switch') {
      exact(decision, ['id','kind','requiredSeats','options','switch']);
      exact(decision.switch, ['outgoing']);
      check(typeof decision.id === 'string' && decision.id.length > 0 && decision.id.length <= 128, 'INVALID_SWITCH_DECISION');
      const expected = createForcedSwitchDecision(decision.id,candidate,decision.requiredSeats);
      check(canonical(expected) === canonical(decision), 'INVALID_SWITCH_DECISION');
      const active=candidate.continuation?.currentPhase;
      if(active?.remaining==='wait-switch')check(candidate.continuation.standbyPhase===null
        &&phaseState?.isPhase(active.phase)&&phaseState.capture(active.phase,candidate).type==='SwitchPhase'
        &&decision.requiredSeats.length===1&&decision.requiredSeats[0]===active.phase.fieldIndex,
        'INVALID_SWITCH_DECISION');
      return;
    }
    if (decision.kind === 'learn-move') {
      exact(decision, ['id','kind','requiredSeats','options','learn']);
      exact(decision.learn, ['pokemonId','moveId']);
      check(typeof decision.id === 'string' && decision.id.length > 0 && decision.id.length <= 128
        && Array.isArray(decision.requiredSeats) && decision.requiredSeats.length === 1, 'INVALID_LEARN_DECISION');
      check(typeof hasMove === 'function', 'MOVE_CATALOG_UNAVAILABLE');
      const expected = createLearnDecision(decision.id,candidate,decision.requiredSeats[0],decision.learn.pokemonId,decision.learn.moveId,hasMove);
      check(canonical(expected) === canonical(decision), 'INVALID_LEARN_DECISION');
      return;
    }
    exact(decision, ['id','kind','requiredSeats','options', ...(decision.kind === 'wait-target' ? ['target'] : [])]);
    check(typeof decision.id === 'string' && decision.id.length > 0 && decision.id.length <= 128 && ['wait-actions','wait-target'].includes(decision.kind), 'UNSUPPORTED_STOP');
    check(Array.isArray(decision.requiredSeats) && decision.requiredSeats.length > 0 && new Set(decision.requiredSeats).size === decision.requiredSeats.length && decision.requiredSeats.every(s => s === 0 || s === 1), 'INVALID_DECISION');
    exact(decision.options, decision.requiredSeats.map(String));
    for (const seat of decision.requiredSeats) {
      const entry = candidate.roster.entries.find(e => e.pokemon.id === candidate.roster.field[seat]);
      check(entry && entry.owner === seat && entry.pokemon.hp > 0, 'INVALID_DECISION');
      const options = decision.options[seat];
      check(Array.isArray(options) && options.length > 0 && options.length <= 10000
        && options.every(o => {
          if (!o || typeof o.kind !== 'string') return false;
          if (o.kind === 'switch') {
            try { exact(o, ['kind', 'pokemonId']); } catch { return false; }
            const target = candidate.roster.entries.find(e => e.pokemon.id === o.pokemonId);
            return target?.owner === seat && target.group === 'party' && target.index > 0
              && target.pokemon.hp > 0 && !candidate.roster.field.includes(target.pokemon.id);
          }
          if (o.kind === 'ball') {
            try { exact(o, ['kind', 'pokeballType', 'targetId']); } catch { return false; }
            const target = candidate.roster.entries.find(e => e.owner === null && e.group === 'enemy'
              && e.pokemon.id === o.targetId);
            return Number.isInteger(o.pokeballType) && o.pokeballType >= 0 && o.pokeballType <= 5
              && target?.pokemon.hp > 0 && candidate.roster.field.includes(target.pokemon.id);
          }
          return o.pokemonId === entry.pokemon.id;
        }), 'INVALID_DECISION');
      check(new Set(options.map(canonical)).size === options.length, 'INVALID_DECISION');
    }
    if (decision.kind === 'wait-target') {
      const t = decision.target; exact(t, ['fieldIndex','pokemonId','moveId','targets']);
      check(decision.requiredSeats.length === 1 && decision.requiredSeats[0] === t.fieldIndex
        && candidate.roster.field[t.fieldIndex] === t.pokemonId, 'INVALID_TARGET_DECISION');
      const command = candidate.battle.turnCommands[t.fieldIndex];
      check(command?.command === 0 && !command.skip && command.move?.move === t.moveId
        && !Object.hasOwn(command, 'targets') && command.move.targets.length === 0, 'INVALID_TARGET_DECISION');
      check(Array.isArray(t.targets) && t.targets.length > 1 && t.targets.length <= 4
        && new Set(t.targets).size === t.targets.length && t.targets.every(n => Number.isInteger(n) && n >= 0 && n <= 3 && candidate.roster.field[n] !== null), 'INVALID_TARGET_DECISION');
      const options = [...t.targets, -1].map(target => ({kind:'target',pokemonId:t.pokemonId,target}));
      check(canonical(options) === canonical(decision.options[t.fieldIndex]), 'INVALID_TARGET_DECISION');
      const active=candidate.continuation?.currentPhase;
      if(active?.remaining==='wait-target')check(candidate.continuation.standbyPhase===null
        &&active.phase.fieldIndex===t.fieldIndex,'INVALID_TARGET_DECISION');
      return;
    }
    const living = [0, 1].filter(seat => candidate.roster.entries.some(e => e.pokemon.id === candidate.roster.field[seat] && e.pokemon.hp > 0) && candidate.battle.turnCommands[seat] === null);
    const active=candidate.continuation?.currentPhase;
    // The original Command UI may be suspended before a later seat's forced
    // action is processed. Reuse its registered M2 remaining stage; only that
    // current, first unfilled seat can supply this serial input boundary.
    if(decision.requiredSeats.length===1&&active?.kind==='original-phase'&&active.remaining==='wait-actions'
      &&candidate.continuation.standbyPhase===null&&phaseState?.isPhase(active.phase)
      &&phaseState.capture(active.phase,candidate).type==='CommandPhase'){
      check(decision.requiredSeats[0]===active.phase.fieldIndex&&active.phase.fieldIndex===living[0], 'INVALID_DECISION');
      return;
    }
    check(canonical([...decision.requiredSeats].sort()) === canonical(living), 'INVALID_DECISION');
  }
  function capture(context) {
    const componentTable = [], componentIds = new Map();
    const encodeComponent = (kind, value) => {
      if (value === null) return null;
      if (componentIds.has(value)) { const index = componentIds.get(value); check(componentTable[index].kind === kind, 'COMPONENT_TYPE_MISMATCH'); return index; }
      const index = componentTable.length; componentIds.set(value, index); componentTable.push({ kind, state: encodeRaw(kind, value) }); return index;
    };
    const withEggs=Object.hasOwn(context,'eggState');
    exact(context, ['roster','battle','arena','scene','players','enemyModifiers','sceneRandom','modifierPools','decision','pendingEffects','continuation',...(withEggs?['eggState']:[])]);
    if(withEggs)check(components?.eggs?.capture&&components?.eggs?.restore,'EGG_CODEC_UNAVAILABLE');
    exact(context.scene,[...sceneFields,'gameMode',...(Object.hasOwn(context.scene,'lastEnemyTrainer')?['lastEnemyTrainer']:[])]);
    for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(context.scene)))check('value'in descriptor,'MODEL_ACCESSOR');
    const encodePhaseGraph=phaseState?.createGraph(),decodePhaseGraph=phaseState?.createGraph();
    const pendingEffects=packPending(context.pendingEffects,context,encodePhaseGraph,decodePhaseGraph);
    validatePending(pendingEffects, context);
    const b = context.battle, a = context.arena;
    check(b!==null||context.decision.kind==='starter-ready','MISSING_BATTLE');
    for (const model of [b, a].filter(Boolean)) for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(model))) check('value' in descriptor, 'MODEL_ACCESSOR');
    check((b===null||Object.getPrototypeOf(b) === Battle.prototype) && Object.getPrototypeOf(a) === Arena.prototype, 'UNSUPPORTED_MODEL');
    if(b)check(Object.keys(b).every(k => battleCheckpointFields.includes(k)), 'UNKNOWN_BATTLE_FIELD');
    check(Object.keys(a).every(k => arenaCheckpointFields.includes(k)), 'UNKNOWN_ARENA_FIELD');
    const savedCommands=b?captureTurnCommands(b.turnCommands):null;
    // Commands and trusted Phase descriptors are data; executable stacks are excluded.
    const snapshot = { version: withEggs?7:6,...(withEggs?{eggState:components.eggs.capture(context.eggState)}:{}), components: componentTable, modifierTypeGroups: [], commandTargetGroups:captureCommandTargetGroups(context),roster: roster.capture(context.roster),
      battle: b===null?null:{ ...Object.fromEntries(battleScalars.map(k => [k, b[k]])), gameMode: b.gameMode.modeId,
        trainer: optional(b, 'trainer', v => encodeComponent('trainer', v)), enemyLevels: copy(b.enemyLevels),
        enemyParty: b.enemyParty.map(p => { check(context.roster.entries.some(e => e.pokemon === p && e.owner === null), 'INVALID_ENEMY_REFERENCE'); return p.id; }),
        seenEnemyPartyMemberIds: [...b.seenEnemyPartyMemberIds], playerParticipantIds: [...b.playerParticipantIds],
        turnCommands: savedCommands, lastMove: optional(b, 'lastMove'),
        postBattleLoot: b.postBattleLoot.map(v => encodeComponent('modifier', v)), random: b.captureRandomState() },
      arena: { ...Object.fromEntries(arenaScalars.map(k => [k, optional(a, k)])),
        weather: optional(a, 'weather', effects.captureWeatherState), terrain: optional(a, 'terrain', effects.captureTerrainState), tags: a.tags.map(effects.captureArenaTagState) },
      scene: { ...copy(Object.fromEntries(sceneFields.map(k=>[k,context.scene[k]]))),gameMode:context.scene.gameMode.modeId,
        lastEnemyTrainer: optional(context.scene,'lastEnemyTrainer',v=>encodeComponent('trainer',v)) }, sceneRandom: context.sceneRandom.capture(), modifierPools: captureModifierPoolState(context.modifierPools),
      enemyModifiers: context.enemyModifiers.map(v => encodeComponent('modifier', v)),
      players: context.players.map(p => { exact(p, ['money','pokeballCounts','modifiers']); return { ...copy({ money: p.money, pokeballCounts: p.pokeballCounts }), modifiers: p.modifiers.map(v => encodeComponent('modifier', v)) }; }),
      decision: copy(context.decision), pendingEffects, continuation: readContinuation(packContinuation(context.continuation,context,encodePhaseGraph,decodePhaseGraph), context) };
    const typeGroups = new Map();
    for (const [value, index] of componentIds) if (componentTable[index].kind === 'modifier') {
      if (!typeGroups.has(value.type)) typeGroups.set(value.type, []);
      typeGroups.get(value.type).push(index);
    }
    snapshot.modifierTypeGroups = [...typeGroups.values()].filter(group => group.length > 1);
    restore(snapshot); return snapshot;
  }
  function restore(input) {
    const s = copy(input);
    check(s?.version === 6||s?.version===7, 'VERSION_MISMATCH');
    exact(s, ['version','components','modifierTypeGroups','commandTargetGroups','roster','battle','arena','scene','sceneRandom','modifierPools','players','enemyModifiers','decision','pendingEffects','continuation',...(s.version===7?['eggState']:[])]);
    check(Array.isArray(s.components) && s.components.length <= 10000, 'INVALID_COMPONENT');
    const decoded = new Map();
    const decodeComponent = (kind, index) => {
      check(uint(index) && index < s.components.length, 'INVALID_COMPONENT_REFERENCE');
      const entry = s.components[index]; exact(entry, ['kind','state']); check(entry.kind === kind, 'COMPONENT_TYPE_MISMATCH');
      if (!decoded.has(index)) decoded.set(index, decodeRaw(kind, entry.state));
      return decoded.get(index);
    };
    if(s.battle!==null)exact(s.battle, [...battleScalars,'gameMode','trainer','enemyLevels','enemyParty','seenEnemyPartyMemberIds','playerParticipantIds','turnCommands','lastMove','postBattleLoot','random']);
    exact(s.arena, [...arenaScalars,'weather','terrain','tags']); exact(s.scene, [...sceneFields,'gameMode','lastEnemyTrainer']);
    check(typeof s.scene.seed === 'string' && typeof s.scene.waveSeed === 'string' && uint(s.scene.waveCycleOffset) && typeof s.scene.offsetGym === 'boolean' && uint(s.scene.score), 'INVALID_SCENE');
    const result = { roster: roster.restore(s.roster), battle: s.battle===null?null:Object.create(Battle.prototype), arena: Object.create(Arena.prototype), scene: Object.fromEntries(sceneFields.map(k=>[k,s.scene[k]])), players: [], enemyModifiers: [], sceneRandom: new SceneRandom(s.sceneRandom), modifierPools: restoreModifierPoolState(s.modifierPools), decision: s.decision, pendingEffects: s.pendingEffects };
    if(s.version===7){check(components?.eggs?.restore,'EGG_CODEC_UNAVAILABLE');result.eggState=components.eggs.restore(s.eggState);}
    result.scene.gameMode=getGameMode(s.scene.gameMode);check(result.scene.gameMode&&result.scene.gameMode.modeId===s.scene.gameMode,'UNKNOWN_GAME_MODE');
    restoreOptional(result.scene,'lastEnemyTrainer',s.scene.lastEnemyTrainer,v=>decodeComponent('trainer',v));
    const b = result.battle, a = result.arena;
    const byId = new Map(result.roster.entries.map(e => [e.pokemon.id, e]));
    if(b){
    for (const k of battleScalars) {
      check(['double','started'].includes(k) ? typeof s.battle[k] === 'boolean' : uint(s.battle[k]), 'INVALID_BATTLE'); b[k] = s.battle[k];
    }
    check(b.waveIndex > 0 && b.battleType <= 2 && b.battleSpec <= 1, 'INVALID_BATTLE');
    b.gameMode = getGameMode(s.battle.gameMode); check(b.gameMode && b.gameMode.modeId === s.battle.gameMode, 'UNKNOWN_GAME_MODE');
    check(b.gameMode===result.scene.gameMode,'GAME_MODE_MISMATCH');
    check(Array.isArray(s.battle.enemyParty) && new Set(s.battle.enemyParty).size === s.battle.enemyParty.length, 'INVALID_ENEMY_REFERENCE');
    b.enemyParty = s.battle.enemyParty.map(id => { check(byId.get(id)?.owner === null, 'INVALID_ENEMY_REFERENCE'); return byId.get(id).pokemon; });
    const enemyIds = result.roster.entries.filter(e => e.owner === null).sort((a,b) => a.index-b.index).map(e => e.pokemon.id);
    check(canonical(enemyIds) === canonical(s.battle.enemyParty), 'INVALID_ENEMY_REFERENCE');
    check(Array.isArray(s.battle.enemyLevels) && s.battle.enemyLevels.length === b.enemyParty.length && s.battle.enemyLevels.every(n => uint(n) && n > 0), 'INVALID_BATTLE'); b.enemyLevels = s.battle.enemyLevels;
    for (const k of ['seenEnemyPartyMemberIds','playerParticipantIds']) {
      const ids = s.battle[k]; check(Array.isArray(ids) && new Set(ids).size === ids.length, 'INVALID_PARTICIPANT');
      // Seen-enemy IDs are historical: capture can move that instance to a
      // player's roster, and a departed instance can be retained as a retired ID.
      check(ids.every(id => k === 'seenEnemyPartyMemberIds' ? byId.has(id) || result.roster.retiredIds.includes(id) : byId.has(id) && byId.get(id).owner !== null || result.roster.retiredIds.includes(id)), 'INVALID_PARTICIPANT'); b[k] = new Set(ids);
    }
    b.turnCommands = restoreTurnCommands(s.battle.turnCommands);
    restoreOptional(b, 'lastMove', s.battle.lastMove, v => { check(uint(v), 'INVALID_MOVE'); return v; });
    restoreOptional(b, 'trainer', s.battle.trainer, v => decodeComponent('trainer', v));
    check(b.battleType !== 1 || b.trainer, 'MISSING_TRAINER');
    check(Array.isArray(s.battle.postBattleLoot), 'INVALID_LOOT'); b.postBattleLoot = s.battle.postBattleLoot.map(v => decodeComponent('modifier', v));
    const random = readBattleRandomCheckpoint(s.battle.random); check(random.turn === b.turn, 'RANDOM_TURN_MISMATCH'); b.battleSeed = random.seed; b.restoreRandomState(random);
    } else check(s.decision.kind==='starter-ready'&&result.roster.field.every(id=>id===null),'MISSING_BATTLE');
    for (const k of arenaScalars) restoreOptional(a, k, s.arena[k]);
    check(uint(a.biomeType) && Number.isSafeInteger(a.lastTimeOfDay) && a.pokemonPool && a.trainerPool && (a.ignoreAbilities === undefined || typeof a.ignoreAbilities === 'boolean'), 'INVALID_ARENA');
    if(arenaPools)arenaPools.validate(a);
    restoreOptional(a, 'weather', s.arena.weather, effects.restoreWeatherState); restoreOptional(a, 'terrain', s.arena.terrain, effects.restoreTerrainState);
    check(Array.isArray(s.arena.tags), 'INVALID_ARENA'); a.tags = s.arena.tags.map(effects.restoreArenaTagState);
    for (const tag of a.tags) check(tag.sourceId == null || byId.has(tag.sourceId) || result.roster.retiredIds.includes(tag.sourceId), 'UNKNOWN_SOURCE');
    check(Array.isArray(s.players) && s.players.length === 2, 'INVALID_PLAYERS');
    result.players = s.players.map((p, seat) => {
      exact(p, ['money','pokeballCounts','modifiers']); check(uint(p.money), 'INVALID_MONEY'); exact(p.pokeballCounts, ['0','1','2','3','4']);
      check(Object.values(p.pokeballCounts).every(uint) && Array.isArray(p.modifiers), 'INVALID_INVENTORY');
      const modifiers = p.modifiers.map(v => decodeComponent('modifier', v));
      for (const m of modifiers) {
        check(m.pokemonId!==null,'INVALID_MODIFIER_OWNER');
        if (m.pokemonId != null && m.pokemonId !== -1) check(byId.get(m.pokemonId)?.owner === seat, 'INVALID_MODIFIER_OWNER');
      }
      return { money: p.money, pokeballCounts: p.pokeballCounts, modifiers };
    });
    check(Array.isArray(s.enemyModifiers), 'INVALID_INVENTORY'); result.enemyModifiers = s.enemyModifiers.map(v => decodeComponent('modifier', v));
    for (const m of result.enemyModifiers) {
      if(m.pokemonId===null)check(b?.postBattleLoot.includes(m),'UNSTAGED_ENEMY_LOOT');
      else if (m.pokemonId != null && m.pokemonId !== -1) check(byId.has(m.pokemonId) && byId.get(m.pokemonId).owner === null, 'INVALID_MODIFIER_OWNER');
    }
    const owners = new Map();
    for (const [owner, modifiers] of [result.players[0].modifiers,result.players[1].modifiers,result.enemyModifiers].entries()) for (const modifier of modifiers) {
      check(!owners.has(modifier) || owners.get(modifier) === owner, 'SHARED_PERSONAL_MODIFIER'); owners.set(modifier, owner);
    }
    check(decoded.size === s.components.length, 'UNUSED_COMPONENT');
    check(Array.isArray(s.modifierTypeGroups), 'INVALID_TYPE_ALIAS');
    const aliased = new Set();
    for (const group of s.modifierTypeGroups) {
      check(Array.isArray(group) && group.length > 1 && typeof components.modifier.captureType === 'function', 'INVALID_TYPE_ALIAS');
      let sharedType, state;
      for (const index of group) {
        check(uint(index) && decoded.has(index) && s.components[index].kind === 'modifier' && !aliased.has(index), 'INVALID_TYPE_ALIAS');
        aliased.add(index);
        const modifier = decoded.get(index), current = canonical(components.modifier.captureType(modifier.type));
        if (state === undefined) { sharedType = modifier.type; state = current; }
        else { check(current === state, 'INVALID_TYPE_ALIAS'); modifier.type = sharedType; }
      }
    }
    restoreCommandTargetGroups(result,s.commandTargetGroups);
    check(canonical(roster.capture(result.roster))===canonical(s.roster),'CONFLICTING_COMMAND_TARGET_ALIAS');
    result.continuation = readContinuation(s.continuation,result);
    validatePending(s.pendingEffects,result);
    const phaseIdentities=new Map();
    const phaseGraph=phaseState?.createGraph();
    const unpackPhase=p=>{
      if(p?.kind!=='original-phase')return p;
      if(!phaseIdentities.has(p.phaseId))phaseIdentities.set(p.phaseId,phaseState.restore(p.phase,result,undefined,phaseGraph));
      return {...p,phase:phaseIdentities.get(p.phaseId)};
    };
    for(const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'])result.continuation[key]=result.continuation[key].map(unpackPhase);
    for(const key of ['currentPhase','standbyPhase'])result.continuation[key]=unpackPhase(result.continuation[key]);
    result.pendingEffects=result.pendingEffects.map(p=>({...p,phase:phaseState.restore(p.phase,result,undefined,phaseGraph)}));
    // A returned battler is temporarily off the field while its original
    // switch command still supplies the onEnd turn-count compensation.
    if(b)for(const slot of [0,1,2,3])if(b.turnCommands[slot]!==null&&result.roster.field[slot]===null){
      const active=result.continuation.currentPhase;
      check(result.decision.kind==='continuing'&&result.decision.reason==='switch'
        &&active?.kind==='original-phase'&&active.remaining==='switch-swap'
        &&s.continuation.currentPhase.phase.type==='SwitchSummonPhase'
        &&(slot<2?active.phase.player&&active.phase.fieldIndex===0&&s.continuation.currentPhase.phase.scope===slot
          :active.phase.player===false&&active.phase.fieldIndex===slot-2),
      'INVALID_COMMAND_OWNER');
    }
    validateDecision(s.decision, result); return result;
  }
  function readContinuation(input, context) {
    return restoreContinuation(input, context.roster, state=>{
      check(phaseState?.restore,'ORIGINAL_PHASE_CODEC_UNAVAILABLE');phaseState.restore(state,context);
    });
  }
  function packContinuation(state,context,encodeGraph,decodeGraph) {
    const objects=new Map();
    const pack=p=>{
      if(p?.kind!=='original-phase')return p;
      check(phaseState,'ORIGINAL_PHASE_CODEC_UNAVAILABLE');
      const supplied=phaseState.isPhase(p.phase)?p.phase:phaseState.restore(p.phase,context,undefined,decodeGraph);
      if(!objects.has(p.phaseId))objects.set(p.phaseId,supplied);
      const phase=objects.get(p.phaseId);
      if(phaseState.isPhase(p.phase))check(phase===p.phase,'CONFLICTING_PHASE_ID');
      else check(canonical(phaseState.capture(phase,context))===canonical(phaseState.capture(supplied,context)),'CONFLICTING_PHASE_ID');
      return {...p,phase:phaseState.capture(phase,context,undefined,encodeGraph)};
    };
    return {...state,phaseQueue:state.phaseQueue.map(pack),phaseQueuePrepend:state.phaseQueuePrepend.map(pack),nextCommandPhaseQueue:state.nextCommandPhaseQueue.map(pack),
      currentPhase:pack(state.currentPhase),standbyPhase:pack(state.standbyPhase)};
  }
  function packPending(pending,context,encodeGraph,decodeGraph) {
    check(Array.isArray(pending),'UNSUPPORTED_PENDING_EFFECTS');
    return pending.map(p=>{
      if(!p?.phase||!phaseState)return p;
      const phase=phaseState.isPhase(p.phase)?p.phase:phaseState.restore(p.phase,context,undefined,decodeGraph);
      return {...p,phase:phaseState.capture(phase,context,undefined,encodeGraph)};
    });
  }
  function validatePending(pending,context) {
    check(Array.isArray(pending)&&pending.length<=1000,'UNSUPPORTED_PENDING_EFFECTS');
    const ids=new Set();
    for(const effect of pending){
      exact(effect,['id','phase','remaining']);
      check(typeof effect.id==='string'&&effect.id.length>0&&effect.id.length<=128&&!ids.has(effect.id),'INVALID_PENDING_EFFECT');ids.add(effect.id);
      readContinuation({phaseQueue:[{kind:'original-phase',phaseId:0,phase:effect.phase,remaining:effect.remaining}],phaseQueuePrepend:[],nextCommandPhaseQueue:[],
        phaseQueuePrependSpliceIndex:-1,currentPhase:null,standbyPhase:null},context);
    }
  }
  return Object.freeze({ capture, restore, validate: input => { restore(input); },
    validateAction(context, seat, action) {
      validateDecision(context.decision, context);
      if(safeDecisionKinds.includes(context.decision.kind)){safeDecisions.validateAction(context,seat,action);return;}
      check(context.decision.requiredSeats.includes(seat) && context.decision.options[seat].some(option => canonical(option) === canonical(action)), 'INVALID_ACTION');
    }
  });
}
