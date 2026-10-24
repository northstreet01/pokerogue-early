import { createModifierPoolState } from '../../src/battle-core/modifier-pool-state.mjs';
import { ruleModifierPools } from '../../src/battle-core/random-context.mjs';
import { observeRulePromise } from '../../src/battle-core/rule-task-tracker.mjs';
import ts from 'typescript';
import { parse, evaluate, read, pokemon, status } from './original-model.mjs';
import { createModifierStateCodec } from '../../src/battle-core/modifier-state.mjs';
import { createModifierTypeStateCodec } from '../../src/battle-core/modifier-type-state.mjs';
import {originalI18n,originalLocalizedPokemonMessage} from './localization-model.mjs';

const enums = file => evaluate(parse(file).statements.filter(ts.isEnumDeclaration).map(n => n.getText()).join('\n'));
const deps = file => Object.fromEntries(parse(file).statements.filter(ts.isImportDeclaration).map(n => [n.moduleSpecifier.text, {}]));
const utils = { toReadableString: s => s.toLowerCase(), padInt: v => String(v).padStart(3,'0'),
  getEnumValues: e => Object.values(e).filter(v => typeof v === 'number'),
  randSeedInt() { throw Error('RNG during restore'); }, randSeedItem() { throw Error('RNG during restore'); },
  IntegerHolder: class {constructor(value){this.value=value;}} };
const types = {}, dependencies = deps('modifier/modifier.ts');
dependencies['../messages'].getLocalizedPokemonMessage=originalLocalizedPokemonMessage((...args)=>dependencies['../messages'].getPokemonMessage(...args),p=>p.name);
export function installModifierTestDependencies(values){for(const [path,value]of Object.entries(values)){
 Object.assign(dependencies[path],value);
 if(path==='../messages')dependencies[path].getLocalizedPokemonMessage=originalLocalizedPokemonMessage((...args)=>dependencies[path].getPokemonMessage(...args),p=>dependencies[path].getPokemonNameWithAffix?.(p)??p.name);
}}
Object.assign(dependencies, { './modifier-type':types, '../battle-core/modifier-state.mjs':{createModifierStateCodec},
  '../i18n':{default:originalI18n},
  '../battle-core/rule-task-tracker.mjs':{observeRulePromise},
  '../utils':utils, '../field/pokemon':pokemon, '../data/pokemon-stat':enums('data/pokemon-stat.ts'),
  '../data/pokeball':enums('data/pokeball.ts'), '../system/voucher':enums('system/voucher.ts'),
  '../data/temp-battle-stat':enums('data/temp-battle-stat.ts'), '../data/type':enums('data/type.ts'),
  '../data/berry':enums('data/berry.ts'), '../data/pokemon-forms':enums('data/pokemon-forms.ts'), '../data/status-effect':status });
// Catalog baseStats and restored codec arrays are host-realm arrays. Keep the
// original vitamin instanceof Array check in that same test realm.
export const modifiers = evaluate(`const Phaser = { GameObjects: { Container: class { constructor(){throw Error('renderer');} } } };\n${read('modifier/modifier.ts')}`,dependencies,{Array});
const typeDependencies = deps('modifier/modifier-type.ts');
export function installModifierTypeTestDependencies(values){for(const [path,value]of Object.entries(values))Object.assign(typeDependencies[path],value);}
Object.assign(typeDependencies, {
  '../i18n':{default:originalI18n},
  './modifier-presentation':evaluate(read('modifier/modifier-presentation.ts'),{'../i18n':{default:originalI18n}}),
  '../battle-core/modifier-pool-state.mjs':{createModifierPoolState}, '../battle-core/random-context.mjs':{ruleModifierPools},
  './modifier':modifiers, '../battle-core/modifier-type-state.mjs':{createModifierTypeStateCodec}, '../utils':utils,
  '../data/move':{allMoves:{33:{name:'Tackle',type:0},57:{name:'Surf',type:10}}},
  '../data/pokeball':{...enums('data/pokeball.ts'),getPokeballName:()=> 'Ball',getPokeballDisplayName:()=> 'Ball',getPokeballCatchMultiplier:()=>1},
  '../data/pokemon-stat':{...enums('data/pokemon-stat.ts'),getStatName:()=> 'Stat'},
  '../data/temp-battle-stat':{...enums('data/temp-battle-stat.ts'),getTempBattleStatBoosterItemName:()=> 'X Stat',getTempBattleStatName:()=> 'Stat'},
  '../data/berry':{...enums('data/berry.ts'),getBerryName:()=> 'Berry',getBerryEffectDescription:()=> 'Berry effect'},
  '../data/type':enums('data/type.ts'), '../data/status-effect':{...status,getStatusEffectDescriptor:()=> 'Status'},
  '../system/voucher':{...enums('system/voucher.ts'),getVoucherTypeName:()=> 'Voucher',getVoucherTypeIcon:()=> 'voucher'},
  '../data/pokemon-evolutions':enums('data/pokemon-evolutions.ts'),
  '../data/pokemon-forms':enums('data/pokemon-forms.ts'),
  '../data/tms':{tmSpecies:{33:[],57:[]},tmPoolTiers:{33:0,57:1}}, './modifier-tier':enums('modifier/modifier-tier.ts')
});
Object.assign(types, evaluate(read('modifier/modifier-type.ts'),typeDependencies));
export {types};
export const modifierCodec = {capture:modifiers.captureModifierState,restore:modifiers.restoreModifierState,captureType:types.captureModifierTypeState};
export function originalModifier() {
  const type = types.modifierTypes.EXP_CHARM(); type.id='EXP_CHARM';
  return new modifiers.ExpBoosterModifier(type,25,2);
}
