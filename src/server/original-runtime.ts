// Full early imports, never source snippets or a fixture catalogue. This entry
// is built separately for Node with a strict display-only boundary.
import BattleScene from '../battle-scene';
import Pokemon, { PlayerPokemon, EnemyPokemon, capturePokemonState, restorePokemonState } from '../field/pokemon';
import { allSpecies, getPokemonSpecies } from '../data/pokemon-species';
import { allMoves } from '../data/move';
import { allAbilities } from '../data/ability';
import { gameModes, GameModes } from '../game-mode';
import { TrainerSlot } from '../data/trainer-config';
import { Arena } from '../field/arena';
import { Biome } from '../data/enums/biome';
import { originalDecisionStateCodec } from '../original-phase-checkpoints';
import { SceneRandom } from '../battle-core/decision-state.mjs';
import { RandomDataGenerator } from '../battle-core/random.mjs';
import { createModifierPoolState } from '../battle-core/modifier-pool-state.mjs';
import { withOriginalRules } from '../../server/original-random-context.mjs';
import { openNativeBattle, stepNativeEntry, openNativeBattleToInput, validateNativeAction, submitNativeActions,
  openNativePreparation, chooseNativePreparation, nextNativeBattle, chooseNativeSwitch, runNativeUntilBoundary,
  validateNativePreparation, validateNativeSwitch, validateNativeCheckpoint, validateNativeEggs, projectNativeSnapshot } from './native-entry';

export { originalDecisionStateCodec, capturePokemonState, restorePokemonState };

// This method only allocates a sparkle sprite/animation. Preserve the original
// shiny roll and flag; presentation will be driven by committed server events.
Pokemon.prototype.initShinySparkle = function () {};

export function createOriginalRuntime(seed: string, identity: { trainerId: number; secretId: number }, randomState?: string) {
  if (typeof seed !== 'string' || !seed.length || seed.length > 256) throw new Error('INVALID_ROOM_SEED');
  if (!identity || ![identity.trainerId, identity.secretId].every(id => Number.isInteger(id) && id >= 0 && id < 65536))
    throw new Error('INVALID_TRAINER_IDENTITY');
  const scene = new BattleScene();
  const context = {
    sceneRandom: new SceneRandom(new RandomDataGenerator([seed]).state()),
    modifierPools: createModifierPoolState()
  };
  Object.assign(scene, {
    gameMode: gameModes[GameModes.CLASSIC], score: 0, money: 0,
    modifiers: [], enemyModifiers: [], party: [], currentBattle: null
  });
  // Construction needs identity for original shiny rules. Do not construct
  // GameData here: it reads browser settings and owns permanent save writes.
  Object.assign(scene, { gameData: { trainerId: identity.trainerId, secretId: identity.secretId } });
  withOriginalRules(context, () => {
    scene.setSeed(seed);
    scene.arena = new Arena(scene, Biome.TOWN, 'town');
  });
  if (randomState !== undefined) context.sceneRandom = new SceneRandom(randomState);
  return { scene, context };
}

export function constructOriginalPokemon(runtime: ReturnType<typeof createOriginalRuntime>, speciesId: number, level: number, enemy = false) {
  if (!Number.isSafeInteger(speciesId) || !allSpecies.some(species => species.speciesId === speciesId)
    || !Number.isSafeInteger(level) || level < 1) throw new Error('INVALID_POKEMON_SELECTION');
  return withOriginalRules(runtime.context, () => {
    const species = getPokemonSpecies(speciesId);
    // init() is a display attachment and is intentionally not called here.
    // All original constructor rules (IVs, nature, moves, stats, forms, etc.) run.
    return enemy
      ? new EnemyPokemon(runtime.scene, species, level, TrainerSlot.NONE, false, undefined)
      : new PlayerPokemon(runtime.scene, species, level, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
  });
}

export function describeOriginalCatalogs() {
  // Initialises via the original scene constructor, exactly as the game does.
  new BattleScene();
  return {
    species: allSpecies.map(species => ({ id: species.speciesId, obtainable: species.isObtainable() })),
    moves: allMoves.filter(Boolean).map(move => move.id),
    abilities: allAbilities.filter(Boolean).map(ability => ability.id)
  };
}

export async function executeRuntimeOperation(runtime: ReturnType<typeof createOriginalRuntime>, operation: string, payload: any) {
  if (operation === 'native-start') return openNativeBattle(runtime, payload);
  if (operation === 'native-step') return stepNativeEntry(runtime, payload);
  if (operation === 'native-run-to-boundary') return runNativeUntilBoundary(runtime, payload);
  if (operation === 'native-open-to-input') return openNativeBattleToInput(runtime, payload);
  if (operation === 'native-validate') return validateNativeAction(runtime, payload);
  if (operation === 'native-submit') return submitNativeActions(runtime, payload);
  if (operation === 'native-preparation') return openNativePreparation(runtime, payload);
  if (operation === 'native-prepare-action') return chooseNativePreparation(runtime, payload);
  if (operation === 'native-next') return nextNativeBattle(runtime, payload);
  if (operation === 'native-switch') return chooseNativeSwitch(runtime, payload);
  if (operation === 'native-validate-preparation') return validateNativePreparation(runtime, payload);
  if (operation === 'native-validate-switch') return validateNativeSwitch(runtime, payload);
  if (operation === 'native-validate-checkpoint') return validateNativeCheckpoint(runtime, payload);
  if (operation === 'native-validate-eggs') return validateNativeEggs(runtime, payload);
  if (operation === 'native-project') return projectNativeSnapshot(runtime, payload);
  if (operation === 'catalogs') return describeOriginalCatalogs();
  if (operation === 'state') return {
    random: runtime.context.sceneRandom.capture(),
    modifierPools: structuredClone(runtime.context.modifierPools)
  };
  if (operation === 'roundtrip') return capturePokemonState(restorePokemonState(payload));
  if (operation === 'construct') {
    if (!payload || Object.keys(payload).sort().join(',') !== 'enemy,level,speciesId' || typeof payload.enemy !== 'boolean')
      throw new Error('INVALID_POKEMON_SELECTION');
    // A failed original constructor or checkpoint validation must not consume
    // this worker's committed stream. No rule result is published on failure.
    const before = runtime.context.sceneRandom.capture();
    try {
      const pokemon = constructOriginalPokemon(runtime, payload.speciesId, payload.level, payload.enemy);
      const checkpoint = capturePokemonState(pokemon);
      const restored = restorePokemonState(structuredClone(checkpoint));
      return { pokemon: capturePokemonState(restored), random: runtime.context.sceneRandom.capture() };
    } catch (error) {
      runtime.context.sceneRandom = new SceneRandom(before);
      throw error;
    }
  }
  throw new Error('UNSUPPORTED_RUNTIME_OPERATION');
}
