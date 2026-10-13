import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createEffectStateCodec, effectStateFields } from '../src/battle-core/effect-state.mjs';
import { nextBattleRandomInt, readBattleRandomCheckpoint } from '../src/battle-core/random.mjs';

const read = file => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
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
const wire = value => JSON.parse(JSON.stringify(value));
function roundtrip(value, capture, restore) {
  const snapshot = capture(value), restored = restore(wire(snapshot));
  assert.equal(Object.getPrototypeOf(restored), Object.getPrototypeOf(value));
  assert.deepEqual(capture(restored), snapshot);
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(value).sort());
  return restored;
}

test('field manifest covers every original effect class, including inherited and private state', () => {
  const classes = new Map();
  for (const file of ['data/battler-tags.ts', 'data/arena-tag.ts', 'data/status-effect.ts', 'data/weather.ts', 'data/terrain.ts']) {
    for (const cls of parse(file).statements.filter(ts.isClassDeclaration)) classes.set(cls.name.text, cls);
  }
  function fields(name) {
    const cls = classes.get(name);
    const parent = cls.heritageClauses?.find(c => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0].expression.getText();
    return [...(parent ? fields(parent) : []), ...cls.members.filter(ts.isPropertyDeclaration).map(m => m.name.getText())];
  }
  assert.equal(classes.size, Object.keys(effectStateFields).length);
  for (const name of classes.keys()) assert.deepEqual(Object.keys(effectStateFields[name]).sort(), fields(name).sort(), name);
});

test('all 44 original battler tag types preserve fields and original prototypes over JSON', () => {
  assert.equal(Object.values(battlerTypes.BattlerTagType).length, 44);
  for (const type of Object.values(battlerTypes.BattlerTagType)) {
    const tag = battler.getBattlerTag(type, 3, moves.Moves.TACKLE, 4294967295);
    if (type === 'SEEDED' || type === 'SALT_CURED') tag.sourceIndex = 2;
    if (type === 'ENCORE') tag.moveId = moves.Moves.SURF;
    if (type === 'PROTOSYNTHESIS' || type === 'QUARK_DRIVE') {
      tag.stat = stats.Stat.SPD; tag.multiplier = 1.5;
    }
    tag.turnCount = 2;
    const restored = roundtrip(tag, battler.captureBattlerTagState, battler.restoreBattlerTagState);
    assert.equal(restored.isSourceLinked(), tag.isSourceLinked());
    assert.equal(restored.getDescriptor(), tag.getDescriptor());
  }
});

test('all 10 original arena tag types preserve source, side, layers and delayed targets', () => {
  const supported = Object.values(arenaTypes.ArenaTagType).filter(type => type !== 'NONE');
  assert.equal(supported.length, 10);
  for (const type of supported) for (const side of [0, 1, 2]) {
    const tag = arena.getArenaTag(type, 4, moves.Moves.FUTURE_SIGHT, 123, 3, side);
    if (tag.layers) tag.layers = tag.maxLayers;
    if (type === 'TOXIC_SPIKES') tag.neutralized = true;
    tag.turnCount = 2;
    roundtrip(tag, arena.captureArenaTagState, arena.restoreArenaTagState);
  }
});

test('restored original seeded, encore and ability tags continue with the same effects', () => {
  function run(tag) {
    const events = [];
    const scene = { queueMessage: (...args) => events.push(['message', ...args]),
      unshiftPhase: phase => events.push(['phase', phase.args.slice(1)]),
      getField: () => [null, null, { hp: 50 }],
      getPokemonById: () => ({ getBattlerIndex: () => 2 }) };
    const pokemon = { id: 12, name: 'test', scene, hp: 48, getBattlerIndex: () => 0,
      getOpponents: () => [{ hp: 50, getBattlerIndex: () => 2 }],
      getMaxHp: () => 48, damageAndUpdate: damage => { events.push(['damage', damage]); return damage; } };
    const result = tag.lapse(pokemon, battler.BattlerTagLapseType.TURN_END);
    return wire({ result, events, state: battler.captureBattlerTagState(tag) });
  }
  const tag = battler.getBattlerTag('SEEDED', 2, moves.Moves.LEECH_SEED, 123);
  tag.sourceIndex = 2;
  const restored = battler.restoreBattlerTagState(wire(battler.captureBattlerTagState(tag)));
  assert.deepEqual(run(restored), run(tag));
  const encore = battler.getBattlerTag('ENCORE', 3, moves.Moves.ENCORE, 123);
  encore.moveId = moves.Moves.SURF;
  assert.equal(battler.restoreBattlerTagState(wire(battler.captureBattlerTagState(encore))).moveId, moves.Moves.SURF);
  const boost = battler.getBattlerTag('PROTOSYNTHESIS', 1, undefined, undefined);
  boost.stat = stats.Stat.SPD; boost.multiplier = 1.5;
  const restoredBoost = roundtrip(boost, battler.captureBattlerTagState, battler.restoreBattlerTagState);
  assert.equal(restoredBoost.multiplier, 1.5);
  restoredBoost.weatherTypes.push(0);
  assert.notDeepEqual(restoredBoost.weatherTypes, boost.weatherTypes);
});

