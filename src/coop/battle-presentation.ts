import Phaser from 'phaser';
import type BattleScene from '../battle-scene';
import Pokemon, { PlayerPokemon, EnemyPokemon, FieldPosition, capturePokemonState, restorePokemonState } from '../field/pokemon';
import { getPokemonSpecies } from '../data/pokemon-species';
import { Type } from '../data/type';
import { getBiomeKey } from '../field/arena';

/** Original display Container around a codec copy, without a Pokemon constructor. */
export function createCoopPokemonDisplay(scene: BattleScene, model: Pokemon, player = true): Pokemon {
  const display = new Phaser.GameObjects.Container(scene, player ? 106 : 236, player ? 148 : 84);
  Object.setPrototypeOf(display, Object.getPrototypeOf(model));
  Object.assign(display, model, { scene });
  Object.assign(display, { randSeedInt: () => { throw new Error('CLIENT_RULE_RNG_FORBIDDEN'); } });
  (display as Pokemon).generateName();
  return display as Pokemon;
}

/** Display copies only. Never run a Pokemon constructor (which consumes RNG),
 * and never attach Phaser state to the consumer's verified rule instances. */
export class CoopBattlePresentation {
  private displayed: Pokemon[] = [];
  constructor(private scene: BattleScene) {}

  clear() {
    for (const pokemon of this.displayed) {
      const info = (pokemon as any).battleInfo;
      if (info) this.scene.tweens.killTweensOf(info);
      this.scene.tweens.killTweensOf(pokemon);
      pokemon.destroy();
    }
    this.displayed = [];
  }

  private container(model: Pokemon, player: boolean): Pokemon {
    // Phaser's Container initializes events/transforms/list ownership. Copying
    // an uninitialized checkpoint directly into the display list cannot do so.
    return createCoopPokemonDisplay(this.scene, model, player);
  }

  private publicModel(view: any): Pokemon {
    const model = Object.create(view.owner === null ? EnemyPokemon.prototype : PlayerPokemon.prototype);
    Object.assign(model, { species: getPokemonSpecies(view.speciesId), formIndex: view.formIndex,
      id: view.id, level: view.level, hp: view.hp, gender: view.gender, shiny: view.shiny,
      moveset: [], exp: 0, levelExp: 0,
      // These methods expose public display facts, not invented combat stats,
      // ability, moves, IVs or random state for a teammate/enemy.
      getMaxHp: () => view.maxHp, getTeraType: () => Type.UNKNOWN,
      getDexAttr: () => 0n,
      randSeedInt: () => { throw new Error('CLIENT_RULE_RNG_FORBIDDEN'); },
    });
    model.name = model.species.getName(model.formIndex);
    return model;
  }

  async apply(snapshot: any, applied: any) {
    this.clear();
    const shared = snapshot.shared;
    const make = (id: number | null): Pokemon | null => {
      if (id === null) return null;
      const view = shared.pokemon.find((p: any) => p.id === id);
      if (!view) throw new Error('PUBLIC_FIELD_MODEL_MISSING');
      const owned = applied.byId.get(id);
      const model = owned ? restorePokemonState(capturePokemonState(owned.pokemon)) : this.publicModel(view);
      const display = this.container(model, view.owner !== null);
      this.displayed.push(display);
      return display;
    };
    const field = shared.field.map(make);
    // Preserve both global seats, including an empty/fainted seat. Never shift
    // seat 1 or a private bench member into seat 0's field position.
    (this.scene as any).party = field.slice(0, 2);
    this.scene.currentBattle = { ...shared, enemyParty: field.slice(2, 4),
      randSeedInt: () => { throw new Error('CLIENT_RULE_RNG_FORBIDDEN'); } } as any;
    const biomeKey = getBiomeKey(shared.biome);
    // Original shaders read these scene/arena values. A browser's fresh scene
    // offset would otherwise give each seat (and each refresh) different light.
    this.scene.waveCycleOffset = shared.waveCycleOffset;
    this.scene.arena.biomeType = shared.biome;
    this.scene.arenaBg.setTexture(`${biomeKey}_bg`).setPosition(0, 0);
    this.scene.arenaBg.pipelineData = { terrainColorRatio: shared.terrainColorRatio };
    this.scene.arenaBgTransition.setVisible(false);
    // Reuse the original base containers/textures without calling setBiome's
    // decorative RNG or starting an EncounterPhase on the browser.
    for (const base of [this.scene.arenaPlayer, this.scene.arenaEnemy]) {
      base.base.setTexture(`${biomeKey}_${base.player ? 'a' : 'b'}`);
      base.add(base.base);
      base.setPosition(0, 0).setVisible(true);
      base.props.forEach(prop => prop.setVisible(false));
    }
    this.scene.trainer.setVisible(false);
    try {
      for (const pokemon of this.displayed) {
        pokemon.init();
        this.scene.field.add(pokemon);
        await pokemon.loadAssets();
        // The original immediate branch changes position but does not resolve
        // its Promise; do not await that legacy presentation-only return value.
        void pokemon.setFieldPosition(pokemon.getFieldIndex() ? FieldPosition.RIGHT : FieldPosition.LEFT);
        await pokemon.updateInfo(true);
        // Snapshot application shows the final frame, without replaying rule
        // phases or their animation callbacks.
        (pokemon as any).battleInfo.setVisible(true);
        pokemon.setVisible(pokemon.hp > 0);
      }
    } catch (error) { this.clear(); throw error; }
    return field;
  }
}
