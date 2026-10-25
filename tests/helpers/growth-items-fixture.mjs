import assert from 'node:assert/strict';
import {defaultTrainerRoute,progressDefault} from './native-default-trainer.mjs';
export const member=(c,seat,index=0)=>c.roster.entries.find(e=>e.owner===seat&&e.group==='party'&&e.index===index);
export async function originalPreparationFixture(){
 const route=await defaultTrainerRoute();try{let c=route.initial;
 for(let n=0;n<100;n++){
  const front=(c.continuation.phaseQueuePrepend.at(-1)??c.continuation.phaseQueue[0])?.phase.type;
  if(c.decision.kind==='continuing'&&front==='SelectModifierPhase')return {route,before:c,base:(await route.h.request('native-preparation-shared',c)).checkpoint};
  c=(await progressDefault(route.h,c)).checkpoint;
 }assert.fail('original reward menu not reached');
 }catch(error){await route.h.close();throw error;}
}
export function growthItemFixture(api,base,kind,seat=0){
 const c=structuredClone(base),runtime=api.createOriginalRuntime(c.scene.seed,{trainerId:1,secretId:2});
 const entry=member(c,seat),id=entry.pokemon.fields.id;
 // Synthetic original catalog/target fixture, not a natural draw or user save.
 const p=api.constructOriginalPokemon(runtime,133,5);p.id=id;entry.pokemon=api.capturePokemonState(p);
 const factory=api.modifierTypes[kind],type=api.withStarterRandomContext(runtime.context,()=>factory().withIdFromFunc(factory).generateType([p],kind==='EVOLUTION_ITEM'?[5]:undefined));
 assert.ok(type);const option={id:'fixture-item',type:api.captureModifierTypeState(type),cost:0};
 for(const row of c.decision.players)row.rewards=[structuredClone(option)];
 return {c,option,id,type};
}
export const reward=(option,id)=>({kind:'preparation',operation:'reward',optionId:option.id,pokemonId:id,moveIndex:null,fusionId:null});