test('restored original delayed attack and stacked spikes produce identical continuation', () => {
  function lapse(tag) {
    const events = [];
    const fakeArena = { scene: { unshiftPhase: phase => events.push(wire(phase.args.slice(1))) } };
    const remaining = [tag.lapse(fakeArena), tag.lapse(fakeArena)];
    return { remaining, events, state: arena.captureArenaTagState(tag) };
  }
  const delayed = arena.getArenaTag('FUTURE_SIGHT', 3, moves.Moves.FUTURE_SIGHT, 20, 3, 2);
  delayed.turnCount = 2;
  const restored = arena.restoreArenaTagState(wire(arena.captureArenaTagState(delayed)));
  assert.deepEqual(lapse(restored), lapse(delayed));
  assert.equal(delayed.turnCount, 0);
  const spikes = arena.getArenaTag('SPIKES', 0, moves.Moves.SPIKES, 20, undefined, 2);
  spikes.layers = 3;
  function activate(tag) {
    const events = [];
    tag.activateTrap({ name: 'target', isGrounded: () => true, getMaxHp: () => 100,
      scene: { queueMessage: text => events.push(text) }, damageAndUpdate: damage => events.push(damage) });
    return events;
  }
  assert.deepEqual(activate(arena.restoreArenaTagState(wire(arena.captureArenaTagState(spikes)))), activate(spikes));
  assert.equal(activate(spikes).at(-1), 25);
});

test('status cure timing, weather and terrain duration survive JSON and retain their methods', () => {
  for (const [value, capture, restore, act] of [
    [new status.Status(status.StatusEffect.SLEEP, 2, 4), status.captureStatusState, status.restoreStatusState, 'incrementTurn'],
    [new status.Status(status.StatusEffect.TOXIC, 5), status.captureStatusState, status.restoreStatusState, 'incrementTurn'],
    [new weather.Weather(weather.WeatherType.RAIN, 3), weather.captureWeatherState, weather.restoreWeatherState, 'lapse'],
    [new terrain.Terrain(terrain.TerrainType.GRASSY, 0), terrain.captureTerrainState, terrain.restoreTerrainState, 'lapse']
  ]) {
    const restored = roundtrip(value, capture, restore);
    for (let i = 0; i < 5; i++) {
      assert.equal(restored[act](), value[act]());
      assert.deepEqual(capture(restored), capture(value));
    }
  }
});

test('restore invokes no constructor, accessor, onAdd or random source and does not depend on class names', () => {
  let sideEffects = 0;
  class MinifiedClass {
    constructor() { sideEffects++; throw Error('Constructor must not run'); }
    set effect(_) { sideEffects++; }
    onAdd() { sideEffects++; }
  }
  const codec = createEffectStateCodec({ Status: MinifiedClass });
  const snapshot = status.captureStatusState(new status.Status(4, 2, 5));
  const restored = codec.restore(wire(snapshot));
  assert.ok(restored instanceof MinifiedClass);
  assert.equal(restored.effect, 4);
  assert.equal(sideEffects, 0);
  assert.deepEqual(codec.capture(restored), snapshot);
});

