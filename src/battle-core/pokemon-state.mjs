// Original Pokemon rule-state slice, NOT a whole scene or a renderable Container.
// Constructors, setters, init(), recalculation and effect hooks never run here.
const base = {
  id: 'uint32', species: 'species', formIndex: 'uint', abilityIndex: 'abilityIndex', shiny: 'bool', pokeball: 'ball',
  level: 'positive', exp: 'uint', levelExp: 'uint', gender: 'gender', hp: 'uint', stats: 'stats', ivs: 'ivs',
  nature: 'nature', moveset: 'moves', status: '?status', friendship: 'uint', metLevel: 'positive', metBiome: 'int',
  pauseEvolutions: '?bool', pokerus: 'bool', fusionSpecies: '?species', fusionFormIndex: '?uint',
  fusionAbilityIndex: '?abilityIndex', fusionShiny: '?bool', fusionGender: '?gender',
  summonDataPrimer: '?PokemonSummonData', summonData: '?PokemonSummonData', battleData: '?PokemonBattleData',
  battleSummonData: '?PokemonBattleSummonData', turnData: '?PokemonTurnData', fieldPosition: '?fieldPosition'
};
export const pokemonStateFields = Object.freeze({
  Pokemon: Object.freeze(base),
  PlayerPokemon: Object.freeze({ compatibleTms: 'moveIds' }),
  EnemyPokemon: Object.freeze({ trainerSlot: 'trainerSlot', aiType: 'aiType', bossSegments: '?uint', bossSegmentIndex: '?bossIndex' }),
  PokemonMove: Object.freeze({ moveId: 'moveId', ppUsed: 'uint', ppUp: 'int', virtual: 'bool' }),
  PokemonSummonData: Object.freeze({ battleStats: 'stages', moveQueue: 'queue', disabledMove: 'moveId', disabledTurns: 'uint', tags: 'tags', speciesForm: '?form', fusionSpeciesForm: '?form', ability: 'ability', gender: '?gender', fusionGender: '?gender', stats: '?stats', moveset: '?moves', types: '?types' }),
  PokemonBattleData: Object.freeze({ hitCount: 'uint', revived: 'bool', maxRevived: 'bool' }),
  PokemonBattleSummonData: Object.freeze({ turnCount: 'uint', moveHistory: 'history' }),
  PokemonTurnData: Object.freeze({ flinched: '?bool', hitCount: '?uint', hitsLeft: '?remainingHits', damageDealt: 'int', attacksReceived: 'attacks' }),
  TurnMove: Object.freeze({ move: 'moveId', targets: '?targets', result: 'moveResult', virtual: '?bool', turn: '?uint' }),
  QueuedMove: Object.freeze({ move: 'moveId', targets: 'targets', ignorePP: '?bool' }),
  AttackMoveResult: Object.freeze({ move: 'moveId', result: 'hitResult', damage: 'int', critical: 'bool', sourceId: 'uint32' })
});
// These declared fields are display state. Other Container-owned fields are also
// excluded; an AST coverage test guards every Pokemon declaration, including private.
export const pokemonPresentationFields = Object.freeze(['name', 'battleInfo', 'maskEnabled', 'maskSprite', 'shinySparkle']);
const has = (v, key) => Object.hasOwn(v, key);
const fail = path => { throw new TypeError(`Invalid original Pokemon checkpoint: ${path}`); };
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  return Object.getOwnPropertyDescriptors(value);
}
function data(value, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !has(descriptor, 'value') || !descriptor.enumerable) fail(path);
  return descriptor.value;
}
function keys(value, expected, path) {
  const descriptors = object(value, path);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string') || Object.keys(descriptors).sort().join(',') !== [...expected].sort().join(',')) fail(path);
  for (const key of expected) data(value, key, path);
}
function array(value, path, max = 10000) {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail(path);
  return Array.from({ length: value.length }, (_, index) => data(value, String(index), path));
}
function integer(value, min, max, path) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(typeof value==='number'?`${path} (${String(value)})`:path);
  return value;
}
function assignOwn(target, key, value) {
  for (let proto = Object.getPrototypeOf(target); proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor && !has(descriptor, 'value')) fail(`accessor ${key}`);
  }
  Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: true });
}

