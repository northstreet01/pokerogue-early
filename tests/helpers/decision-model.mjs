import ts from 'typescript';
import { parse, evaluate, pokemon, originalPokemon, arena, weather, terrain } from './original-model.mjs';
import { createRosterStateCodec } from '../../src/battle-core/roster-state.mjs';
import { createDecisionStateCodec, SceneRandom } from '../../src/battle-core/decision-state.mjs';
import { createRegisteredStateCodec } from '../../src/battle-core/registered-state.mjs';
import { RandomDataGenerator, nextBattleRandomInt, readBattleRandomCheckpoint } from '../../src/battle-core/random.mjs';
import { copy, requireContract as check } from '../../src/battle-core/coop-contract.mjs';

const classes = (file, names) => parse(file).statements.filter(n => ts.isClassDeclaration(n) && names.includes(n.name.text)).map(n => n.getText()).join('\n');
export const Battle = evaluate(`import { nextBattleRandomInt, readBattleRandomCheckpoint } from 'random'; ${classes('battle.ts', ['Battle'])}`, { random: { nextBattleRandomInt, readBattleRandomCheckpoint } }).default;
export const Arena = evaluate(classes('field/arena.ts', ['Arena'])).Arena;
const modifiers = evaluate(classes('modifier/modifier.ts', ['Modifier','PersistentModifier','ExpBoosterModifier']));
const types = { exp: { id: 'exp' } }, modes = { 0: { modeId: 0 } };
export const Trainer = evaluate(`const Phaser = { GameObjects: { Container: class { constructor() { throw Error('render constructor'); } } } }; ${classes('field/trainer.ts', ['Trainer'])}`).default;
const config = { partyTemplates: [{ size: 2 }] };
const stringField = { capture: copy, restore: v => { check(typeof v === 'string'); return v; } };
export const trainerCodec = createRegisteredStateCodec({ trainer: { prototype: Trainer.prototype, fields: {
  config: { capture: v => { check(v === config); return 'fixture-trainer'; }, restore: id => { check(id === 'fixture-trainer'); return config; } },
  variant: { capture: copy, restore: v => { check(Number.isInteger(v) && v >= 0 && v <= 2); return v; } },
  partyTemplateIndex: { capture: copy, restore: v => { check(v === 0); return v; } }, name: stringField, partnerName: stringField
} } });
export const initialTrainer = () => Object.assign(Object.create(Trainer.prototype), { config, variant: 0, partyTemplateIndex: 0, name: 'test', partnerName: '' });
const scalar = { capture: copy, restore: v => { check(typeof v === 'number' && Number.isFinite(v) && v >= 0, 'INVALID_COMPONENT'); return v; } };
export const modifierCodec = createRegisteredStateCodec({ exp: { prototype: modifiers.ExpBoosterModifier.prototype, fields: {
  type: { capture: v => { check(v === types.exp); return 'exp'; }, restore: id => { check(id === 'exp'); return types.exp; } },
  stackCount: scalar, virtualStackCount: scalar, boostMultiplier: scalar
} } });
export const codec = createDecisionStateCodec({ roster: createRosterStateCodec(pokemon), effects: { ...arena, ...weather, ...terrain }, Battle, Arena, getGameMode: id => modes[id], components: { modifier: modifierCodec } });
export const trainerDecisionCodec = createDecisionStateCodec({ roster: createRosterStateCodec(pokemon), effects: { ...arena, ...weather, ...terrain }, Battle, Arena, getGameMode: id => modes[id], components: { modifier: modifierCodec, trainer: trainerCodec } });
export function initialDecision(seed = 'room-seed') {
  const entries = [0,1,2].map(i => ({ owner: i < 2 ? i : null, group: i < 2 ? 'party' : 'enemy', index: 0, pokemon: originalPokemon(100+i, i === 2) }));
  const battle = Object.create(Battle.prototype);
  Object.assign(battle, { gameMode: modes[0], waveIndex: 1, battleType: 0, battleSpec: 0, trainer: null, enemyLevels: [5], enemyParty: [entries[2].pokemon], seenEnemyPartyMemberIds: new Set([102]), double: true, started: true, turn: 1, turnCommands: { '-1':null, 0:null, 1:null, 2:null, 3:null }, playerParticipantIds: new Set([100,101]), battleScore: 0, postBattleLoot: [], escapeAttempts: 0, battleSeed: seed, battleSeedState: null });
  const field = Object.create(Arena.prototype); Object.assign(field, { biomeType: 0, tags: [arena.getArenaTag('SPIKES', 0, 33, 100, undefined, 2)], weather: new weather.Weather(1, 3), terrain: new terrain.Terrain(1, 2), ignoreAbilities: false, lastTimeOfDay: 0, pokemonPool: { 0: [1,4,7] }, trainerPool: { 0: [1] } });
  const modifier = new modifiers.ExpBoosterModifier(types.exp, 20, 2); modifier.virtualStackCount = 1;
  return { roster: { entries, field: [100,101,102,null], retiredIds: [] }, battle, arena: field,
    scene: { seed, waveSeed: seed+'-wave', waveCycleOffset: 0, offsetGym: false, score: 0 },
    players: [0,1].map(i => ({ money: 100+i, pokeballCounts: { 0:100,1:0,2:0,3:0,4:0 }, modifiers: i === 0 ? [modifier] : [] })), enemyModifiers: [],
    sceneRandom: new SceneRandom(new RandomDataGenerator([seed]).state()),
    decision: { id: 'decision-1', kind: 'wait-actions', requiredSeats: [0,1], options: { 0:[{kind:'test-continue',pokemonId:100}], 1:[{kind:'test-continue',pokemonId:101}] } }, pendingEffects: [] };
}
export function continueDecision(ctx) {
  const rolls = [ctx.battle.randSeedInt(100), ctx.sceneRandom.integer(100)];
  const boosted = { value: 100 }; ctx.players[0].modifiers[0].apply([boosted]);
  ctx.roster.entries[0].pokemon.heal(rolls[0] % 3);
  ctx.players[0].money -= 1; ctx.players[1].pokeballCounts[0] -= 1;
  ctx.battle.turn++; ctx.battle.battleSeedState = null;
  ctx.decision.id = `decision-${ctx.battle.turn}`;
  return { rolls, boosted: boosted.value };
}
