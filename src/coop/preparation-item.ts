import { PokemonModifierType, PokemonHpRestoreModifierType, PokemonStatusHealModifierType,
  PokemonPpRestoreModifierType, PokemonAllMovePpRestoreModifierType, PokemonPpUpModifierType,
  PokemonHeldItemModifierType } from '../modifier/modifier-type';
import { AddPokeballModifier, MoneyRewardModifier, PokemonHpRestoreModifier, PokemonStatusHealModifier,
  PokemonPpRestoreModifier, PokemonAllMovePpRestoreModifier, PokemonPpUpModifier,
  ExpBoosterModifier, HealingBoosterModifier, ExpShareModifier, ExtraModifierModifier,
  MoneyMultiplierModifier, PokemonExpBoosterModifier, PokemonBaseStatModifier,
  AttackTypeBoosterModifier, BerryModifier, TempBattleStatBoosterModifier,
  PokemonNatureWeightModifier, PreserveBerryModifier } from '../modifier/modifier';

// Admission is by verified original mechanism, including generated variants.
// Exact prototypes prevent an unverified specialised subclass entering by accident.
const persistentMechanisms = [ExpBoosterModifier, HealingBoosterModifier, ExpShareModifier,
  ExtraModifierModifier, MoneyMultiplierModifier, PokemonExpBoosterModifier, PokemonBaseStatModifier,
  AttackTypeBoosterModifier, BerryModifier, TempBattleStatBoosterModifier, PokemonNatureWeightModifier,
  PreserveBerryModifier];
export function isPreparationPersistent(modifier) {
  return persistentMechanisms.some(ctor => Object.getPrototypeOf(modifier) === ctor.prototype);
}

// Capability boundary for connected mechanisms. Original types
// still own targeting, prices and effects; unsupported mechanisms remain explicit.
export function preparationItemTarget(type): 'party' | 'move' | 'none' | null {
  if (type instanceof PokemonPpRestoreModifierType || type instanceof PokemonPpUpModifierType) return 'move';
  if (type instanceof PokemonHpRestoreModifierType || type instanceof PokemonStatusHealModifierType
    || type instanceof PokemonAllMovePpRestoreModifierType) return 'party';
  if (type instanceof PokemonHeldItemModifierType) {
    return isPreparationPersistent(type.newModifier({ id: 0 })) ? 'party' : null;
  }
  if (!(type instanceof PokemonModifierType)) {
    try {
      const modifier = type.newModifier();
      if (isPreparationConsumable(modifier) || isPreparationPersistent(modifier)) return 'none';
    } catch { return null; }
  }
  return null;
}

export function isPreparationModifier(modifier) {
  return isPreparationConsumable(modifier) || isPreparationPersistent(modifier);
}

export function isPreparationConsumable(modifier) {
  return modifier instanceof AddPokeballModifier || modifier instanceof MoneyRewardModifier
    || modifier instanceof PokemonHpRestoreModifier || modifier instanceof PokemonStatusHealModifier
    || modifier instanceof PokemonPpRestoreModifier || modifier instanceof PokemonAllMovePpRestoreModifier
    || modifier instanceof PokemonPpUpModifier;
}
