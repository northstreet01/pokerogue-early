// This is a component checkpoint, not a complete battle/save format. Class IDs
// are explicit: constructor.name changes when the browser build is minified.
const battlerFields = {
  tagType: 'string', lapseType: 'int', turnCount: 'int', sourceMove: '?int', sourceId: '?int'
};
const arenaFields = {
  tagType: 'string', turnCount: 'int', sourceMove: 'int', sourceId: '?int', side: 'int'
};
const definitions = {};
function define(name, parent, fields = {}) {
  definitions[name] = Object.freeze({ ...parent, ...fields });
  return definitions[name];
}
const battler = define('BattlerTag', battlerFields);
for (const name of ['RechargingTag', 'TrappedTag', 'FlinchedTag', 'ConfusedTag', 'InfatuatedTag',
  'NightmareTag', 'FrenzyTag', 'HelpingHandTag', 'IngrainTag', 'AquaRingTag', 'DrowsyTag',
  'ProtectedTag', 'ContactPoisonProtectedTag', 'ContactBurnProtectedTag', 'EnduringTag',
  'PerishSongTag', 'HideSpriteTag', 'CritBoostTag', 'IgnoreAccuracyTag']) define(name, battler);
define('SeedTag', battler, { sourceIndex: '?int' });
define('SaltCuredTag', battler, { sourceIndex: '?int' });
define('EncoreTag', battler, { moveId: '?int' });
const trap = define('DamagingTrapTag', battler, { commonAnim: 'int' });
for (const name of ['BindTag', 'WrapTag', 'VortexTrapTag', 'FireSpinTag', 'WhirlpoolTag',
  'ClampTag', 'SandTombTag', 'MagmaStormTag', 'ThunderCageTag']) define(name, trap);
define('ContactStatChangeProtectedTag', battler, { stat: 'int', levels: 'int' });
const ability = define('AbilityBattlerTag', battler, { ability: 'int' });
define('TruantTag', ability);
define('SlowStartTag', ability);
const highestStat = define('HighestStatBoostTag', ability, { stat: '?int', multiplier: '?number' });
define('WeatherHighestStatBoostTag', highestStat, { weatherTypes: 'int[]' });
define('TerrainHighestStatBoostTag', highestStat, { terrainTypes: 'int[]' });
define('TypeBoostTag', battler, { boostedType: 'int' });

const arena = define('ArenaTag', arenaFields);
for (const name of ['MistTag', 'TrickRoomTag', 'GravityTag']) define(name, arena);
const weaken = define('WeakenMoveTypeTag', arena, { weakenedType: 'int' });
define('MudSportTag', weaken);
define('WaterSportTag', weaken);
const arenaTrap = define('ArenaTrapTag', arena, { layers: 'int', maxLayers: 'int' });
define('SpikesTag', arenaTrap);
define('ToxicSpikesTag', arenaTrap, { neutralized: 'boolean' });
define('StealthRockTag', arenaTrap);
define('DelayedAttackTag', arena, { targetIndex: 'int' });
define('Status', {}, { effect: 'int', turnCount: 'int', cureTurn: '?int' });
define('Weather', {}, { weatherType: 'int', turnsLeft: 'int' });
define('Terrain', {}, { terrainType: 'int', turnsLeft: 'int' });

export const effectStateFields = Object.freeze(definitions);
const tagClasses = {
  NONE: 'BattlerTag', NO_CRIT: 'BattlerTag', BYPASS_SLEEP: 'BattlerTag', IGNORE_FLYING: 'BattlerTag',
  RECHARGING: 'RechargingTag', TRAPPED: 'TrappedTag', FLINCHED: 'FlinchedTag', CONFUSED: 'ConfusedTag',
  INFATUATED: 'InfatuatedTag', SEEDED: 'SeedTag', NIGHTMARE: 'NightmareTag', FRENZY: 'FrenzyTag',
  ENCORE: 'EncoreTag', HELPING_HAND: 'HelpingHandTag', INGRAIN: 'IngrainTag', AQUA_RING: 'AquaRingTag',
  DROWSY: 'DrowsyTag', BIND: 'BindTag', WRAP: 'WrapTag', FIRE_SPIN: 'FireSpinTag', WHIRLPOOL: 'WhirlpoolTag',
  CLAMP: 'ClampTag', SAND_TOMB: 'SandTombTag', MAGMA_STORM: 'MagmaStormTag', THUNDER_CAGE: 'ThunderCageTag',
  PROTECTED: 'ProtectedTag', KINGS_SHIELD: 'ContactStatChangeProtectedTag', OBSTRUCT: 'ContactStatChangeProtectedTag',
  SILK_TRAP: 'ContactStatChangeProtectedTag', BANEFUL_BUNKER: 'ContactPoisonProtectedTag', BURNING_BULWARK: 'ContactBurnProtectedTag',
  ENDURING: 'EnduringTag', PERISH_SONG: 'PerishSongTag', TRUANT: 'TruantTag', SLOW_START: 'SlowStartTag',
  PROTOSYNTHESIS: 'WeatherHighestStatBoostTag', QUARK_DRIVE: 'TerrainHighestStatBoostTag',
  FLYING: 'HideSpriteTag', UNDERGROUND: 'HideSpriteTag', HIDDEN: 'HideSpriteTag', FIRE_BOOST: 'TypeBoostTag',
  CRIT_BOOST: 'CritBoostTag', IGNORE_ACCURACY: 'IgnoreAccuracyTag', SALT_CURED: 'SaltCuredTag',
  MIST: 'MistTag', MUD_SPORT: 'MudSportTag', WATER_SPORT: 'WaterSportTag', SPIKES: 'SpikesTag',
  TOXIC_SPIKES: 'ToxicSpikesTag', FUTURE_SIGHT: 'DelayedAttackTag', DOOM_DESIRE: 'DelayedAttackTag',
  STEALTH_ROCK: 'StealthRockTag', TRICK_ROOM: 'TrickRoomTag', GRAVITY: 'GravityTag'
};
const has = (object, key) => Object.hasOwn(object, key);
function fail(path) { throw new TypeError(`Invalid original effect checkpoint: ${path}`); }

