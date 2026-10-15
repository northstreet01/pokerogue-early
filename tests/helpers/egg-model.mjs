import ts from 'typescript';
import {parse,read,evaluate} from './original-model.mjs';
import {createOwnedEggStateCodec} from '../../src/battle-core/egg-state.mjs';
const deps=Object.fromEntries(parse('data/egg.ts').statements.filter(ts.isImportDeclaration).map(n=>[n.moduleSpecifier.text,{}]));
const eggTypes=evaluate(read('data/enums/egg-type.ts'));
deps['./enums/egg-type']=eggTypes;
export const eggs=evaluate(read('data/egg.ts'),deps);
export function installEggTestDependencies(values){for(const [path,value]of Object.entries(values))Object.assign(deps[path],value);}
export const eggCodec=createOwnedEggStateCodec({Egg:eggs.Egg,seed:eggs.EGG_SEED,gachaTypes:[0,1,2],tiers:[0,1,2,3]});
export const eggData=evaluate(read('system/egg-data.ts'),{'../data/egg':eggs});
