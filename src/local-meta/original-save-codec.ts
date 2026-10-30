// Serialization/validation boundary shared by profiles and explicit legacy
// import. Importing validators does not authorize a migration or overwrite.
// Match the original engine's initialization order before touching GameData.
import '../battle-scene';
import { GameData } from '../system/game-data';
import { allSpecies, getPokemonSpecies, initSpecies } from '../data/pokemon-species';
import { allMoves, initMoves } from '../data/move';
import { initAbilities } from '../data/ability';
import { speciesEggMoves } from '../data/egg-moves';
import { originalOwnedEggStateCodec } from '../original-phase-checkpoints';
import { Biome } from '../data/enums/biome';
import { TrainerType } from '../data/enums/trainer-type';
import { achvs } from '../system/achv';
import { vouchers } from '../system/voucher';
import { GameStats } from '../system/game-stats';
import * as modifiers from '../modifier/modifier';
import { getModifierTypeFuncById } from '../modifier/modifier-type';
import { check, exact, json, uint } from './codec.mjs';
import { AES, enc } from 'crypto-js';
import {restorePokemonState} from '../field/pokemon';

const SYSTEM_KEYS = ['trainerId','secretId','gender','dexData','starterMoveData','starterEggMoveData','gameStats','unlocks',
  'achvUnlocks','voucherUnlocks','voucherCounts','eggs','gameVersion','timestamp'];
const SESSION_KEYS = ['seed','playTime','gameMode','party','enemyParty','modifiers','enemyModifiers','arena','pokeballCounts','money',
  'score','waveIndex','battleType','trainer','gameVersion','timestamp'];
const POKEMON_KEYS = ['id','player','species','formIndex','abilityIndex','shiny','pokeball','level','exp','levelExp','gender','hp','stats','ivs','nature',
  'moveset','status','friendship','metLevel','metBiome','pauseEvolutions','pokerus','fusionSpecies','fusionFormIndex','fusionAbilityIndex',
  'fusionShiny','fusionGender','boss','summonData'];
