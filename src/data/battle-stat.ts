import i18next from '../i18n';

export enum BattleStat {
  ATK,
  DEF,
  SPATK,
  SPDEF,
  SPD,
  ACC,
  EVA,
  RAND
}

export function getBattleStatName(stat: BattleStat) {
  if ((i18next.resolvedLanguage??i18next.language)==='zh-Hans' && stat>=BattleStat.ATK && stat<=BattleStat.EVA)
    return i18next.t(`pokemonInfo:stat.${BattleStat[stat].toLowerCase()}`);
  switch (stat) {
    case BattleStat.ATK:
      return 'Attack';
    case BattleStat.DEF:
      return 'Defense';
    case BattleStat.SPATK:
      return 'Sp. Atk';
    case BattleStat.SPDEF:
      return 'Sp. Def';
    case BattleStat.SPD:
      return 'Speed';
    case BattleStat.ACC:
      return 'Accuracy';
    case BattleStat.EVA:
      return 'Evasiveness';
    default:
      return '???';
  }
}

export function getBattleStatLevelChangeDescription(levels: integer, up: boolean) {
  if (up) {
    switch (levels) {
      case 1:
        return 'rose';
      case 2:
        return 'sharply rose';
      case 3:
      case 4:
      case 5:
      case 6:
        return 'rose drastically'; 
      default:
        return 'won\'t go any higher';
    }
  } else {
    switch (levels) {
      case 1:
        return 'fell';
      case 2:
        return 'harshly fell';
      case 3:
      case 4:
      case 5:
      case 6:
        return 'severely fell';
      default:
        return 'won\'t go any lower';
    }
  }
}
