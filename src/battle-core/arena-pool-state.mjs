import {copy,requireContract as check} from './coop-contract.mjs';

export function createArenaPoolStateCodec({hasBiome,hasTimeOfDay,hasSpecies,hasTrainer}) {
  return Object.freeze({validate(arena){
    check(hasBiome(arena.biomeType)&&hasTimeOfDay(arena.lastTimeOfDay),'INVALID_ARENA');
    for(const [name,pool]of [['pokemon',arena.pokemonPool],['trainer',arena.trainerPool]]){
      const saved=copy(pool);check(saved&&!Array.isArray(saved)&&Object.keys(saved).length<=9,'INVALID_ARENA_POOL');
      for(const [tier,entries]of Object.entries(saved)){
        check(/^[0-8]$/.test(tier)&&Array.isArray(entries)&&entries.length<=10000,'INVALID_ARENA_POOL');
        for(const entry of entries){
          if(name==='trainer'){check(Number.isSafeInteger(entry)&&hasTrainer(entry),'UNKNOWN_POOL_TRAINER');continue;}
          if(typeof entry==='number'){check(Number.isSafeInteger(entry)&&hasSpecies(entry),'UNKNOWN_POOL_SPECIES');continue;}
          check(entry&&typeof entry==='object'&&!Array.isArray(entry)&&Object.keys(entry).length>0&&Object.keys(entry).length<=1000,'INVALID_ARENA_POOL');
          for(const [level,ids]of Object.entries(entry))check(/^(0|[1-9]\d*)$/.test(level)&&Number.isSafeInteger(Number(level))
            &&Array.isArray(ids)&&ids.length>0&&ids.length<=1000&&ids.every(id=>Number.isSafeInteger(id)&&hasSpecies(id)),'UNKNOWN_POOL_SPECIES');
        }
      }
    }
  }});
}
