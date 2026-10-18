import { GameData } from '../system/game-data';
import { allSpecies, getPokemonSpecies, speciesStarters } from '../data/pokemon-species';
import { originalOwnedEggStateCodec } from '../original-phase-checkpoints';
import { captureStarterSelection, restoreStarterSelection, validateStarterSelection } from './original-starter-selection';

// Minimal imported-profile bridge. It is an explicit local-mirror import, not
// an authenticated account or a claim that the client owns the original save.
export const PROFILE_VERSION = 2;
const KEYS = ['costs', 'eggs', 'starters', 'trainer', 'unlocks', 'version'];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const isInt = value => Number.isSafeInteger(value);
const exact = (value, keys, code = 'INVALID_PROFILE') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || !keys.every(key => descriptors[key] && descriptors[key].enumerable && 'value' in descriptors[key])) fail(code);
};
const array = (value, min, max, code) => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < min || value.length > max) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) fail(code);
  for (let index = 0; index < value.length; index++)
    if (!descriptors[index] || !descriptors[index].enumerable || !('value' in descriptors[index])) fail(code);
};
const identity = value => {
  exact(value, ['secretId', 'trainerId'], 'INVALID_PROFILE_IDENTITY');
  if (!isInt(value.trainerId) || value.trainerId < 0 || value.trainerId >= 65536
    || !isInt(value.secretId) || value.secretId < 0 || value.secretId >= 65536)
    fail('INVALID_PROFILE_IDENTITY');
};

export function validateProfile(value) {
  exact(value, KEYS);
  if (value.version !== PROFILE_VERSION) fail('INVALID_PROFILE_VERSION');
  identity(value.trainer);
  array(value.starters, 1, 6, 'INVALID_PROFILE_STARTERS');
  array(value.costs, 1, 6, 'INVALID_PROFILE_COSTS');
  if (value.starters.length !== value.costs.length) fail('INVALID_PROFILE_COSTS');
  const starters = value.starters.map(selection => validateStarterSelection(selection));
  if (new Set(starters.map(starter => starter.speciesId)).size !== starters.length) fail('DUPLICATE_STARTER_SPECIES');
  array(value.unlocks, starters.length, starters.length, 'INVALID_PROFILE_UNLOCKS');
  const unlocks = value.unlocks.map((record, index) => {
    exact(record, ['caughtAttr', 'eggMoves', 'ivs', 'natureAttr', 'speciesId'], 'INVALID_PROFILE_UNLOCKS');
    const starter = starters[index], selection = restoreStarterSelection(starter);
    const helper = Object.create(GameData.prototype);
    let mask = 127n;
    for (let form = 0; form < Math.max(selection.species.forms.length, 1); form++) mask |= helper.getFormAttr(form);
    if (record.speciesId !== starter.speciesId || typeof record.caughtAttr !== 'string'
      || record.caughtAttr.length > mask.toString().length || !/^[1-9][0-9]*$/.test(record.caughtAttr))
      fail('INVALID_PROFILE_UNLOCKS');
    const caught = BigInt(record.caughtAttr);
    if ((caught & ~mask) !== 0n || (selection.dexAttr & caught) !== selection.dexAttr) fail('STARTER_NOT_UNLOCKED');
    if (!isInt(record.natureAttr) || record.natureAttr < 0 || record.natureAttr >= 2 ** 26
      || record.natureAttr % 2 !== 0) fail('INVALID_PROFILE_UNLOCKS');
    if (!helper.getNaturesForAttr(record.natureAttr).includes(starter.nature)) fail('STARTER_NATURE_NOT_UNLOCKED');
    array(record.ivs, 6, 6, 'INVALID_PROFILE_UNLOCKS');
    if (record.ivs.some((iv, i) => iv !== starter.ivs[i]) || record.eggMoves !== starter.eggMoves)
      fail('PROFILE_SELECTION_MISMATCH');
    const form = selection.species.forms.length ? selection.species.forms[selection.props.formIndex] : selection.species;
    if (selection.moveset !== undefined && !form.validateStarterMoveset(selection.moveset as any, record.eggMoves))
      fail('INVALID_STARTER_MOVESET');
    return { speciesId: record.speciesId, caughtAttr: record.caughtAttr, natureAttr: record.natureAttr,
      ivs: [...record.ivs], eggMoves: record.eggMoves };
  });
  const species = new Set();
  for (const starter of starters) {
    if (species.has(starter.speciesId)) fail('DUPLICATE_STARTER_SPECIES');
    species.add(starter.speciesId);
    if (!allSpecies.some(entry => entry.speciesId === starter.speciesId)) fail('INVALID_STARTER_SPECIES');
  }
  const costs = value.costs.map((cost, index) => {
    exact(cost, ['caughtCount', 'hatchedCount', 'speciesId'], 'INVALID_PROFILE_COSTS');
    if (cost.speciesId !== starters[index].speciesId || !isInt(cost.caughtCount) || cost.caughtCount < 0
      || !isInt(cost.hatchedCount) || cost.hatchedCount < 0) fail('INVALID_PROFILE_COSTS');
    if (!Object.prototype.hasOwnProperty.call(speciesStarters, cost.speciesId)) fail('UNKNOWN_STARTER_COST');
    return { speciesId: cost.speciesId, caughtCount: cost.caughtCount, hatchedCount: cost.hatchedCount };
  });
  array(value.eggs, 0, 10000, 'INVALID_PROFILE_EGGS');
  const seenEggs = new Set();
  const eggs = value.eggs.map(egg => {
    const restored = originalOwnedEggStateCodec.restore({ players: [[egg], []] });
    const saved = originalOwnedEggStateCodec.capture(restored).players[0][0];
    if (seenEggs.has(saved.id)) fail('DUPLICATE_OWNED_EGG');
    seenEggs.add(saved.id);
    return saved;
  });
  return {
    version: PROFILE_VERSION,
    trainer: { trainerId: value.trainer.trainerId, secretId: value.trainer.secretId },
    starters,
    unlocks,
    costs,
    eggs,
  };
}

