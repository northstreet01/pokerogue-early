import { PokemonModifierType, PokemonHpRestoreModifierType, PokemonStatusHealModifierType,
  PokemonPpRestoreModifierType, PokemonAllMovePpRestoreModifierType, PokemonPpUpModifierType } from '../modifier/modifier-type';
import { AddPokeballModifier, MoneyRewardModifier, PokemonHpRestoreModifier, PokemonStatusHealModifier,
  PokemonPpRestoreModifier, PokemonAllMovePpRestoreModifier, PokemonPpUpModifier } from '../modifier/modifier';

// Capability boundary for the currently connected consumables. Original types
// still own targeting, prices and effects; unsupported mechanisms remain explicit.
export function preparationItemTarget(type): 'party' | 'move' | 'none' | null {
  if (type instanceof PokemonPpRestoreModifierType || type instanceof PokemonPpUpModifierType) return 'move';
  if (type instanceof PokemonHpRestoreModifierType || type instanceof PokemonStatusHealModifierType
    || type instanceof PokemonAllMovePpRestoreModifierType) return 'party';
  if (!(type instanceof PokemonModifierType)) {
    try {
      const modifier = type.newModifier();
      if (modifier instanceof AddPokeballModifier || modifier instanceof MoneyRewardModifier) return 'none';
    } catch { return null; }
  }
  return null;
}

export function isPreparationConsumable(modifier) {
  return modifier instanceof AddPokeballModifier || modifier instanceof MoneyRewardModifier
    || modifier instanceof PokemonHpRestoreModifier || modifier instanceof PokemonStatusHealModifier
    || modifier instanceof PokemonPpRestoreModifier || modifier instanceof PokemonAllMovePpRestoreModifier
    || modifier instanceof PokemonPpUpModifier;
}