test('unknown fields, class mismatches, missing fields and corrupt payloads fail closed', () => {
  const tag = battler.getBattlerTag('CONFUSED', 3, moves.Moves.CONFUSE_RAY, 1);
  const original = battler.captureBattlerTagState(tag);
  for (const change of [
    s => { s.version = 2; }, s => { s.type = 'Pokemon'; }, s => { s.fields.tagType = 'ENCORE'; },
    s => { delete s.fields.turnCount; }, s => { s.fields.turnCount = NaN; }, s => { s.fields.turnCount = Infinity; },
    s => { s.fields.turnCount = 1.5; }, s => { s.fields.scene = {}; }, s => { s.fields.lapseType = 7; },
    s => { s.undefinedFields = ['sourceId', 'sourceId']; }, s => { s.fields.sourceId = null; },
    s => { s.undefinedFields.extra = true; }, s => { s.undefinedFields = new Array(1); },
    s => { s.fields = JSON.parse('{"__proto__":{}}'); },
    s => { Object.defineProperty(s.fields, 'turnCount', { get() { throw Error('getter called'); } }); }
  ]) {
    const snapshot = wire(original); change(snapshot);
    assert.throws(() => battler.restoreBattlerTagState(snapshot), /Invalid original effect checkpoint/);
    assert.deepEqual(battler.captureBattlerTagState(tag), original);
  }
  tag.newMechanic = 1;
  assert.throws(() => battler.captureBattlerTagState(tag), /unknown/);
  delete tag.newMechanic;
  tag[Symbol('unknown')] = true;
  assert.throws(() => battler.captureBattlerTagState(tag), /property/);
});

function battleMethods() {
  const cls = parse('battle.ts').statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'Battle');
  const names = ['randSeedInt', 'captureRandomState', 'restoreRandomState', 'incrementTurn'];
  return evaluate(`const {nextBattleRandomInt, readBattleRandomCheckpoint}=require('random');
    const {BattlerIndex, Utils}=require('enums');
    export class Battle { ${cls.members.filter(n => names.includes(n.name?.getText())).map(n => n.getText()).join('\n')} }`, {
    random: { nextBattleRandomInt, readBattleRandomCheckpoint },
    enums: { ...battleIndices, Utils: { getEnumValues: obj => Object.values(obj).filter(v => typeof v === 'number') } }
  }).Battle;
}
const Battle = battleMethods();
function makeBattle(seed = 'battle', turn = 3) {
  return Object.assign(new Battle(), { battleSeed: seed, turn, battleSeedState: null });
}

test('actual Battle resumes its exact random stream; null checkpoints retain lazy initialization', () => {
  for (const draws of [0, 1, 200]) {
    const uninterrupted = makeBattle(), resumed = makeBattle();
    for (let i = 0; i < draws; i++) uninterrupted.randSeedInt(65536);
    const snapshot = uninterrupted.captureRandomState();
    assert.equal(snapshot.state === null, draws === 0);
    resumed.restoreRandomState(wire(snapshot));
    for (let i = 0; i < 100; i++) {
      assert.equal(resumed.randSeedInt(65536), uninterrupted.randSeedInt(65536));
      assert.deepEqual(resumed.captureRandomState(), uninterrupted.captureRandomState());
    }
  }
});

test('wrong battle, old turn and corrupt random checkpoints cannot partially overwrite Battle', () => {
  const battle = makeBattle(); battle.randSeedInt(100);
  const before = battle.captureRandomState();
  for (const change of [
    s => { s.seed = 'another room'; }, s => { s.turn++; }, s => { s.turn = -1; }, s => { s.version = 2; },
    s => { s.state = '!rnd,1,NaN,0,0'; }, s => { s.state = '!rnd,1,1,0,0'; },
    s => { s.state = '!rnd,1,0,0'; }, s => { s.state = '!rnd,99999999,0,0,0'; },
    s => { s.state = '!rnd,1,,0,0'; }, s => { s.state = ['room seed']; }, s => { s.extra = 1; }
  ]) {
    const snapshot = wire(before); change(snapshot);
    assert.throws(() => battle.restoreRandomState(snapshot), /checkpoint/);
    assert.deepEqual(battle.captureRandomState(), before);
  }
  battle.incrementTurn();
  assert.equal(battle.captureRandomState().state, null);
  assert.throws(() => battle.restoreRandomState(before), /another seed or turn/);
});

test('effect checkpoint code runs without DOM, Phaser globals, clock or unseeded randomness', () => {
  assert.equal(typeof globalThis.Phaser, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const originalRandom = Math.random, originalNow = Date.now;
  try {
    Math.random = Date.now = () => { throw Error('Nondeterministic checkpoint'); };
    for (const type of Object.values(battlerTypes.BattlerTagType)) {
      const tag = battler.getBattlerTag(type, 3, moves.Moves.TACKLE, 1);
      roundtrip(tag, battler.captureBattlerTagState, battler.restoreBattlerTagState);
    }
  } finally {
    Math.random = originalRandom; Date.now = originalNow;
  }
});
