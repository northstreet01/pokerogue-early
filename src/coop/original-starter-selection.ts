import { GameData, DexAttr } from '../system/game-data';
import PokemonSpecies, { getPokemonSpecies, allSpecies } from '../data/pokemon-species';
import { allMoves } from '../data/move';
import { speciesEggMoves } from '../data/egg-moves';
import { Gender } from '../data/gender';

// Internal selection format, independent of room-envelope / egg-inventory versions.
// v2 carries the owner's root-species egg-move unlock mask. v1 is rejected rather
// than guessing unlocks or silently dropping a legitimate selected egg move.
export const STARTER_SELECTION_VERSION = 2;
const KEYS = ['dexAttr', 'eggMoves', 'ivs', 'moveset', 'nature', 'pokerus', 'speciesId', 'version'];
function fail(code) { throw Object.assign(new Error(code), { code }); }
const isInt = value => Number.isSafeInteger(value);

function exact(value, keys) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail('INVALID_STARTER_SELECTION');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || !keys.every(key => descriptors[key] && descriptors[key].enumerable && 'value' in descriptors[key]))
    fail('INVALID_STARTER_SELECTION');
}
function array(value, minimum, maximum, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimum || value.length > maximum) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) fail(code);
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail(code);
  }
}
function formHelper() { return Object.create(GameData.prototype); }
function formMask(species) {
  const helper = formHelper(); let mask = 0n;
  for (let form = 0; form < Math.max(species.forms.length, 1); form++) mask |= helper.getFormAttr(form);
  return mask;
}
const flagGroups = [[DexAttr.NON_SHINY, DexAttr.SHINY], [DexAttr.MALE, DexAttr.FEMALE],
  [DexAttr.ABILITY_1, DexAttr.ABILITY_2, DexAttr.ABILITY_HIDDEN]];
const flagMask = flagGroups.flat().reduce((mask, bit) => mask | bit, 0n);
export function starterDexAttrProps(species: PokemonSpecies, dexAttr: bigint) {
  if (typeof dexAttr !== 'bigint' || dexAttr <= 0n) fail('INVALID_STARTER_DEX_ATTR');
  const forms = formMask(species), selectedForm = dexAttr & forms;
  if (!selectedForm || (selectedForm & (selectedForm - 1n)) !== 0n || (dexAttr & ~(forms | flagMask)) !== 0n
    || flagGroups.some(group => group.filter(bit => (dexAttr & bit) !== 0n).length !== 1))
    fail('INVALID_STARTER_DEX_ATTR');
  // Validate the single selection first; decode only with the original getter.
  return formHelper().getSpeciesDexAttrProps(species, dexAttr);
}
export function validateStarterSelection(value) {
  exact(value, KEYS);
  if (value.version !== STARTER_SELECTION_VERSION) fail('INVALID_STARTER_SELECTION');
  if (!isInt(value.speciesId) || !allSpecies.some(species => species.speciesId === value.speciesId))
    fail('INVALID_STARTER_SPECIES');
  const species = getPokemonSpecies(value.speciesId);
  const maximumAttr = formMask(species) | flagMask;
  if (typeof value.dexAttr !== 'string' || value.dexAttr.length > maximumAttr.toString().length
    || !/^[1-9][0-9]*$/.test(value.dexAttr)) fail('INVALID_STARTER_DEX_ATTR');
  const dexAttr = BigInt(value.dexAttr);
  starterDexAttrProps(species, dexAttr);
  if (!isInt(value.nature) || value.nature < 0 || value.nature >= 25) fail('INVALID_STARTER_NATURE');
  array(value.ivs, 6, 6, 'INVALID_STARTER_IVS');
  if (!value.ivs.every(iv => isInt(iv) && iv >= 0 && iv <= 31)) fail('INVALID_STARTER_IVS');
  if (typeof value.pokerus !== 'boolean') fail('INVALID_STARTER_POKERUS');
  const eggCount = (speciesEggMoves[species.getRootSpeciesId()] ?? []).length;
  if (!isInt(value.eggMoves) || value.eggMoves < 0 || value.eggMoves >= 2 ** eggCount)
    fail('INVALID_STARTER_EGG_MOVES');
  if (value.moveset !== null) {
    array(value.moveset, 1, 4, 'INVALID_STARTER_MOVESET');
    if (new Set(value.moveset).size !== value.moveset.length || value.moveset.some(move =>
      !isInt(move) || move <= 0 || !allMoves[move] || allMoves[move].id !== move)) fail('INVALID_STARTER_MOVESET');
  }
  return { version: STARTER_SELECTION_VERSION, speciesId: value.speciesId, dexAttr: value.dexAttr,
    nature: value.nature, moveset: value.moveset === null ? null : [...value.moveset], pokerus: value.pokerus,
    ivs: [...value.ivs], eggMoves: value.eggMoves };
}

/** Caller supplies its actual per-root-species unlock mask, including explicit 0. */
export function captureStarterSelection(starter, ivs, eggMoves) {
  exact(starter, ['species', 'dexAttr', 'nature', 'pokerus',
    ...(starter && Object.prototype.hasOwnProperty.call(starter, 'moveset') ? ['moveset'] : [])]);
  if (!allSpecies.includes(starter.species)) fail('INVALID_STARTER_SPECIES');
  if (typeof starter.dexAttr !== 'bigint') fail('INVALID_STARTER_DEX_ATTR');
  if (typeof starter.pokerus !== 'boolean') fail('INVALID_STARTER_POKERUS');
  // Preserve optional undefined, reject null/false and never coerce them to defaults.
  const moveset = starter.moveset === undefined ? null : starter.moveset;
  if (starter.moveset === null) fail('INVALID_STARTER_MOVESET');
  return validateStarterSelection({ version: STARTER_SELECTION_VERSION, speciesId: starter.species.speciesId,
    dexAttr: starter.dexAttr.toString(), nature: starter.nature, moveset, pokerus: starter.pokerus, ivs, eggMoves });
}
export function restoreStarterSelection(value) {
  const normalized = validateStarterSelection(value);
  const species = getPokemonSpecies(normalized.speciesId), dexAttr = BigInt(normalized.dexAttr);
  return { species, dexAttr, props: starterDexAttrProps(species, dexAttr), nature: normalized.nature,
    moveset: normalized.moveset === null ? undefined : [...normalized.moveset],
    pokerus: normalized.pokerus, ivs: [...normalized.ivs], eggMoves: normalized.eggMoves };
}
export function starterGender(selection) {
  if (selection.species.malePercent === null) return Gender.GENDERLESS;
  return selection.props.female ? Gender.FEMALE : Gender.MALE;
}
export function starterFormIndex(selection) {
  return Math.min(selection.props.formIndex, Math.max(selection.species.forms.length - 1, 0));
}
export { DexAttr };