// Reject accessors and unknown properties instead of invoking code or silently
// losing new state when an original class gains another field.
function ownData(object, path, plain = false) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail(path);
  if (plain && Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null) fail(path);
  const descriptors = Object.getOwnPropertyDescriptors(object);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !has(descriptors[key], 'value') || !descriptors[key].enumerable) fail(`${path}.property`);
  }
  return descriptors;
}

function denseArray(value, limit, path) {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) fail(path);
  return Array.from({ length: value.length }, (_, index) => {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !has(entry, 'value') || !entry.enumerable) fail(path);
    return entry.value;
  });
}

function copyValue(value, rule, path) {
  const optional = rule.startsWith('?');
  if (value === undefined && optional) return undefined;
  const type = optional ? rule.slice(1) : rule;
  if (type === 'int[]') {
    return denseArray(value, 32, path).map((entry, index) => copyValue(entry, 'int', `${path}[${index}]`));
  }
  if (type === 'int' ? !Number.isSafeInteger(value)
    : type === 'number' ? typeof value !== 'number' || !Number.isFinite(value)
    : typeof value !== type) fail(path);
  return value;
}

/** Trusted original constructors supply prototypes, never executable wire data. */
export function createEffectStateCodec(constructors) {
  const byType = new Map(), byPrototype = new Map();
  for (const [type, ctor] of Object.entries(constructors)) {
    if (!has(definitions, type) || typeof ctor !== 'function' || !ctor.prototype) fail(`registry.${type}`);
    if (byPrototype.has(ctor.prototype)) fail(`duplicate prototype.${type}`);
    byType.set(type, ctor.prototype);
    byPrototype.set(ctor.prototype, type);
  }

  function readFields(type, fields, undefinedFields) {
    const schema = definitions[type], descriptors = ownData(fields, 'fields', true);
    const unset = new Set();
    for (const key of denseArray(undefinedFields, Object.keys(schema).length, 'undefinedFields')) {
      if (typeof key !== 'string' || !has(schema, key) || !schema[key].startsWith('?') || unset.has(key) || has(descriptors, key)) fail('undefinedFields');
      unset.add(key);
    }
    const values = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!has(schema, key) || descriptor.value === undefined) fail(`fields.${key}`);
      values[key] = copyValue(descriptor.value, schema[key], key);
    }
    for (const [key, rule] of Object.entries(schema)) {
      if (!rule.startsWith('?') && !has(values, key)) fail(`missing ${type}.${key}`);
      if (unset.has(key)) values[key] = undefined;
    }
    if (has(schema, 'tagType') && (!has(tagClasses, values.tagType) || tagClasses[values.tagType] !== type)) fail('tagType/class');
    for (const [key, max] of [['lapseType', 5], ['side', 2], ['effect', 7], ['weatherType', 8], ['terrainType', 4]]) {
      if (has(values, key) && (values[key] < 0 || values[key] > max)) fail(key);
    }
    return values;
  }

  return Object.freeze({
    capture(effect) {
      const descriptors = ownData(effect, 'effect');
      const type = byPrototype.get(Object.getPrototypeOf(effect));
      if (!type) fail('unregistered prototype');
      const schema = definitions[type], fields = {}, undefinedFields = [];
      for (const key of Object.keys(descriptors).sort()) {
        if (!has(schema, key)) fail(`unknown ${type}.${key}`);
        const value = copyValue(descriptors[key].value, schema[key], key);
        if (value === undefined) undefinedFields.push(key);
        else fields[key] = value;
      }
      readFields(type, fields, undefinedFields);
      return { version: 1, type, fields, undefinedFields };
    },
    restore(snapshot) {
      const descriptors = ownData(snapshot, 'snapshot', true);
      if (Object.keys(descriptors).sort().join(',') !== 'fields,type,undefinedFields,version') fail('envelope');
      const { version, type, fields, undefinedFields } = snapshot;
      if (version !== 1 || !byType.has(type)) fail('version/type');
      const values = readFields(type, fields, undefinedFields);
      const effect = Object.create(byType.get(type));
      for (const [key, value] of Object.entries(values)) {
        Object.defineProperty(effect, key, { value, writable: true, enumerable: true, configurable: true });
      }
      return effect;
    }
  });
}
