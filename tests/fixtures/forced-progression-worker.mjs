// TEST ONLY. The production Worker never imports this module. The user
// authorized accelerated progression checks; this is not normal-combat proof.
import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
const api=createRequire(import.meta.url)('../../build/coop-runtime/original-runtime.cjs');
api.describeOriginalCatalogs();
const probe=api.createOriginalRuntime(workerData.seed,workerData.identity);
const enemyPrototype=Object.getPrototypeOf(api.constructOriginalPokemon(probe,1,5,true));
const enemyDamage=enemyPrototype.damage,playerDamage=api.PlayerPokemon.prototype.damage;
const damageTrace=[];
const recordDamage=(pokemon,amount,result)=>{
 const phase=pokemon.scene.currentPhase;
 damageTrace.push({id:pokemon.id,species:pokemon.species.speciesId,amount:String(amount),hp:String(pokemon.hp),result:String(result),
  phase:phase?.constructor.name,move:phase?.move?.moveId??phase?.move?.id,stack:amount<0?new Error().stack:undefined});
 if(damageTrace.length>12)damageTrace.shift();
 return result;
};
// Keep original AI, hit/ability/status rules, Faint/Victory, Boss segment
// handling, RNG, rewards and map phases. Only the actual damage amount differs.
enemyPrototype.damage=function(amount,...args){return recordDamage(this,amount,enemyDamage.call(this,amount>0?this.hp:amount,...args));};
api.PlayerPokemon.prototype.damage=function(amount,...args){return recordDamage(this,amount,playerDamage.call(this,0,...args));};
const runtime=api.createOriginalRuntime(workerData.seed,workerData.identity);
let chain=Promise.resolve();
parentPort.on('message',({id,operation,payload})=>{chain=chain.then(async()=>{
 try{parentPort.postMessage({id,value:await api.executeRuntimeOperation(runtime,operation,payload)});}
 catch(error){parentPort.postMessage({id,error:error.code??error.message,detail:error.stack+'\nDAMAGE_TRACE '+JSON.stringify(damageTrace)});}
});});
parentPort.postMessage({type:'ready'});
