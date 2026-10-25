import * as phases from './phases';
import * as evolutionPhases from './evolution-phase';
import * as formPhases from './form-change-phase';
import { pokemonEvolutions } from './data/pokemon-evolutions';
import { pokemonFormChanges } from './data/pokemon-forms';
import { capturePokemonMoveState, restorePokemonMoveState } from './field/pokemon';
import { captureModifierTypeState, restoreModifierTypeState } from './modifier/modifier-type';
import { captureWeatherState, restoreWeatherState } from './data/weather';
import { allMoves } from './data/move';
import { createPhaseStateCodec } from './battle-core/phase-state.mjs';
import { createCatalogReferenceCodec } from './battle-core/catalog-reference.mjs';
import { phaseStateFields } from './battle-core/phase-fields.mjs';
import { createOriginalQueueStateCodec } from './battle-core/original-queue-state.mjs';
import { createSafeDecisionCodec } from './battle-core/safe-decisions.mjs';
import { createDecisionStateCodec } from './battle-core/decision-state.mjs';
import { createRosterStateCodec } from './battle-core/roster-state.mjs';
import { capturePokemonState, restorePokemonState } from './field/pokemon';
import { captureTrainerState, restoreTrainerState } from './field/trainer';
import { captureModifierState, restoreModifierState } from './modifier/modifier';
import { captureTerrainState, restoreTerrainState } from './data/terrain';
import { captureArenaTagState, restoreArenaTagState } from './data/arena-tag';
import Battle from './battle';
import { Arena } from './field/arena';
import { gameModes } from './game-mode';
import { Biome } from './data/enums/biome';
import {TimeOfDay} from './data/enums/time-of-day';
import {getPokemonSpecies} from './data/pokemon-species';
import {trainerConfigs} from './data/trainer-config';
import {createArenaPoolStateCodec} from './battle-core/arena-pool-state.mjs';
import {EggHatchPhase} from './egg-hatch-phase';
import {Egg,EGG_SEED,GachaType} from './data/egg';
import {EggTier} from './data/enums/egg-type';
import {createOwnedEggStateCodec} from './battle-core/egg-state.mjs';

// Loaded explicitly by an original-model adapter. It does not mount a runner or
// change the single-player/experimental entry point. Catalog closures remain
// trusted original objects; constructors/condition predicates never run on load.
const allPhases = { ...phases, ...evolutionPhases, ...formPhases,EggHatchPhase };
export const originalOwnedEggStateCodec=createOwnedEggStateCodec({Egg,seed:EGG_SEED,
  gachaTypes:[GachaType.MOVE,GachaType.LEGENDARY,GachaType.SHINY],tiers:[EggTier.COMMON,EggTier.GREAT,EggTier.ULTRA,EggTier.MASTER]});
export const evolutionReferenceCodec = createCatalogReferenceCodec(pokemonEvolutions);
export const formChangeReferenceCodec = createCatalogReferenceCodec(pokemonFormChanges);
export const originalPhaseStateCodec = createPhaseStateCodec({
  constructors: Object.fromEntries(Object.keys(phaseStateFields).filter(name => typeof allPhases[name] === 'function').map(name => [name, allPhases[name]])),
  evolution: evolutionReferenceCodec, formChange: formChangeReferenceCodec,
  modifierType: { capture: captureModifierTypeState, restore: restoreModifierTypeState },
  weather: { capture: captureWeatherState, restore: restoreWeatherState },
  pokemon: { captureMove: capturePokemonMoveState, restoreMove: restorePokemonMoveState, capturePokemon: capturePokemonState, restorePokemon: restorePokemonState },
  hasMove: id => !!allMoves[id]
});
export const originalQueueStateCodec = createOriginalQueueStateCodec(originalPhaseStateCodec);
export const originalSafeDecisionCodec = createSafeDecisionCodec({
  evolution: evolutionReferenceCodec,
  modifierType: { restore: restoreModifierTypeState },
  hasMove:id=>!!allMoves[id],
  hasBiome: id => Number.isInteger(id) && typeof Biome[id] === 'string'
});
export const originalDecisionStateCodec = createDecisionStateCodec({
  queuedCommands: true,
  roster: createRosterStateCodec({ capturePokemonState, restorePokemonState }),
  effects: { captureWeatherState, restoreWeatherState, captureTerrainState, restoreTerrainState, captureArenaTagState, restoreArenaTagState },
  Battle, Arena, getGameMode: id => gameModes[id], hasMove: id => !!allMoves[id],
  safeDecisions: originalSafeDecisionCodec, phaseState: originalPhaseStateCodec,
  arenaPools:createArenaPoolStateCodec({hasBiome:id=>typeof Biome[id]==='string',hasTimeOfDay:id=>typeof TimeOfDay[id]==='string',
    hasSpecies:id=>!!getPokemonSpecies(id),hasTrainer:id=>Object.prototype.hasOwnProperty.call(trainerConfigs,id)}),
  components: {
    eggs:originalOwnedEggStateCodec,
    trainer: { capture: captureTrainerState, restore: restoreTrainerState },
    modifier: { capture: captureModifierState, restore: restoreModifierState, captureType: captureModifierTypeState }
  }
});
