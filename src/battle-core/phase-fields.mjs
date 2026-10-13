// Explicit original rule fields. AST coverage rejects source drift; UI phases are excluded.
export const excludedPhaseTypes = Object.freeze(["LoginPhase","TitlePhase","ConsolidateDataPhase","SelectGenderPhase","EggHatchPhase","MoveAnimTestPhase","TrainerMessageTestPhase","TestMessagePhase"]);
export const phaseStateFields = Object.freeze({
  "SelectStarterPhase": {
    "base": "Phase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "BattlePhase": {
    "base": "Phase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "FieldPhase": {
    "base": "BattlePhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": true
  },
  "PokemonPhase": {
    "base": "FieldPhase",
    "fields": {
      "battlerIndex": "int",
      "player": "bool",
      "fieldIndex": "int"
    },
    "required": [
      "battlerIndex",
      "player",
      "fieldIndex"
    ],
    "display": [],
    "abstract": true
  },
  "PartyMemberPokemonPhase": {
    "base": "FieldPhase",
    "fields": {
      "partyMemberIndex": "int",
      "fieldIndex": "int",
      "player": "bool"
    },
    "required": [
      "partyMemberIndex",
      "fieldIndex",
      "player"
    ],
    "display": [],
    "abstract": true
  },
  "PlayerPartyMemberPokemonPhase": {
    "base": "PartyMemberPokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": true
  },
  "EnemyPartyMemberPokemonPhase": {
    "base": "PartyMemberPokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": true
  },
  "EncounterPhase": {
    "base": "BattlePhase",
    "fields": {"loaded":"bool"},
    "required": ["loaded"],
    "display": [],
    "abstract": false
  },
  "NextEncounterPhase": {
    "base": "EncounterPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "NewBiomeEncounterPhase": {
    "base": "NextEncounterPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "PostSummonPhase": {
    "base": "PokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "SelectBiomePhase": {
    "base": "BattlePhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "SwitchBiomePhase": {
    "base": "BattlePhase",
    "fields": {
      "nextBiome": "int"
    },
    "required": [
      "nextBiome"
    ],
    "display": [],
    "abstract": false
  },
  "SummonPhase": {
    "base": "PartyMemberPokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "SwitchSummonPhase": {
    "base": "SummonPhase",
    "fields": {
      "slotIndex": "int",
      "doReturn": "bool",
      "batonPass": "bool",
      "lastPokemon": "pokemon"
    },
    "required": [
      "slotIndex",
      "doReturn",
      "batonPass"
    ],
    "display": [],
    "abstract": false
  },
  "ReturnPhase": {
    "base": "SwitchSummonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "ShowTrainerPhase": {
    "base": "BattlePhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "ToggleDoublePositionPhase": {
    "base": "BattlePhase",
    "fields": {
      "double": "bool"
    },
    "required": [
      "double"
    ],
    "display": [],
    "abstract": false
  },
  "CheckSwitchPhase": {
    "base": "BattlePhase",
    "fields": {
      "fieldIndex": "int",
      "useName": "bool"
    },
    "required": [
      "fieldIndex",
      "useName"
    ],
    "display": [],
    "abstract": false
  },
  "SummonMissingPhase": {
    "base": "SummonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "LevelCapPhase": {
    "base": "FieldPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "TurnInitPhase": {
    "base": "FieldPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "CommandPhase": {
    "base": "FieldPhase",
    "fields": {
      "fieldIndex": "int"
    },
    "required": [
      "fieldIndex"
    ],
    "display": [],
    "abstract": false
  },
  "EnemyCommandPhase": {
    "base": "FieldPhase",
    "fields": {
      "fieldIndex": "int"
    },
    "required": [
      "fieldIndex"
    ],
    "display": [],
    "abstract": false
  },
  "SelectTargetPhase": {
    "base": "PokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "TurnStartPhase": {
    "base": "FieldPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "TurnEndPhase": {
    "base": "FieldPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "BattleEndPhase": {
    "base": "BattlePhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "NewBattlePhase": {
    "base": "BattlePhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "CommonAnimPhase": {
    "base": "PokemonPhase",
    "fields": {
      "anim": "int",
      "targetIndex": "int"
    },
    "required": [
      "anim",
      "targetIndex"
    ],
    "display": [],
    "abstract": false
  },
  "MovePhase": {
    "base": "BattlePhase",
    "fields": {
      "pokemon": "pokemon",
      "move": "move",
      "targets": "ints",
      "followUp": "bool",
      "ignorePp": "bool",
      "cancelled": "bool"
    },
    "required": [
      "pokemon",
      "targets",
      "move",
      "followUp",
      "ignorePp",
      "cancelled"
    ],
    "display": [],
    "abstract": false
  },
  "MoveEffectPhase": {
    "base": "PokemonPhase",
    "fields": {
      "move": "move",
      "targets": "ints"
    },
    "required": [
      "move",
      "targets"
    ],
    "display": [],
    "abstract": false
  },
  "MoveEndPhase": {
    "base": "PokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "ShowAbilityPhase": {
    "base": "PokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "StatChangePhase": {
    "base": "PokemonPhase",
    "fields": {
      "stats": "ints",
      "selfTarget": "bool",
      "levels": "int"
    },
    "required": [
      "selfTarget",
      "stats",
      "levels"
    ],
    "display": [
      "showMessage"
    ],
    "abstract": false
  },
  "WeatherEffectPhase": {
    "base": "CommonAnimPhase",
    "fields": {
      "weather": "weather"
    },
    "required": [
      "weather"
    ],
    "display": [],
    "abstract": false
  },
  "ObtainStatusEffectPhase": {
    "base": "PokemonPhase",
    "fields": {
      "statusEffect": "int",
      "cureTurn": "int"
    },
    "required": [
      "statusEffect",
      "cureTurn"
    ],
    "display": ["sourceText"],
    "abstract": false
  },
  "PostTurnStatusEffectPhase": {
    "base": "PokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "MessagePhase": {
    "base": "Phase",
    "fields": {},
    "required": [],
    "display": [
      "text",
      "callbackDelay",
      "prompt",
      "promptDelay"
    ],
    "abstract": false
  },
  "DamagePhase": {
    "base": "PokemonPhase",
    "fields": {
      "amount": "int",
      "damageResult": "int",
      "critical": "bool"
    },
    "required": [
      "amount",
      "damageResult",
      "critical"
    ],
    "display": [],
    "abstract": false
  },
  "FaintPhase": {
    "base": "PokemonPhase",
    "fields": {
      "preventEndure": "bool"
    },
    "required": [
      "preventEndure"
    ],
    "display": [],
    "abstract": false
  },
  "VictoryPhase": {
    "base": "PokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "TrainerVictoryPhase": {
    "base": "BattlePhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "MoneyRewardPhase": {
    "base": "BattlePhase",
    "fields": {
      "moneyMultiplier": "number"
    },
    "required": [
      "moneyMultiplier"
    ],
    "display": [],
    "abstract": false
  },
  "ModifierRewardPhase": {
    "base": "BattlePhase",
    "fields": {
      "modifierType": "modifierType"
    },
    "required": [
      "modifierType"
    ],
    "display": [],
    "abstract": false
  },
  "GameOverModifierRewardPhase": {
    "base": "ModifierRewardPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "GameOverPhase": {
    "base": "BattlePhase",
    "fields": {
      "victory": "bool"
    },
    "required": [
      "victory"
    ],
    "display": [],
    "abstract": false
  },
  "UnlockPhase": {
    "base": "Phase",
    "fields": {
      "unlockable": "int"
    },
    "required": [
      "unlockable"
    ],
    "display": [],
    "abstract": false
  },
  "SwitchPhase": {
    "base": "BattlePhase",
    "fields": {
      "fieldIndex": "int",
      "isModal": "bool",
      "doReturn": "bool"
    },
    "required": [
      "fieldIndex",
      "isModal",
      "doReturn"
    ],
    "display": [],
    "abstract": false
  },
  "ExpPhase": {
    "base": "PlayerPartyMemberPokemonPhase",
    "fields": {
      "expValue": "number"
    },
    "required": [
      "expValue"
    ],
    "display": [],
    "abstract": false
  },
  "ShowPartyExpBarPhase": {
    "base": "PlayerPartyMemberPokemonPhase",
    "fields": {
      "expValue": "number"
    },
    "required": [
      "expValue"
    ],
    "display": [],
    "abstract": false
  },
  "HidePartyExpBarPhase": {
    "base": "BattlePhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "LevelUpPhase": {
    "base": "PlayerPartyMemberPokemonPhase",
    "fields": {
      "lastLevel": "int",
      "level": "int"
    },
    "required": [
      "lastLevel",
      "level"
    ],
    "display": [],
    "abstract": false
  },
  "LearnMovePhase": {
    "base": "PlayerPartyMemberPokemonPhase",
    "fields": {
      "moveId": "int"
    },
    "required": [
      "moveId"
    ],
    "display": [],
    "abstract": false
  },
  "BerryPhase": {
    "base": "CommonAnimPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "PokemonHealPhase": {
    "base": "CommonAnimPhase",
    "fields": {
      "hpHealed": "int",
      "revive": "bool",
      "healStatus": "bool"
    },
    "required": [
      "hpHealed",
      "revive",
      "healStatus"
    ],
    "display": [
      "message",
      "showFullHpMessage",
      "skipAnim"
    ],
    "abstract": false
  },
  "AttemptCapturePhase": {
    "base": "PokemonPhase",
    "fields": {
      "pokeballType": "int",
      "originalY": "number"
    },
    "required": [
      "pokeballType"
    ],
    "display": [
      "pokeball"
    ],
    "abstract": false
  },
  "AttemptRunPhase": {
    "base": "PokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "SelectModifierPhase": {
    "base": "BattlePhase",
    "fields": {
      "rerollCount": "int"
    },
    "required": [
      "rerollCount"
    ],
    "display": [],
    "abstract": false
  },
  "EggLapsePhase": {
    "base": "Phase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "AddEnemyBuffModifierPhase": {
    "base": "Phase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "PartyHealPhase": {
    "base": "BattlePhase",
    "fields": {},
    "required": [],
    "display": [
      "resumeBgm"
    ],
    "abstract": false
  },
  "ShinySparklePhase": {
    "base": "PokemonPhase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "ScanIvsPhase": {
    "base": "PokemonPhase",
    "fields": {
      "shownIvs": "int"
    },
    "required": [
      "shownIvs"
    ],
    "display": [],
    "abstract": false
  },
  "EvolutionPhase": {
    "base": "Phase",
    "fields": {
      "pokemon": "pokemon",
      "lastLevel": "int",
      "evolution": "evolution"
    },
    "required": [
      "pokemon",
      "evolution",
      "lastLevel"
    ],
    "display": [
      "evolutionContainer",
      "evolutionBaseBg",
      "evolutionBg",
      "evolutionBgOverlay",
      "evolutionOverlay",
      "pokemonSprite",
      "pokemonTintSprite",
      "pokemonEvoSprite",
      "pokemonEvoTintSprite"
    ],
    "abstract": false
  },
  "EndEvolutionPhase": {
    "base": "Phase",
    "fields": {},
    "required": [],
    "display": [],
    "abstract": false
  },
  "FormChangePhase": {
    "base": "EvolutionPhase",
    "fields": {
      "formChange": "formChange",
      "modal": "bool"
    },
    "required": [
      "formChange",
      "modal"
    ],
    "display": [],
    "abstract": false
  },
  "QuietFormChangePhase": {
    "base": "BattlePhase",
    "fields": {
      "pokemon": "pokemon",
      "formChange": "formChange"
    },
    "required": [
      "pokemon",
      "formChange"
    ],
    "display": [],
    "abstract": false
  }
});
