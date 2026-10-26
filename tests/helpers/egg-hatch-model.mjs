import fs from 'node:fs';
import ts from 'typescript';
import {parse,evaluate,originalPokemon,pokemon,species,installPokemonTestDependencies} from './original-model.mjs';
import {codec} from './decision-model.mjs';
import {eggs,installEggTestDependencies} from './egg-model.mjs';
import {eggHatchPhases,installEggHatchTestDependencies,phaseCodec,evolutionModule} from './phase-model.mjs';
import {eggLapseContext,advanceEggs} from './egg-lapse-model.mjs';
import {compileReference,utils} from './move-execution-model.mjs';
import {advanceEggHatch} from "./reference-rules/egg-hatch-runner.mjs";
import {RandomDataGenerator,withSeedOffset} from '../../src/battle-core/random.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';

const enums=file=>evaluate(parse(file).statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n'));
const Species=enums('data/enums/species.ts').Species,eggTypes=enums('data/enums/egg-type.ts');
const starters=evaluate(parse('data/pokemon-species.ts').statements.find(n=>ts.isVariableStatement(n)
  &&n.declarationList.declarations.some(d=>d.name.getText()==='speciesStarters')).getText(),{},{Species}).speciesStarters;
// Explicit catalog/factory fixture boundary, NOT a replacement Pokemon
// constructor or production catalog. Selection, shiny, IV boost and egg move
// rules execute the actual original methods against these controlled inputs.
const ids=[1,4,7,123,147,151,150,384,489,490];
for(const id of ids)if(!species.has(id))species.set(id,{...species.get(1),speciesId:id,forms:[]});
for(const id of ids)Object.assign(species.get(id),{isObtainable:()=>true,isRegional:()=>id===123,isRareRegional:()=>id===123});
const catalog={speciesStarters:starters,getPokemonSpecies:id=>species.get(id)??{isObtainable:()=>false}};
let random;
const functions=['randSeedInt','randSeedItem','getSunday','decToBin','binToDec','getIvsFromId'];
const realUtils=evaluate('function getSceneRandom(){return getRandom();}\n'+parse('utils.ts').statements
  .filter(n=>ts.isFunctionDeclaration(n)&&functions.includes(n.name?.text)).map(n=>n.getText()).join('\n'),{},{getRandom:()=>random});
Object.assign(utils,realUtils);
installPokemonTestDependencies({'../utils':utils});
installEggTestDependencies({'../utils':utils,'./pokemon-species':catalog});
const prevolutions=evolutionModule.pokemonPrevolutions;
const rules={'./utils':utils,'./data/egg':eggs,'./data/enums/species':{Species},'./data/enums/egg-type':eggTypes,
  './data/pokemon-species':catalog,'./data/pokemon-evolutions':{pokemonPrevolutions:prevolutions}};
installEggHatchTestDependencies(rules);
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-egg-hatch-reference.json',import.meta.url),'utf8'));
const referenceGenerate=compileReference(frozen.generatePokemon,'',{Utils:utils,...eggs,Species,...eggTypes,...catalog,pokemonPrevolutions:prevolutions});
export async function hatchContext({seat=0,id=10001,gacha=0,timestamp=1000}={}){
  let c=await eggLapseContext({rows:[[],[]]});c.eggState.players[seat].push(new eggs.Egg(id,gacha,1,timestamp));
  c=(await advanceEggs(c)).context;return c;
}
export function hatchDriver(options={}){return {
  supports:(_c,p)=>p.constructor===eggHatchPhases.EggHatchPhase,
  async generateEggHatch(c,p,{seat}){
    const enclosing=random;random=new RandomDataGenerator(c.sceneRandom.capture());
    const scene={gameData:{trainerId:123+seat,secretId:456+seat},
      executeWithSeedOffset:(fn,offset,seed)=>{options.onSeed?.(offset,seed);return withSeedOffset(random,seed??c.scene.seed,offset,fn);},
      addPlayerPokemon(s,level,_a,_f,_g,shiny){
        options.onCreate?.(seat);
        const ret=originalPokemon(utils.randSeedInt(4294967296));
        Object.assign(ret,{species:s,level,shiny,ivs:utils.getIvsFromId(ret.id),fusionSpecies:null,scene});
        // Display only; actual trySetShiny is unchanged.
        ret.initShinySparkle=()=>{};
        return ret;
      }};
    p.scene=scene;
    try{
      options.onBind?.(c,p,scene,{seat});
      p.pokemon=options.reference?referenceGenerate.call(p):p.generatePokemon();
      delete p.pokemon.scene;delete p.pokemon.initShinySparkle;
      options.afterGenerate?.(c,p,{seat});
      return {completed:true,pendingTasks:0,events:[{kind:'egg-generated',seat}],grants:[]};
    }finally{delete p.scene;random=enclosing;}
  }
};}
export const advanceHatch=(c,options={})=>advanceEggHatch(c,codec,hatchDriver(options),{decisionId:c.decision.id+'-hatch'});
export async function referenceHatch(c){
  const d=selectNextPhase(c.continuation,()=>{throw Error('empty hatch');}).phase;
  const scope=phaseCodec.capture(d.phase,c).scope;
  const result=await hatchDriver({reference:true}).generateEggHatch(c,d.phase,{seat:scope});
  d.remaining='hatch-commit';c.decision={id:c.decision.id+'-hatch',kind:'continuing',requiredSeats:[],reason:'effects'};
  codec.capture(c);return {context:c,events:result.events,grants:[]};
}
