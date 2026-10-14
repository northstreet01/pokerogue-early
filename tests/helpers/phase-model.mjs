import ts from 'typescript';
import {parse,evaluate,pokemon,weather,moveCatalog} from './original-model.mjs';
import {types} from './modifier-model.mjs';
import {createPhaseStateCodec} from '../../src/battle-core/phase-state.mjs';
import {createCatalogReferenceCodec} from '../../src/battle-core/catalog-reference.mjs';
import {selectSwitchSummon} from '../../src/battle-core/switch-command.mjs';
import {finishSwitchSummon} from '../../src/battle-core/switch-finish.mjs';
import {executeMoveAction} from '../../src/battle-core/move-action.mjs';
import {checkMoveHit} from '../../src/battle-core/move-hit-check.mjs';

const declarations=file=>parse(file).statements.filter(n=>ts.isClassDeclaration(n)||ts.isEnumDeclaration(n)||ts.isImportDeclaration(n)).map(n=>n.getText()).join('\n');
const dependencies=file=>Object.fromEntries(parse(file).statements.filter(ts.isImportDeclaration).map(n=>[n.moduleSpecifier.text,{}]));
class Phase{constructor(scene){this.scene=scene;}start(){}end(){this.scene.shiftPhase();}}
const deps=dependencies('phases.ts');
Object.assign(deps,{'./phase':{Phase},'./battle-core/switch-command.mjs':{selectSwitchSummon},'./battle-core/switch-finish.mjs':{finishSwitchSummon},
  './battle-core/move-action.mjs':{executeMoveAction},'./battle-core/move-hit-check.mjs':{checkMoveHit}});
export const originalPhases=evaluate(declarations('phases.ts'),deps);
export function installPhaseTestDependencies(values){for(const [path,value]of Object.entries(values))Object.assign(deps[path],value);}
export const evolutionPhases=evaluate(declarations('evolution-phase.ts'),{...dependencies('evolution-phase.ts'),'./phase':{Phase},'./phases':originalPhases});
export const formPhases=evaluate(declarations('form-change-phase.ts'),{...dependencies('form-change-phase.ts'),'./phases':originalPhases,'./evolution-phase':evolutionPhases});
export const phaseConstructors={...originalPhases,...evolutionPhases,...formPhases};

const enums=file=>evaluate(parse(file).statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n'));
const evolutionDeps=dependencies('data/pokemon-evolutions.ts');
Object.assign(evolutionDeps,{'./enums/species':enums('data/enums/species.ts'),'./pokemon-species':enums('data/pokemon-species.ts'),
  './gender':enums('data/gender.ts'),'./enums/biome':enums('data/enums/biome.ts'),'./enums/time-of-day':enums('data/enums/time-of-day.ts'),
  './nature':enums('data/nature.ts'),'./type':enums('data/type.ts'),'./pokemon-stat':enums('data/pokemon-stat.ts')});
export const evolutionModule=evaluate(parse('data/pokemon-evolutions.ts').getText(),evolutionDeps);
export const evolutionRule=evolutionModule.pokemonEvolutions[1][0];
export const evolutionCodec=createCatalogReferenceCodec(evolutionModule.pokemonEvolutions);
const formDeps=dependencies('data/pokemon-forms.ts');
Object.assign(formDeps,{'./enums/species':enums('data/enums/species.ts'),'./pokemon-species':enums('data/pokemon-species.ts'),
  './enums/time-of-day':enums('data/enums/time-of-day.ts'),'./status-effect':enums('data/status-effect.ts'),
  './enums/moves':enums('data/enums/moves.ts'),'./ability':enums('data/ability.ts'),'./move':enums('data/move.ts')});
export const formModule=evaluate(parse('data/pokemon-forms.ts').getText(),formDeps);
export const formRule=Object.values(formModule.pokemonFormChanges)[0][0];
export const formCodec=createCatalogReferenceCodec(formModule.pokemonFormChanges);
export const phaseCodec=createPhaseStateCodec({constructors:phaseConstructors,evolution:evolutionCodec,formChange:formCodec,
  modifierType:{capture:types.captureModifierTypeState,restore:types.restoreModifierTypeState},
  weather:{capture:weather.captureWeatherState,restore:weather.restoreWeatherState},
  pokemon:{captureMove:pokemon.capturePokemonMoveState,restoreMove:pokemon.restorePokemonMoveState,capturePokemon:pokemon.capturePokemonState,restorePokemon:pokemon.restorePokemonState},hasMove:id=>!!moveCatalog[id]});
