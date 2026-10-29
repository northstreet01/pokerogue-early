import { Type } from "./type";
import * as Utils from "../utils";
import BattleScene from "../battle-scene";
import { Species } from "./enums/species";
import { getPokemonSpecies, speciesStarters } from "./pokemon-species";
import { EggTier } from "./enums/egg-type";

export const EGG_SEED = 1073741824;

export enum GachaType {
  MOVE,
  LEGENDARY,
  SHINY
}

export class Egg {
  public id: integer;
  public tier: EggTier;
  public gachaType: GachaType;
  public hatchWaves: integer;
  public timestamp: integer;

  constructor(id: integer, gachaType: GachaType, hatchWaves: integer, timestamp: integer) {
    this.id = id;
    this.tier = Math.floor(id / EGG_SEED);
    this.gachaType = gachaType;
    this.hatchWaves = hatchWaves;
    this.timestamp = timestamp;
  }

  isManaphyEgg(): boolean {
    return this.tier === EggTier.COMMON && !(this.id % 255);
  }

  getKey(): string {
    if (this.isManaphyEgg())
      return 'manaphy';
    return this.tier.toString();
  }
}

export function getEggTierDefaultHatchWaves(tier: EggTier): integer {
  switch (tier) {
    case EggTier.COMMON:
      return 10;
    case EggTier.GREAT:
      return 25;
    case EggTier.ULTRA:
      return 50;
  }
  return 100;
}

export function getEggDescriptor(egg: Egg): string {
  if (egg.isManaphyEgg())
    return 'Manaphy';
  switch (egg.tier) {
    case EggTier.GREAT:
      return 'Rare';
    case EggTier.ULTRA:
      return 'Epic';
    case EggTier.MASTER:
      return 'Legendary';
    default:
      return 'Common';
  }
}

export function getEggHatchWavesMessage(hatchWaves: integer): string {
  if (hatchWaves <= 5)
    return 'Sounds can be heard coming from inside! It will hatch soon!';
  if (hatchWaves <= 15)
    return 'It appears to move occasionally. It may be close to hatching.';
  if (hatchWaves <= 50)
    return 'What will hatch from this? It doesn\'t seem close to hatching.';
  return 'It looks like this Egg will take a long time to hatch.';
}

export function getEggGachaTypeDescriptor(scene: BattleScene, egg: Egg): string {
  if (egg.isManaphyEgg())
    return '';
  switch (egg.gachaType) {
    case GachaType.LEGENDARY:
      return `Legendary Rate Up (${getPokemonSpecies(getLegendaryGachaSpeciesForTimestamp(scene, egg.timestamp)).getName()})`;
    case GachaType.MOVE:
      return 'Rare Egg Move Rate Up';
    case GachaType.SHINY:
      return 'Shiny Rate Up';
  }
}

export function getLegendaryGachaSpeciesForTimestamp(scene: BattleScene, timestamp: integer): Species {
  const legendarySpecies = Object.entries(speciesStarters)
    .filter(s => s[1] >= 8 && s[1] <= 9)
    .map(s => parseInt(s[0]))
    .filter(s => getPokemonSpecies(s).isObtainable());

  let ret: Species;

  scene.executeWithSeedOffset(() => {
    ret = Utils.randSeedItem(legendarySpecies);
  }, Utils.getSunday(new Date(timestamp)).getTime(), EGG_SEED.toString());

  return ret;
}
/** Original draw rules shared by solo and the transactional local-profile UI. */
export function drawGachaEggs(data: any, gachaType: GachaType, pullCount: number, localRandom?:()=>number): Egg[] {
  // Local-profile draws may run alongside rule verification; their randomness
  // belongs to the personal machine, never the authoritative room stream.
  const randInt=localRandom?(range:number,min=0)=>range===1?min:Math.floor(localRandom()*range)+min:Utils.randInt;
  const eggs: Egg[] = [];
  const tierValueOffset = gachaType === GachaType.LEGENDARY ? 1 : 0;
  const tiers = new Array(pullCount).fill(null).map(() => {
    const tierValue = randInt(256);
    return tierValue >= 52 + tierValueOffset ? EggTier.COMMON : tierValue + tierValueOffset >= 8 ? EggTier.GREAT : tierValue >= 1 + tierValueOffset ? EggTier.ULTRA : EggTier.MASTER;
  });
  if (pullCount >= 25 && !tiers.filter(t => t >= EggTier.ULTRA).length)
    tiers[randInt(tiers.length)] = EggTier.ULTRA;
  else if (pullCount >= 10 && !tiers.filter(t => t >= EggTier.GREAT).length)
    tiers[randInt(tiers.length)] = EggTier.GREAT;

  const timestamp = new Date().getTime();

  const usedIds=new Set(data.eggs.map((egg:Egg)=>egg.id));
  for (let tier of tiers) {
    let id=randInt(EGG_SEED, EGG_SEED * tier),attempts=0;
    while(usedIds.has(id)){
      if(++attempts>32)throw new Error('GACHA_DUPLICATE_EGG');
      id=randInt(EGG_SEED, EGG_SEED * tier);
    }
    usedIds.add(id);
    const egg = new Egg(id, gachaType, getEggTierDefaultHatchWaves(tier), timestamp);
    if (egg.isManaphyEgg()) {
      data.gameStats.manaphyEggsPulled++;
      egg.hatchWaves = getEggTierDefaultHatchWaves(EggTier.ULTRA);
    } else {
      switch (tier) {
        case EggTier.GREAT:
          data.gameStats.rareEggsPulled++;
          break;
        case EggTier.ULTRA:
          data.gameStats.epicEggsPulled++;
          break;
        case EggTier.MASTER:
          data.gameStats.legendaryEggsPulled++;
          break;
      }
    }
    eggs.push(egg);
    data.eggs.push(egg);
    data.gameStats.eggsPulled++;
  }

  return eggs;
}
