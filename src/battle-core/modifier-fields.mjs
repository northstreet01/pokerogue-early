// Explicit early Modifier declarations; guarded against source drift by AST tests.
export const modifierFields = {
  "Modifier": {
    "parent": null,
    "abstract": true,
    "fields": {
      "type": "ModifierType"
    }
  },
  "PersistentModifier": {
    "parent": "Modifier",
    "abstract": true,
    "fields": {
      "stackCount": "integer",
      "virtualStackCount": "integer"
    }
  },
  "ConsumableModifier": {
    "parent": "Modifier",
    "abstract": true,
    "fields": {}
  },
  "AddPokeballModifier": {
    "parent": "ConsumableModifier",
    "abstract": false,
    "fields": {
      "pokeballType": "PokeballType",
      "count": "integer"
    }
  },
  "AddVoucherModifier": {
    "parent": "ConsumableModifier",
    "abstract": false,
    "fields": {
      "voucherType": "VoucherType",
      "count": "integer"
    }
  },
  "LapsingPersistentModifier": {
    "parent": "PersistentModifier",
    "abstract": true,
    "fields": {
      "battlesLeft": "integer"
    }
  },
  "DoubleBattleChanceBoosterModifier": {
    "parent": "LapsingPersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "TempBattleStatBoosterModifier": {
    "parent": "LapsingPersistentModifier",
    "abstract": false,
    "fields": {
      "tempBattleStat": "TempBattleStat"
    }
  },
  "MapModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "MegaEvolutionAccessModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "GigantamaxAccessModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "TerastallizeAccessModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "PokemonHeldItemModifier": {
    "parent": "PersistentModifier",
    "abstract": true,
    "fields": {
      "pokemonId": "integer"
    }
  },
  "LapsingPokemonHeldItemModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": true,
    "fields": {
      "battlesLeft": "integer"
    }
  },
  "TerastallizeModifier": {
    "parent": "LapsingPokemonHeldItemModifier",
    "abstract": false,
    "fields": {
      "teraType": "Type"
    }
  },
  "PokemonBaseStatModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {
      "stat": "Stat"
    }
  },
  "AttackTypeBoosterModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {
      "moveType": "Type",
      "boostMultiplier": "number"
    }
  },
  "SurviveDamageModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {}
  },
  "FlinchChanceModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {}
  },
  "TurnHealModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {}
  },
  "HitHealModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {}
  },
  "LevelIncrementBoosterModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "BerryModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {
      "berryType": "BerryType",
      "consumed": "boolean"
    }
  },
  "PreserveBerryModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "PokemonInstantReviveModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {}
  },
  "ConsumablePokemonModifier": {
    "parent": "ConsumableModifier",
    "abstract": true,
    "fields": {
      "pokemonId": "integer"
    }
  },
  "PokemonHpRestoreModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": false,
    "fields": {
      "restorePoints": "integer",
      "restorePercent": "number",
      "healStatus": "boolean",
      "fainted": "boolean"
    }
  },
  "PokemonStatusHealModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": false,
    "fields": {}
  },
  "ConsumablePokemonMoveModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": true,
    "fields": {
      "moveIndex": "integer"
    }
  },
  "PokemonPpRestoreModifier": {
    "parent": "ConsumablePokemonMoveModifier",
    "abstract": false,
    "fields": {
      "restorePoints": "integer"
    }
  },
  "PokemonAllMovePpRestoreModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": false,
    "fields": {
      "restorePoints": "integer"
    }
  },
  "PokemonPpUpModifier": {
    "parent": "ConsumablePokemonMoveModifier",
    "abstract": false,
    "fields": {
      "upPoints": "integer"
    }
  },
  "PokemonLevelIncrementModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": false,
    "fields": {}
  },
  "TmModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": false,
    "fields": {}
  },
  "RememberMoveModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": false,
    "fields": {
      "levelMoveIndex": "integer"
    }
  },
  "EvolutionItemModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": false,
    "fields": {}
  },
  "FusePokemonModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": false,
    "fields": {
      "fusePokemonId": "integer"
    }
  },
  "UnfusePokemonModifier": {
    "parent": "ConsumablePokemonModifier",
    "abstract": false,
    "fields": {}
  },
  "MultipleParticipantExpBonusModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "HealingBoosterModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {
      "multiplier": "number"
    }
  },
  "ExpBoosterModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {
      "boostMultiplier": "integer"
    }
  },
  "PokemonExpBoosterModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {
      "boostMultiplier": "integer"
    }
  },
  "ExpShareModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "ExpBalanceModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "PokemonFriendshipBoosterModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {}
  },
  "PokemonNatureWeightModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {}
  },
  "PokemonFormChangeItemModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {
      "formChangeItem": "FormChangeItem",
      "active": "boolean"
    }
  },
  "MoneyRewardModifier": {
    "parent": "ConsumableModifier",
    "abstract": false,
    "fields": {
      "moneyMultiplier": "number"
    }
  },
  "MoneyMultiplierModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "DamageMoneyRewardModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {}
  },
  "MoneyInterestModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "HiddenAbilityRateBoosterModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "ShinyRateBoosterModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "SwitchEffectTransferModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": false,
    "fields": {}
  },
  "HeldItemTransferModifier": {
    "parent": "PokemonHeldItemModifier",
    "abstract": true,
    "fields": {}
  },
  "TurnHeldItemTransferModifier": {
    "parent": "HeldItemTransferModifier",
    "abstract": false,
    "fields": {}
  },
  "ContactHeldItemTransferChanceModifier": {
    "parent": "HeldItemTransferModifier",
    "abstract": false,
    "fields": {
      "chance": "number"
    }
  },
  "IvScannerModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "ExtraModifierModifier": {
    "parent": "PersistentModifier",
    "abstract": false,
    "fields": {}
  },
  "EnemyPersistentModifier": {
    "parent": "PersistentModifier",
    "abstract": true,
    "fields": {}
  },
  "EnemyDamageMultiplierModifier": {
    "parent": "EnemyPersistentModifier",
    "abstract": true,
    "fields": {
      "damageMultiplier": "number"
    }
  },
  "EnemyDamageBoosterModifier": {
    "parent": "EnemyDamageMultiplierModifier",
    "abstract": false,
    "fields": {}
  },
  "EnemyDamageReducerModifier": {
    "parent": "EnemyDamageMultiplierModifier",
    "abstract": false,
    "fields": {}
  },
  "EnemyTurnHealModifier": {
    "parent": "EnemyPersistentModifier",
    "abstract": false,
    "fields": {
      "healPercent": "number"
    }
  },
  "EnemyAttackStatusEffectChanceModifier": {
    "parent": "EnemyPersistentModifier",
    "abstract": false,
    "fields": {
      "effect": "StatusEffect",
      "chance": "number"
    }
  },
  "EnemyStatusEffectHealChanceModifier": {
    "parent": "EnemyPersistentModifier",
    "abstract": false,
    "fields": {
      "chance": "number"
    }
  },
  "EnemyInstantReviveChanceModifier": {
    "parent": "EnemyPersistentModifier",
    "abstract": false,
    "fields": {
      "fullHeal": "boolean",
      "chance": "number"
    }
  },
  "EnemyFusionChanceModifier": {
    "parent": "EnemyPersistentModifier",
    "abstract": false,
    "fields": {
      "chance": "number"
    }
  }
};
