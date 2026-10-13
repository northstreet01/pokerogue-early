import { BattleSpec } from "./enums/battle-spec";
import Pokemon from "./field/pokemon";
import i18next from './i18n';

export function getPokemonNameWithAffix(pokemon: Pokemon): string {
  let affix: string;
  switch (pokemon.scene.currentBattle.battleSpec) {
    case BattleSpec.DEFAULT:
      affix = !pokemon.isPlayer() ? pokemon.hasTrainer() ? 'foePokemonWithAffix' : 'wildPokemonWithAffix' : '';
      break;
    case BattleSpec.FINAL_BOSS:
      affix = !pokemon.isPlayer() ? 'foePokemonWithAffix' : '';
      break;
  }
  return affix ? i18next.t(`battle:${affix}`, { pokemonName: pokemon.name }) : pokemon.name;
}

export function getPokemonMessage(pokemon: Pokemon, content: string): string {
  return `${getPokemonNameWithAffix(pokemon)}${content}`;
}
