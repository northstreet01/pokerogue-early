import { BattleSpec } from "./enums/battle-spec";
import Pokemon from "./field/pokemon";
import i18next from './i18n';
import {presentationText,rememberPresentationText} from './system/presentation-text.mjs';

function pokemonNameParts(pokemon:Pokemon) {
  let affix: string;
  switch (pokemon.scene.currentBattle.battleSpec) {
    case BattleSpec.DEFAULT:
      affix = !pokemon.isPlayer() ? pokemon.hasTrainer() ? 'foePokemonWithAffix' : 'wildPokemonWithAffix' : '';
      break;
    case BattleSpec.FINAL_BOSS:
      affix = !pokemon.isPlayer() ? 'foePokemonWithAffix' : '';
      break;
  }
  const name=affix ? i18next.t(`battle:${affix}`, { pokemonName: pokemon.name }) : pokemon.name;
  return {name,descriptor:{kind:'pokemon-name',pokemonId:pokemon.id,affix:affix??'',fallback:pokemon.name}};
}

export function getPokemonNameWithAffix(pokemon: Pokemon): string {
  return pokemonNameParts(pokemon).name;
}

export function getPokemonMessage(pokemon: Pokemon, content: string): string {
  const {name,descriptor}=pokemonNameParts(pokemon);
  return rememberPresentationText(`${name}${content}`,{kind:'joined',parts:[descriptor,presentationText(content)??content]});
}

/** Reuse the original complete Chinese sentence; keep early's English display
 * unchanged. Lazy arguments avoid introducing extra rule reads in either path. */
export function getLocalizedPokemonMessage(pokemon:Pokemon,key:string,values:()=>Record<string,any>,legacy:()=>string):string {
  if ((i18next.resolvedLanguage??i18next.language)==='zh-Hans') {
    const name=getPokemonNameWithAffix(pokemon);
    return String(i18next.t(key,{pokemonNameWithAffix:name,pokemonName:name,...values()}));
  }
  return getPokemonMessage(pokemon,legacy());
}