// Preserve mutable aliases (e.g. a summon primer sharing moves/tags), rather than
// silently turning one runtime object into two diverging copies after JSON.
const catalogFields = new Set(['species', 'fusionSpecies', 'speciesForm', 'fusionSpeciesForm']);
export function pokemonRuleNodes(pokemon) {
  return graph(pokemon, Object.keys({ ...base, ...pokemonStateFields.PlayerPokemon, ...pokemonStateFields.EnemyPokemon })).nodes;
}
export const equivalentPokemonRuleNodes = (a, b) => equivalent(a, b);
function graph(root, rootFields) {
  const nodes = new Map(), seen = new Map(), active = new Set(), aliases = [];
  function walk(node, path) {
    if (!node || typeof node !== 'object') return;
    if (active.has(node)) fail('cyclic rule state');
    const key = JSON.stringify(path); nodes.set(key, node);
    if (seen.has(node)) { aliases.push({ from: path, to: seen.get(node) }); return; }
    seen.set(node, path); active.add(node);
    const names = path.length ? Object.keys(node) : rootFields.filter(name => has(node, name));
    for (const name of names) if (!catalogFields.has(name)) walk(data(node, name, 'graph'), [...path, name]);
    active.delete(node);
  }
  walk(root, []); return { nodes, aliases };
}
function equivalent(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, index) => key === bk[index] && equivalent(data(a, key, key), data(b, key, key)));
}