/** Capture only the identity, selected starters, cost counters, and egg mirror. */
export function captureProfile(gameData, starters) {
  array(starters, 1, 6, 'INVALID_PROFILE_STARTERS');
  if (!gameData || !isInt(gameData.trainerId) || gameData.trainerId < 0 || gameData.trainerId >= 65536
    || !isInt(gameData.secretId) || gameData.secretId < 0 || gameData.secretId >= 65536)
    fail('INVALID_PROFILE_IDENTITY');
  const seen = new Set();
  const selections = starters.map(starter => {
    if (!starter || !starter.species || seen.has(starter.species.speciesId)) fail('DUPLICATE_STARTER_SPECIES');
    const speciesId = starter.species.speciesId;
    seen.add(speciesId);
    const entry = gameData.dexData?.[speciesId];
    if (!entry || !Array.isArray(entry.ivs) || entry.ivs.length !== 6) fail('MISSING_DEX_RECORD');
    if (typeof entry.caughtAttr !== 'bigint' || !isInt(entry.natureAttr)) fail('MISSING_DEX_RECORD');
    // Existing caught attributes are the original selector's eligibility source.
    if ((starter.dexAttr & entry.caughtAttr) !== starter.dexAttr) fail('STARTER_NOT_UNLOCKED');
    const natures = GameData.prototype.getNaturesForAttr.call(Object.create(GameData.prototype), entry.natureAttr);
    if (!natures.includes(starter.nature)) fail('STARTER_NATURE_NOT_UNLOCKED');
    const root = starter.species.getRootSpeciesId();
    if (!Object.prototype.hasOwnProperty.call(gameData.starterEggMoveData ?? {}, root)) fail('MISSING_EGG_MOVE_RECORD');
    const eggMoves = gameData.starterEggMoveData[root];
    if (!isInt(eggMoves) || eggMoves < 0) fail('INVALID_STARTER_EGG_MOVES');
    if (!isInt(entry.caughtCount) || entry.caughtCount < 0
      || !isInt(entry.hatchedCount) || entry.hatchedCount < 0) fail('MISSING_DEX_RECORD');
    return {
      starter: captureStarterSelection(starter, entry.ivs, eggMoves),
      unlock: { speciesId, caughtAttr: entry.caughtAttr.toString(), natureAttr: entry.natureAttr,
        ivs: [...entry.ivs], eggMoves },
      cost: { speciesId, caughtCount: entry.caughtCount, hatchedCount: entry.hatchedCount },
    };
  });
  if (!Array.isArray(gameData.eggs)) fail('INVALID_PROFILE_EGGS');
  const eggs = originalOwnedEggStateCodec.capture({ players: [gameData.eggs, []] }).players[0];
  return validateProfile({
    version: PROFILE_VERSION,
    trainer: { trainerId: gameData.trainerId, secretId: gameData.secretId },
    starters: selections.map(entry => entry.starter),
    unlocks: selections.map(entry => entry.unlock),
    costs: selections.map(entry => entry.cost),
    eggs,
  });
}

export function restoreProfile(value) {
  const normalized = validateProfile(value);
  return {
    trainer: normalized.trainer,
    starters: normalized.starters.map(restoreStarterSelection),
    unlocks: normalized.unlocks,
    costs: normalized.costs.map(entry => ({ ...entry })),
    eggs: originalOwnedEggStateCodec.restore({ players: [normalized.eggs, []] }).players[0],
  };
}

/** Original getSpeciesStarterValue over the imported counters; preserves fractions. */
export function priceProfile(value) {
  const normalized = validateProfile(value);
  const view = Object.create(GameData.prototype);
  view.dexData = Object.fromEntries(normalized.costs.map(cost => [cost.speciesId,
    { caughtCount: cost.caughtCount, hatchedCount: cost.hatchedCount }]));
  let total = 0;
  const starters = normalized.starters.map((starter, index) => {
    const cost = GameData.prototype.getSpeciesStarterValue.call(view, starter.speciesId);
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) fail('INVALID_STARTER_COST');
    total += cost;
    return { speciesId: starter.speciesId, cost };
  });
  return { version: PROFILE_VERSION, starters, total };
}
