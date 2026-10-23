import ts from 'typescript';
import {parse,evaluate,pokemon,weather,moveCatalog} from './original-model.mjs';
import {types} from './modifier-model.mjs';
import {createPhaseStateCodec} from '../../src/battle-core/phase-state.mjs';
import {createCatalogReferenceCodec} from '../../src/battle-core/catalog-reference.mjs';
import {selectSwitchSummon} from '../../src/battle-core/switch-command.mjs';
import {finishSwitchSummon} from '../../src/battle-core/switch-finish.mjs';
import {executeMoveAction} from '../../src/battle-core/move-action.mjs';
import {checkMoveHit} from '../../src/battle-core/move-hit-check.mjs';
import {queueFaintContinuation} from '../../src/battle-core/faint-queue.mjs';
import {queueVictoryExperience} from '../../src/battle-core/victory-experience.mjs';
import {presentOnHost} from '../../src/battle-core/presentation-port.mjs';
import {eggs} from './egg-model.mjs';

const declarations=file=>parse(file).statements.filter(n=>ts.isClassDeclaration(n)||ts.isEnumDeclaration(n)||ts.isImportDeclaration(n)).map(n=>n.getText()).join('\n');
const dependencies=file=>Object.fromEntries(parse(file).statements.filter(ts.isImportDeclaration).map(n=>[n.moduleSpecifier.text,{}]));
class Phase{constructor(scene){this.scene=scene;}start(){}end(){this.scene.shiftPhase();}}
const deps=dependencies('phases.ts');
// Keep the legacy isolated rule tests wired to the actual extracted visual
// helpers. Rendering ports stay in their existing scenes; no replacement rules.
Object.assign(deps['./data/pokeball'],evaluate(parse('data/pokeball.ts').statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n')));
deps['./field/pokemon-exit-animation']=evaluate(parse('field/pokemon-exit-animation.ts').getText(),{
  '../data/pokeball':deps['./data/pokeball'],'../battle-core/presentation-port.mjs':{presentOnHost}});
deps['./field/pokemon-summon-animation']=evaluate(parse('field/pokemon-summon-animation.ts').getText(),{
  '../data/pokeball':deps['./data/pokeball'],'./anims':deps['./field/anims'],
  '../battle-core/presentation-port.mjs':{presentOnHost}});
deps['./field/encounter-animation']=evaluate(parse('field/encounter-animation.ts').getText());
Object.assign(deps,{'./phase':{Phase},'./battle-core/switch-command.mjs':{selectSwitchSummon},'./battle-core/switch-finish.mjs':{finishSwitchSummon},
  './battle-core/move-action.mjs':{executeMoveAction},'./battle-core/move-hit-check.mjs':{checkMoveHit},
  './battle-core/faint-queue.mjs':{queueFaintContinuation},'./battle-core/victory-experience.mjs':{queueVictoryExperience},
  './battle-core/presentation-port.mjs':{presentOnHost}});
// Rendering-only mask constructor; actual stat rules still execute in the original Phase.
export const phaseRenderGlobals={Phaser:{Display:{Masks:{BitmapMask:class{}}},Math:{Linear:(a,b,t)=>(b-a)*t+a}},
  setTimeout:callback=>Promise.resolve().then(callback)};
export const originalPhases=evaluate(declarations('phases.ts'),deps,phaseRenderGlobals);
export function installPhaseTestDependencies(values){for(const [path,value]of Object.entries(values))Object.assign(deps[path],value);}
const evolutionPhaseDeps={...dependencies('evolution-phase.ts'),'./phase':{Phase},'./phases':originalPhases};
export const evolutionPhases=evaluate(declarations('evolution-phase.ts'),evolutionPhaseDeps);
export function installEvolutionTestDependencies(values){for(const [path,value]of Object.entries(values))Object.assign(evolutionPhaseDeps[path],value);}
export const formPhases=evaluate(declarations('form-change-phase.ts'),{...dependencies('form-change-phase.ts'),'./phases':originalPhases,'./evolution-phase':evolutionPhases});
const eggHatchDeps={...dependencies('egg-hatch-phase.ts'),'./phase':{Phase},'./data/egg':eggs};
export const eggHatchPhases=evaluate(declarations('egg-hatch-phase.ts'),eggHatchDeps);
export function installEggHatchTestDependencies(values){for(const [path,value]of Object.entries(values))Object.assign(eggHatchDeps[path],value);}
installPhaseTestDependencies({'./egg-hatch-phase':eggHatchPhases});
export const phaseConstructors={...originalPhases,...evolutionPhases,...formPhases,...eggHatchPhases};

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