const speciesIds = () => new Set(allSpecies.map(s => s.speciesId));
const initializeCatalogs = () => { initSpecies(); initMoves(); initAbilities(); };
const record = value => check(value && typeof value === 'object' && !Array.isArray(value));
const counter = value => check(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER);
const int = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => check(Number.isSafeInteger(value) && value >= min && value <= max);
const numericKeys = (value, valid) => { record(value); for (const key of Object.keys(value)) check(/^(0|[1-9][0-9]*)$/.test(key) && valid(Number(key)), 'UNKNOWN_ORIGINAL_CATALOG_ID'); };
const version = v => check(v.gameVersion === '1.0.0' && uint(v.timestamp), 'ORIGINAL_SAVE_VERSION_MISMATCH');
function move(id) { check(Number.isSafeInteger(id) && id > 0 && !!allMoves[id], 'UNKNOWN_ORIGINAL_MOVE'); }
function moves(list) { check(Array.isArray(list) && list.length >= 1 && list.length <= 4); for (const m of list) move(m); }
function dexAttr(value: number | string, max: bigint) {
  check((typeof value === 'number' && uint(value)) || (typeof value === 'string' && /^(0|[1-9][0-9]{0,99})$/.test(value)), 'INVALID_DEX_ATTRIBUTE');
  check((BigInt(value) & ~max) === 0n, 'INVALID_DEX_ATTRIBUTE');
}
export const originalSaveCodec = Object.freeze({
  hatchResult(result:any){
    originalOwnedEggStateCodec.restore({players:[[result.egg],[]]});
    const pokemon=restorePokemonState(result.pokemon);
    check(pokemon instanceof Object&&pokemon.isPlayer()&&pokemon.level===5&&!pokemon.fusionSpecies,'INVALID_HATCH_POKEMON');
    int(result.eggMoveIndex,0,3);
  },
  system(input: unknown) {
    initializeCatalogs();
    const s = json(input); exact(s, ['trainerId','secretId','dexData','eggs','gameVersion','timestamp'], SYSTEM_KEYS);
    version(s); int(s.trainerId,0,65535); int(s.secretId,0,65535);
    if (s.gender !== undefined) int(s.gender,0,2);
    const ids = speciesIds(); numericKeys(s.dexData, id => ids.has(id));
    check(Object.keys(s.dexData).length > 0, 'MISSING_DEX_DATA');
    for (const [key,value] of Object.entries(s.dexData)) {
      const d: any = value; exact(d, ['seenAttr','caughtAttr','natureAttr','seenCount','caughtCount','hatchedCount','ivs']);
      const forms = Math.max(getPokemonSpecies(Number(key)).forms.length,1);
      const mask = (1n << BigInt(7 + forms)) - 1n;
      dexAttr(d.seenAttr,mask); dexAttr(d.caughtAttr,mask);
      int(d.natureAttr,0,2 ** 26 - 2); check(d.natureAttr % 2 === 0);
      for (const k of ['seenCount','caughtCount','hatchedCount']) int(d[k]);
      check(Array.isArray(d.ivs) && d.ivs.length === 6); d.ivs.forEach(iv => int(iv,0,31));
    }
    for (const k of ['starterMoveData','starterEggMoveData']) if (s[k] !== undefined) {
      numericKeys(s[k], id => ids.has(id));
      for (const [key,value] of Object.entries(s[k])) {
        if (k === 'starterEggMoveData') int(value,0,2 ** (speciesEggMoves[key]?.length ?? 0) - 1);
        else if (Array.isArray(value)) moves(value);
        else { numericKeys(value, f => f < Math.max(getPokemonSpecies(Number(key)).forms.length,1)); Object.values(value).forEach(moves); }
      }
    }
    if (s.gameStats !== undefined) { record(s.gameStats); check(Object.keys(s.gameStats).every(k => Object.prototype.hasOwnProperty.call(new GameStats(),k)),'UNKNOWN_ORIGINAL_STAT'); Object.values(s.gameStats).forEach(counter); }
    if (s.unlocks !== undefined) { numericKeys(s.unlocks, id => [0,1,2].includes(id)); Object.values(s.unlocks).forEach(v => check(typeof v === 'boolean')); }
    for (const k of ['achvUnlocks','voucherUnlocks']) if (s[k] !== undefined) {
      record(s[k]);
      for (const [key,value] of Object.entries(s[k])) { check(Object.prototype.hasOwnProperty.call(k === 'achvUnlocks' ? achvs : vouchers,key), 'UNKNOWN_ORIGINAL_UNLOCK'); int(value); }
    }
    if (s.voucherCounts !== undefined) { numericKeys(s.voucherCounts, id => [0,1,2,3].includes(id)); Object.values(s.voucherCounts).forEach(v => int(v)); }
    originalOwnedEggStateCodec.restore({players:[s.eggs,[]]});
    // Exercise the original reviver, but return the untouched JSON: GameStats's
    // historical defaults/revival must not rewrite the user's raw counters.
    (GameData.prototype as any).parseSystemData(JSON.stringify(s));
    return s;
  },
  session(input: unknown) {
    initializeCatalogs();
    const s = json(input); exact(s, SESSION_KEYS); version(s);
    check(typeof s.seed === 'string' && s.seed.length > 0 && s.seed.length <= 256);
    counter(s.playTime); int(s.gameMode,0,3); int(s.money); counter(s.score); int(s.waveIndex,1); int(s.battleType,0,1);
    const ids = speciesIds();
    check(Array.isArray(s.party) && s.party.length >= 1 && s.party.length <= 6 && Array.isArray(s.enemyParty) && s.enemyParty.length <= 6);
    for (const [list,player] of [[s.party,true],[s.enemyParty,false]] as const) for (const p of list) {
      exact(p,['id','player','species','formIndex','abilityIndex','shiny','pokeball','level','exp','levelExp','gender','hp','stats','ivs','nature','moveset'],POKEMON_KEYS);
      check(ids.has(p.species) && p.player === player, 'INVALID_ORIGINAL_POKEMON');
      for (const k of ['id','level','exp','levelExp','hp','friendship','metLevel']) if (p[k] !== undefined) int(p[k]);
      check(p.level >= 1); int(p.formIndex,0,Math.max(getPokemonSpecies(p.species).forms.length - 1,0)); int(p.abilityIndex,0,2);
      int(p.nature,0,24); int(p.gender,-1,1); int(p.pokeball,0,5);
      check(typeof p.shiny === 'boolean' && Array.isArray(p.ivs) && p.ivs.length === 6); p.ivs.forEach(iv => int(iv,0,31));
      check(Array.isArray(p.stats) && p.stats.length === 6); p.stats.forEach(v => int(v));
      check(Array.isArray(p.moveset) && p.moveset.length > 0 && p.moveset.length <= 4);
      for (const m of p.moveset) { exact(m,['moveId','ppUsed','ppUp'],['virtual']); move(m.moveId); int(m.ppUsed,allMoves[m.moveId].pp === -1 ? -1 : 0); int(m.ppUp,0,3); if (m.virtual !== undefined) check(typeof m.virtual === 'boolean'); }
      if (p.status) { exact(p.status,['effect','turnCount'],['cureTurn']); int(p.status.effect,0,7); int(p.status.turnCount); if (p.status.cureTurn !== undefined) int(p.status.cureTurn); }
      if (p.fusionSpecies !== undefined && p.fusionSpecies !== null) check(ids.has(p.fusionSpecies), 'UNKNOWN_ORIGINAL_SPECIES');
      for (const k of ['pauseEvolutions','pokerus','fusionShiny','boss']) if (p[k] !== undefined) check(typeof p[k] === 'boolean');
      if (p.metBiome !== undefined) check(p.metBiome === -1 || typeof Biome[p.metBiome] === 'string','UNKNOWN_ORIGINAL_BIOME');
      if (p.fusionFormIndex !== undefined) int(p.fusionFormIndex,0,Math.max(getPokemonSpecies(p.fusionSpecies).forms.length-1,0));
      if (p.fusionAbilityIndex !== undefined) int(p.fusionAbilityIndex,0,2);
      if (p.fusionGender !== undefined) int(p.fusionGender,-1,1);
    }
    numericKeys(s.pokeballCounts, id => [0,1,2,3,4].includes(id)); Object.values(s.pokeballCounts).forEach(v => int(v));
    exact(s.arena,['biome','tags'],['weather']); check(typeof Biome[s.arena.biome] === 'string', 'UNKNOWN_ORIGINAL_BIOME');check(Array.isArray(s.arena.tags));
    if (s.arena.weather !== undefined && s.arena.weather !== null) {exact(s.arena.weather,['weatherType','turnsLeft']);int(s.arena.weather.weatherType,0,8);int(s.arena.weather.turnsLeft,-1);}
    for (const list of [s.modifiers,s.enemyModifiers]) { check(Array.isArray(list) && list.length <= 10000); for (const m of list) {
      exact(m,['player','typeId','args','stackCount','className'],['typeGeneratorId','typePregenArgs']);
      check(typeof m.player === 'boolean' && typeof m.className === 'string' && typeof m.typeId === 'string' && Array.isArray(m.args)); int(m.stackCount,1);
      check(typeof modifiers[m.className] === 'function' && !!getModifierTypeFuncById(m.typeId),'UNKNOWN_ORIGINAL_MODIFIER');
      if (m.typeGeneratorId !== undefined) check(typeof m.typeGeneratorId === 'string' && !!getModifierTypeFuncById(m.typeGeneratorId),'UNKNOWN_ORIGINAL_MODIFIER');
      if (m.typePregenArgs !== undefined) check(Array.isArray(m.typePregenArgs));
    } }
    if (s.trainer !== null) { exact(s.trainer,['trainerType','variant'],['partyTemplateIndex','name','partnerName']);
      check(typeof TrainerType[s.trainer.trainerType] === 'string', 'UNKNOWN_ORIGINAL_TRAINER');int(s.trainer.variant,0,2);
      if (s.trainer.partyTemplateIndex !== undefined) int(s.trainer.partyTemplateIndex);
      for (const k of ['name','partnerName']) if (s.trainer[k] !== undefined) check(typeof s.trainer[k] === 'string' && s.trainer[k].length <= 256);
    }
    GameData.prototype.parseSessionData(JSON.stringify(s));
    return s;
  },
  decodePrsv(text: string, type: 'system' | 'session') {
    check(type === 'system' || type === 'session','INVALID_LEGACY_TYPE');
    check(typeof text === 'string' && text.length <= 16 * 1024 * 1024, 'LOCAL_DATA_TOO_LARGE');
    // Existing GameData's .prsv wire key; a format constant, not authentication.
    const clear = AES.decrypt(text, 'x0i2O7WRiANTqPmZ').toString(enc.Utf8);
    const raw = type === 'system' ? (GameData.prototype as any).convertSystemDataStr(clear) : clear;
    const parsed = json(JSON.parse(raw));
    return type === 'system' ? originalSaveCodec.system(parsed) : originalSaveCodec.session(parsed);
  }
});
