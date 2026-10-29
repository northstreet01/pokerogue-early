import { PokemonModifierType, PokemonHpRestoreModifierType, PokemonStatusHealModifierType,
  PokemonPpRestoreModifierType, PokemonAllMovePpRestoreModifierType, PokemonPpUpModifierType,
  PokemonHeldItemModifierType, PokemonLevelIncrementModifierType, TmModifierType, EvolutionItemModifierType,
  FormChangeItemModifierType, FusePokemonModifierType, UnfusePokemonModifierType,
  modifierTypes, ModifierTypeGenerator, RememberMoveModifierType } from '../modifier/modifier-type';
import { AddPokeballModifier, MoneyRewardModifier, PokemonHpRestoreModifier, PokemonStatusHealModifier,
  PokemonPpRestoreModifier, PokemonAllMovePpRestoreModifier, PokemonPpUpModifier,
  ExpBoosterModifier, HealingBoosterModifier, ExpShareModifier, ExtraModifierModifier,
  MoneyMultiplierModifier, PokemonExpBoosterModifier, PokemonBaseStatModifier,
  AttackTypeBoosterModifier, BerryModifier, TempBattleStatBoosterModifier,
  PokemonNatureWeightModifier, PreserveBerryModifier, PokemonLevelIncrementModifier, TmModifier, EvolutionItemModifier,
  SurviveDamageModifier, FlinchChanceModifier, TurnHealModifier, HitHealModifier, LevelIncrementBoosterModifier,
  PokemonInstantReviveModifier, ExpBalanceModifier, PokemonFriendshipBoosterModifier, MultipleParticipantExpBonusModifier,
  DamageMoneyRewardModifier, MoneyInterestModifier, MegaEvolutionAccessModifier, GigantamaxAccessModifier,
  TerastallizeAccessModifier, PokemonFormChangeItemModifier, TerastallizeModifier, FusePokemonModifier, UnfusePokemonModifier,
  RememberMoveModifier, AddVoucherModifier } from '../modifier/modifier';

// Admission is by verified original mechanism, including generated variants.
// Exact prototypes prevent an unverified specialised subclass entering by accident.
const persistentMechanisms = [ExpBoosterModifier, HealingBoosterModifier, ExpShareModifier,
  ExtraModifierModifier, MoneyMultiplierModifier, PokemonExpBoosterModifier, PokemonBaseStatModifier,
  AttackTypeBoosterModifier, BerryModifier, TempBattleStatBoosterModifier, PokemonNatureWeightModifier,
  PreserveBerryModifier, SurviveDamageModifier, FlinchChanceModifier, TurnHealModifier, HitHealModifier,
  LevelIncrementBoosterModifier, PokemonInstantReviveModifier, ExpBalanceModifier, PokemonFriendshipBoosterModifier,
  MultipleParticipantExpBonusModifier, DamageMoneyRewardModifier, MoneyInterestModifier,
  MegaEvolutionAccessModifier, GigantamaxAccessModifier, TerastallizeAccessModifier,
  PokemonFormChangeItemModifier, TerastallizeModifier];
export function isPreparationPersistent(modifier) {
  return persistentMechanisms.some(ctor => Object.getPrototypeOf(modifier) === ctor.prototype);
}

// Capability boundary for connected mechanisms. Original types
// still own targeting, prices and effects; unsupported mechanisms remain explicit.
export function preparationItemTarget(type): 'party' | 'move' | 'remember' | 'fusion' | 'none' | null {
  if(type instanceof FusePokemonModifierType)return 'fusion';
  if(type instanceof RememberMoveModifierType)return 'remember';
  if (type instanceof PokemonPpRestoreModifierType || type instanceof PokemonPpUpModifierType) return 'move';
  if (type instanceof PokemonHpRestoreModifierType || type instanceof PokemonStatusHealModifierType
    || type instanceof PokemonAllMovePpRestoreModifierType || type instanceof PokemonLevelIncrementModifierType
    || type instanceof TmModifierType || type instanceof EvolutionItemModifierType || type instanceof FormChangeItemModifierType
    || type instanceof UnfusePokemonModifierType) return 'party';
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

// Check factories, never draw generated variants here: doing so would consume
// the room RNG before the original reward phase. Generated families are
// admitted only when their actual variant has a connected targeting mechanism.
const generatedMechanisms=new Set(['TEMP_STAT_BOOSTER','BASE_STAT_BOOSTER','ATTACK_TYPE_BOOSTER','BERRY',
  'TM_COMMON','TM_GREAT','TM_ULTRA','EVOLUTION_ITEM','RARE_EVOLUTION_ITEM','FORM_CHANGE_ITEM','TERA_SHARD']);
export function preparationRewardExclusions(vouchers=false):string[]{
  return Object.entries(modifierTypes).filter(([id,factory])=>{
    const type=factory();
    if(!vouchers&&type.newModifier&&['VOUCHER','VOUCHER_PLUS','VOUCHER_PREMIUM'].includes(id))return true;
    return type instanceof ModifierTypeGenerator?!generatedMechanisms.has(id):preparationItemTarget(type)===null;
  }).map(([id])=>id);
}

export function isPreparationConsumable(modifier) {
  return modifier instanceof AddPokeballModifier || modifier instanceof MoneyRewardModifier
    || Object.getPrototypeOf(modifier) === AddVoucherModifier.prototype
    || modifier instanceof PokemonHpRestoreModifier || modifier instanceof PokemonStatusHealModifier
    || modifier instanceof PokemonPpRestoreModifier || modifier instanceof PokemonAllMovePpRestoreModifier
    || modifier instanceof PokemonPpUpModifier || modifier instanceof PokemonLevelIncrementModifier
    || Object.getPrototypeOf(modifier) === TmModifier.prototype || Object.getPrototypeOf(modifier) === EvolutionItemModifier.prototype
    || Object.getPrototypeOf(modifier) === FusePokemonModifier.prototype || Object.getPrototypeOf(modifier) === UnfusePokemonModifier.prototype
    || Object.getPrototypeOf(modifier) === RememberMoveModifier.prototype;
}
