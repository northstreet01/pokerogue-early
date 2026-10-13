

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createEffectStateCodec, effectStateFields } from '../../src/battle-core/effect-state.mjs';
import { nextBattleRandomInt, readBattleRandomCheckpoint } from '../../src/battle-core/random.mjs';
import { createPokemonStateCodec } from '../../src/battle-core/pokemon-state.mjs';

const read = file => fs.readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');
const parse = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
function evaluate(source, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS
  } }).outputText, { exports, require: name => {
    if (!Object.hasOwn(dependencies, name)) throw Error(`Unmocked browser dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
}
function enums(file, names) {
  return evaluate(parse(file).statements.filter(n => ts.isEnumDeclaration(n) && names.includes(n.name.text)).map(n => n.getText()).join('\n'));
}
const effectModule = { createEffectStateCodec };
const moves = enums('data/enums/moves.ts', ['Moves']);
const types = enums('data/type.ts', ['Type']);
const commonAnim = enums('data/battle-anims.ts', ['CommonAnim']);
const abilities = enums('data/ability.ts', ['Abilities']);
const stats = enums('data/pokemon-stat.ts', ['Stat']);
const battleStats = enums('data/battle-stat.ts', ['BattleStat']);
const battlerTypes = enums('data/enums/battler-tag-type.ts', ['BattlerTagType']);
const arenaTypes = enums('data/enums/arena-tag-type.ts', ['ArenaTagType']);
const battleIndices = enums('battle.ts', ['BattlerIndex']);
class Phase { constructor(...args) { this.args = args; } }
class Holder { constructor(value) { this.value = value; } }
const utils = { IntegerHolder: Holder, NumberHolder: Holder, BooleanHolder: Holder };
const pokemonEnums = enums('field/pokemon.ts', ['HitResult', 'MoveResult']);
const allMoves = new Proxy([], { get: (_, id) => ({ name: `Move ${id}`, pp: 20 }) });
const messages = { getPokemonMessage: (pokemon, suffix) => `${pokemon.name}${suffix}` };
const status = evaluate(read('data/status-effect.ts'), { '../utils': utils, '../battle-core/effect-state.mjs': effectModule });
const terrain = evaluate(read('data/terrain.ts'), {
  './type': types, '../utils': utils, './ability': {}, '../battle-core/effect-state.mjs': effectModule
});
const weather = evaluate(read('data/weather.ts'), {
  './enums/biome': {}, '../messages': messages, './type': types, '../utils': utils,
  './ability': {}, './move': {}, './terrain': terrain, '../battle-core/effect-state.mjs': effectModule
});
const phases = Object.fromEntries(['CommonAnimPhase', 'MoveEffectPhase', 'MovePhase', 'PokemonHealPhase',
  'ShowAbilityPhase', 'StatChangePhase'].map(name => [name, Phase]));
const battler = evaluate(read('data/battler-tags.ts'), {
  './battle-anims': { ...commonAnim, CommonBattleAnim: class { play() {} } }, '../phases': phases,
  '../messages': messages, '../field/pokemon': pokemonEnums, './pokemon-stat': stats,
  './status-effect': status, '../utils': utils, './enums/moves': moves, './move': { allMoves },
  './type': types, './ability': abilities, './enums/battler-tag-type': battlerTypes,
  './terrain': terrain, './weather': weather, './battle-stat': battleStats, '../battle-core/effect-state.mjs': effectModule
});
const arena = evaluate(read('data/arena-tag.ts'), {
  './type': types, '../utils': utils, './move': { allMoves }, '../messages': messages,
  '../field/pokemon': { ...pokemonEnums, PokemonMove: class { constructor(moveId) { this.moveId = moveId; } } },
  '../phases': phases, './status-effect': status, '../battle': battleIndices, './enums/moves': moves,
  './enums/arena-tag-type': arenaTypes, '../battle-core/effect-state.mjs': effectModule
});

// Catalog fixtures exercise reference identity, not catalog/content compatibility.
// All executed Pokemon methods below are the actual source, unmodified.
const species = new Map([1, 4, 7].map(id => [id, { speciesId: id, formIndex: 0, forms: [], baseExp: 64 }]));
species.get(4).forms = [{ speciesId: 4, formIndex: 0 }, { speciesId: 4, formIndex: 1 }];
const moveCatalog = { 0: { id: 0, pp: -1 }, 33: { id: 33, pp: 35 }, 57: { id: 57, pp: 15 } };
const abilityCatalog = { 0: { id: 0 }, 1: { id: 1 } };
const dependencies = Object.fromEntries(parse('field/pokemon.ts').statements.filter(ts.isImportDeclaration).map(n => [n.moduleSpecifier.text, {}]));
Object.assign(dependencies, {
  phaser: { default: { GameObjects: { Container: class { constructor() { throw Error('Renderer constructor called'); } } } } },
  '../data/enums/moves': moves, '../data/ability': { ...abilities, allAbilities: abilityCatalog },
  '../data/move': { allMoves: moveCatalog }, '../data/pokemon-stat': stats,
  '../data/pokemon-species': { getPokemonSpecies: id => species.get(id) },
  '../data/status-effect': status, '../data/battler-tags': battler,
  '../data/enums/battler-tag-type': battlerTypes,
  '../battle-core/pokemon-state.mjs': { createPokemonStateCodec }
});
const pokemon = evaluate(read('field/pokemon.ts'), dependencies);
export { read, parse, evaluate, pokemon, species, moveCatalog, status, battler, arena, moves, weather, terrain };

export function originalPokemon(id = 100, enemy = false) {
  const p = Object.create((enemy ? pokemon.EnemyPokemon : pokemon.PlayerPokemon).prototype);
  Object.assign(p, { id, species: species.get(1), formIndex: 0, abilityIndex: 0, shiny: false, pokeball: 0,
    level: 5, exp: 135, levelExp: 10, gender: 0, hp: 17, stats: [30, 12, 13, 14, 15, 16], ivs: [31, 0, 10, 20, 30, 15], nature: 0,
    moveset: [new pokemon.PokemonMove(33, 2, 1, false), new pokemon.PokemonMove(57, 1, 3, true)],
    status: new status.Status(2, 3, undefined), friendship: 70, metLevel: 5, metBiome: -1, pauseEvolutions: false, pokerus: false,
    fusionSpecies: species.get(4), fusionFormIndex: 1, fusionAbilityIndex: 1, fusionShiny: true, fusionGender: 1,
    summonData: new pokemon.PokemonSummonData(), battleData: new pokemon.PokemonBattleData(),
    battleSummonData: new pokemon.PokemonBattleSummonData(), turnData: new pokemon.PokemonTurnData(), fieldPosition: 1 });
  p.summonData.speciesForm = species.get(4).forms[1]; p.summonData.fusionSpeciesForm = species.get(7);
  p.summonData.battleStats = [-6, -2, 0, 1, 2, 3, 6];
  p.summonData.moveQueue = [{ move: 57, targets: [2, 3], ignorePP: true }];
  p.summonData.disabledMove = 33; p.summonData.disabledTurns = 2;
  p.summonData.tags = [battler.getBattlerTag('ENCORE', 3, 33, id)]; p.summonData.tags[0].moveId = 57;
  p.summonData.types = [10, 18]; p.summonData.moveset = [new pokemon.PokemonMove(57, 3, 2, true)];
  p.summonData.gender = undefined; p.summonData.fusionGender = null;
  p.battleSummonData.moveHistory = [{ move: 33, targets: [2], result: 1, turn: 2, virtual: false }];
  p.turnData.attacksReceived = [{ move: 33, result: 1, damage: 8, critical: true, sourceId: id }];
  p.turnData.hitCount = 2; p.turnData.hitsLeft = 1; p.turnData.flinched = false;
  if (enemy) Object.assign(p, { trainerSlot: 0, aiType: 1, bossSegments: 3, bossSegmentIndex: 1 });
  else p.compatibleTms = [33, 57];
  return p;
}