/** All functions/prototypes/catalog entries are trusted imports, never wire data. */
export function createPokemonStateCodec({ constructors, getSpecies, getMove, getAbility, captureTag, restoreTag, captureStatus, restoreStatus, allowNegativePpUp }) {
  const schemas = { ...pokemonStateFields, PlayerPokemon: { ...base, ...pokemonStateFields.PlayerPokemon }, EnemyPokemon: { ...base, ...pokemonStateFields.EnemyPokemon } };
  const prototypes = new Map();
  for (const [type, ctor] of Object.entries(constructors)) {
    if (!has(schemas, type) || typeof ctor !== 'function' || !ctor.prototype) fail('registry');
    prototypes.set(ctor.prototype, type);
  }
  const plainTypes = new Set(['TurnMove', 'QueuedMove', 'AttackMoveResult']);
  function species(id) {
    integer(id, 1, Number.MAX_SAFE_INTEGER, 'species id');
    const result = getSpecies(id);
    if (!result || result.speciesId !== id) fail('unknown species');
    return result;
  }
  function form(id, index) {
    const root = species(id); integer(index, 0, Number.MAX_SAFE_INTEGER, 'form index');
    if (root.forms?.length) { if (index >= root.forms.length) fail('unknown form'); return root.forms[index]; }
    if (index !== 0) fail('unknown form');
    return root;
  }
  function value(input, rule, restoring, path) {
    if (rule.startsWith('?')) { if (input === undefined || input === null) return input; rule = rule.slice(1); }
    // Original MoveEffectPhase.end decrements an uninitialized counter when
    // an override (e.g. failed Focus Punch) ends before hit initialization.
    // Preserve that exact NaN sentinel through JSON; never coerce it to zero.
    if(rule==='remainingHits'){
      if(!restoring&&Number.isNaN(input))return {nan:true};
      if(restoring&&input&&typeof input==='object'){
        keys(input,['nan'],path);if(input.nan!==true)fail(path);return NaN;
      }
      return integer(input,Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,path);
    }
    const ranges = { int: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], uint: [0, Number.MAX_SAFE_INTEGER], positive: [1, Number.MAX_SAFE_INTEGER], uint32: [0, 4294967295], gender: [-1, 1], ball: [0, 5], nature: [0, 24], abilityIndex: [0, 2], bossIndex: [-1, Number.MAX_SAFE_INTEGER], fieldPosition: [0, 2], trainerSlot: [0, 2], aiType: [0, 2], moveResult: [0, 4], hitResult: [1, 10] };
    if (ranges[rule]) return integer(input, ...ranges[rule], path);
    if (rule === 'bool') { if (typeof input !== 'boolean') fail(path); return input; }
    if (rule === 'moveId' || rule === 'ability') {
      integer(input, 0, Number.MAX_SAFE_INTEGER, path);
      if (!(rule === 'moveId' ? getMove(input) : getAbility(input))) fail(path);
      return input;
    }
    if (rule === 'species') {
      const id = restoring ? input : data(input, 'speciesId', path), root = species(id);
      if (!restoring && input !== root) fail('foreign species reference');
      return restoring ? root : id;
    }
    if (rule === 'form') {
      if (restoring) keys(input, ['speciesId', 'formIndex', 'base'], path);
      const id = data(input, 'speciesId', path), index = data(input, 'formIndex', path);
      const root = species(id), isBase = restoring ? data(input, 'base', path) : input === root;
      if (typeof isBase !== 'boolean') fail(path);
      const reference = isBase ? root : form(id, index);
      if (reference.formIndex !== index || !restoring && input !== reference) fail('foreign form reference');
      return restoring ? reference : { speciesId: id, formIndex: index, base: isBase };
    }
    if (rule === 'status') return restoring ? restoreStatus(input) : captureStatus(input);
    if (rule === 'nullableMove') return input === null ? null : restoring ? restoreRecord(input, 'PokemonMove') : captureRecord(input, 'PokemonMove');
    if (rule === 'tags') return array(input, path, 128).map(tag => restoring ? restoreTag(tag) : captureTag(tag));
    // Original transferSummon iterates BattleStat.RAND as well, writing an
    // explicit undefined at index 7. Preserve that own slot (not a sparse hole)
    // instead of trimming it or silently converting it to null through JSON.
    if (rule === 'stages') {
      const list = array(input, path, 8);
      if (list.length !== 7 && list.length !== 8) fail(path);
      return list.map((stage, index) => {
        if (index < 7) return integer(stage, -6, 6, path);
        if (restoring) { keys(stage, ['undefined'], path); if (stage.undefined !== true) fail(path); return undefined; }
        if (stage !== undefined) fail(path);
        return { undefined: true };
      });
    }
    if (has(schemas, rule)) return restoring ? restoreRecord(input, rule) : captureRecord(input, rule);
    const lists = { moves: ['nullableMove', 4], queue: ['QueuedMove', 10000], history: ['TurnMove', 100000], attacks: ['AttackMoveResult', 10000], moveIds: ['moveId', 10000], stats: ['uint', 6], ivs: ['uint', 6], targets: ['int', 4], types: ['int', 2] };
    if (!has(lists, rule)) fail(`schema ${rule}`);
    const [itemRule, max] = lists[rule], list = array(input, path, max);
    if (['stats', 'ivs', 'stages'].includes(rule) && list.length !== max) fail(path);
    return list.map(entry => {
      const result = value(entry, itemRule, restoring, path);
      if (rule === 'ivs') integer(result, 0, 31, path);
      if (rule === 'stages') integer(result, -6, 6, path);
      if (rule === 'targets') integer(result, -1, 3, path);
      if (rule === 'types') integer(result, -1, 18, path);
      return result;
    });
  }
  function verify(values, type) {
    if(type==='PokemonMove'&&values.ppUp<0&&allowNegativePpUp?.(values.moveId,values.ppUp)!==true)fail('ppUp');
    if (type === 'PlayerPokemon' || type === 'EnemyPokemon') {
      const root = values.species; form(root.speciesId, values.formIndex);
      if (values.hp > values.stats[0]) fail('hp exceeds maximum');
      if (values.fusionSpecies) form(values.fusionSpecies.speciesId, values.fusionFormIndex);
      if (values.bossSegments && (!Number.isSafeInteger(values.bossSegmentIndex) || values.bossSegmentIndex >= values.bossSegments)) fail('boss segment');
    }
  }
  function captureRecord(source, type) {
    const schema = schemas[type]; if (!schema) fail('type');
    if (!plainTypes.has(type) && prototypes.get(Object.getPrototypeOf(source)) !== type) fail('unregistered prototype');
    const descriptors = object(source, type), fields = {}, undefinedFields = [];
    if (type !== 'PlayerPokemon' && type !== 'EnemyPokemon' && Reflect.ownKeys(descriptors).some(key => !has(schema, key))) fail(`unknown field ${type}`);
    for (const [key, rule] of Object.entries(schema)) {
      if (!has(descriptors, key)) { if (!rule.startsWith('?')) fail(`missing ${type}.${key}`); continue; }
      const encoded = value(data(source, key, key), rule, false, key);
      if (encoded === undefined) undefinedFields.push(key); else fields[key] = encoded;
    }
    const snapshot = { type, fields, undefinedFields };
    restoreRecord(snapshot, type); // Validate cross-field relationships before publishing.
    return snapshot;
  }
  function restoreRecord(snapshot, expectedType) {
    keys(snapshot, ['type', 'fields', 'undefinedFields'], 'record');
    const { type, fields, undefinedFields } = snapshot;
    if (type !== expectedType || !has(schemas, type)) fail('record type');
    const schema = schemas[type], descriptors = object(fields, 'fields');
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !has(schema, key))) fail('unknown field');
    const unset = new Set(array(undefinedFields, 'undefined fields', Object.keys(schema).length));
    if (unset.size !== undefinedFields.length) fail('duplicate undefined');
    for (const key of unset) if (typeof key !== 'string' || !has(schema, key) || !schema[key].startsWith('?') || has(descriptors, key)) fail('undefined field');
    const values = {};
    for (const [key, rule] of Object.entries(schema)) {
      if (has(descriptors, key)) {
        const input = data(fields, key, key); if (input === undefined) fail('undefined must be explicit');
        values[key] = value(input, rule, true, key);
      } else if (unset.has(key)) values[key] = undefined;
      else if (!rule.startsWith('?')) fail(`missing ${type}.${key}`);
    }
    verify(values, type);
    const prototype = plainTypes.has(type) ? Object.prototype : constructors[type]?.prototype;
    if (!prototype) fail('missing constructor registry');
    const candidate = Object.create(prototype);
    for (const [key, field] of Object.entries(values)) assignOwn(candidate, key, field);
    return candidate;
  }
  return Object.freeze({
    captureMove: move => captureRecord(move, 'PokemonMove'),
    restoreMove: snapshot => restoreRecord(snapshot, 'PokemonMove'),
    capture(pokemon) {
      const type = prototypes.get(Object.getPrototypeOf(pokemon));
      if (!['PlayerPokemon', 'EnemyPokemon'].includes(type)) fail('Pokemon type');
      const { aliases } = graph(pokemon, Object.keys(schemas[type]));
      return { version: 2, ...captureRecord(pokemon, type), aliases };
    },
    restore(snapshot) {
      keys(snapshot, ['version', 'type', 'fields', 'undefinedFields', 'aliases'], 'envelope');
      if (snapshot.version !== 2 || !['PlayerPokemon', 'EnemyPokemon'].includes(snapshot.type)) fail('version/type');
      const candidate = restoreRecord({ type: snapshot.type, fields: snapshot.fields, undefinedFields: snapshot.undefinedFields }, snapshot.type);
      const { nodes } = graph(candidate, Object.keys(schemas[snapshot.type])), order = [...nodes.keys()], used = new Set();
      for (const alias of array(snapshot.aliases, 'aliases')) {
        keys(alias, ['from', 'to'], 'alias');
        const from = array(alias.from, 'alias path', 32), to = array(alias.to, 'alias target', 32);
        if (!from.length || !to.length || [...from, ...to].some(k => typeof k !== 'string')) fail('alias path');
        const sourceKey = JSON.stringify(from), targetKey = JSON.stringify(to);
        if (!nodes.has(sourceKey) || !nodes.has(targetKey) || used.has(sourceKey) || order.indexOf(targetKey) >= order.indexOf(sourceKey)
          || to.every((part, index) => from[index] === part) || from.every((part, index) => to[index] === part)) fail('alias reference');
        const locate = path => path.reduce((node, key) => data(node, key, 'alias'), candidate);
        const target = locate(to), source = locate(from);
        if (!equivalent(source, target)) fail('alias mismatch');
        assignOwn(locate(from.slice(0, -1)), from.at(-1), target); used.add(sourceKey);
      }
      return candidate;
    }
  });
}
