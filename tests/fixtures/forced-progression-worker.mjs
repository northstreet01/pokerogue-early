// TEST ONLY. The production Worker never imports this module. The user
// authorized accelerated progression checks; this is not normal-combat proof.
import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
const api=createRequire(import.meta.url)('../../build/coop-runtime/original-runtime.cjs');
api.describeOriginalCatalogs();
const probe=api.createOriginalRuntime(workerData.seed,workerData.identity);
const enemyPrototype=Object.getPrototypeOf(api.constructOriginalPokemon(probe,1,5,true));
const enemyDamage=enemyPrototype.damage,playerDamage=api.PlayerPokemon.prototype.damage;
// Keep original AI, hit/ability/status rules, Faint/Victory, Boss segment
// handling, RNG, rewards and map phases. Only the actual damage amount differs.
enemyPrototype.damage=function(amount,...args){return enemyDamage.call(this,amount>0?this.hp:amount,...args);};
api.PlayerPokemon.prototype.damage=function(_amount,...args){return playerDamage.call(this,0,...args);};
const runtime=api.createOriginalRuntime(workerData.seed,workerData.identity);
let chain=Promise.resolve();
parentPort.on('message',({id,operation,payload})=>{chain=chain.then(async()=>{
 try{parentPort.postMessage({id,value:await api.executeRuntimeOperation(runtime,operation,payload)});}
 catch(error){parentPort.postMessage({id,error:error.code??error.message,detail:error.stack});}
});});
parentPort.postMessage({type:'ready'});
