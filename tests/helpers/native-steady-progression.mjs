import {createRequire} from 'node:module';
import {createOriginalCoopAdapter} from "./original-adapter.mjs";
import {defaultTrainerRoute} from './native-default-trainer.mjs';

// A legal-input test player, not a battle simulator. Every effect, price,
// enemy, map and outcome is supplied by the production original-rule adapter.
export function steadyInput(api,c){
 const d=c.decision,inputs={};
 if(d.kind==='preparation'){
  const sub=d.players.find(p=>p.subdecision)?.subdecision;
  if(sub)return steadyInput(api,{...c,decision:sub});
 }
 const party=seat=>c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index);
 const score=(pokemon,cursor)=>{const move=api.allMoves[pokemon.fields.moveset[cursor].fields.moveId];return Math.max(move.power,0)*(move.accuracy<0?1:move.accuracy/100);};
 const types=p=>{const s=api.getPokemonSpecies(p.fields.species),f=s.forms[p.fields.formIndex]??s;return [f.type1,f.type2].filter(t=>t!==null&&t!==undefined);};
 const moveScore=(p,option)=>{
  const move=api.allMoves[p.fields.moveset[option.cursor].fields.moveId];
  const target=c.roster.entries.find(e=>e.pokemon.fields.id===c.roster.field[option.target])?.pokemon;
  const effectiveness=target?types(target).reduce((value,type)=>value*api.getTypeDamageMultiplier(move.type,type),1):1;
  // Only a test player's preference; all actual damage remains original rules.
  return score(p,option.cursor)*effectiveness*(types(p).includes(move.type)?1.5:1)
   *(move.category===0?p.fields.stats[1]:p.fields.stats[3])/(target?(move.category===0?target.fields.stats[2]:target.fields.stats[4]):1);
 };
 if(d.kind==='wait-actions')for(const seat of d.requiredSeats){
  const p=party(seat)[0].pokemon,options=d.options[seat];
  const bench=options.filter(o=>o.kind==='switch').toSorted((a,b)=>party(seat).find(e=>e.pokemon.fields.id===b.pokemonId).pokemon.fields.hp-party(seat).find(e=>e.pokemon.fields.id===a.pokemonId).pokemon.fields.hp);
  if(p.fields.hp<p.fields.stats[0]/4&&bench.length&&party(seat).find(e=>e.pokemon.fields.id===bench[0].pokemonId).pokemon.fields.hp>p.fields.hp*2){inputs[seat]=bench[0];continue;}
  inputs[seat]=options.filter(o=>o.kind==='fight'&&(o.target===null||o.target>=2)).toSorted((a,b)=>moveScore(p,b)-moveScore(p,a)
   ||((a.target===2+seat)?-1:1))[0];
 }else if(d.kind==='wait-target'){
  const seat=d.requiredSeats[0];inputs[seat]=d.options[seat].find(o=>o.target>=2)??d.options[seat][0];
 }else if(d.kind==='preparation'){
  const seat=d.requiredSeats.find(s=>!d.players[s].ready),p=d.players[seat],owned=party(seat);
  const sold=o=>d.shared?.shopClaims.some(claim=>claim.optionId===o.id);
  const dead=owned.find(e=>e.pokemon.fields.hp===0),hurt=owned.filter(e=>e.pokemon.fields.hp>0&&e.pokemon.fields.hp<e.pokemon.fields.stats[0]*0.9).sort((a,b)=>a.index-b.index)[0];
  const revive=dead&&p.shop.find(o=>!sold(o)&&['REVIVE','MAX_REVIVE'].includes(o.type.catalogId)&&o.cost<=c.players[seat].money);
  const item=revive??(hurt&&p.shop.find(o=>!sold(o)&&['POTION','SUPER_POTION','HYPER_POTION','MAX_POTION'].includes(o.type.catalogId)&&o.cost<=c.players[seat].money));
  if(item)inputs[seat]={kind:'preparation',operation:'buy',optionId:item.id,pokemonId:(revive?dead:hurt).pokemon.fields.id,moveIndex:null,fusionId:null};
  else{
   const available=p.rewards.filter(o=>!d.shared?.rewardClaims.some(claim=>claim.optionId===o.id));
   const healing=dead&&available.find(o=>['REVIVE','MAX_REVIVE'].includes(o.type.catalogId))
    ||hurt&&available.find(o=>['POTION','SUPER_POTION','HYPER_POTION','MAX_POTION'].includes(o.type.catalogId));
   const reward=healing??available.find(o=>['EXP_SHARE','SUPER_EXP_CHARM','EXP_CHARM','HEALING_CHARM','NUGGET','BIG_NUGGET','POKEBALL','GREAT_BALL'].includes(o.type.catalogId))
    ??available.find(o=>o.type.catalogId==='RARE_CANDY');
   const target=reward?.type.catalogId==='RARE_CANDY'?owned[0]:healing?(dead&&['REVIVE','MAX_REVIVE'].includes(healing.type.catalogId)?dead:hurt):null;
   inputs[seat]=p.rewardResolved?{kind:'preparation',operation:'ready'}:reward?{kind:'preparation',operation:'reward',optionId:reward.id,pokemonId:target?.pokemon.fields.id??null,moveIndex:null,fusionId:null}:{kind:'preparation',operation:'skip-reward'};
  }
 }else if(d.kind==='learn-move'){
  const seat=d.requiredSeats[0],pokemon=party(seat).find(e=>e.pokemon.fields.id===d.learn.pokemonId).pokemon;
  const weakest=pokemon.fields.moveset.map((m,i)=>({i,power:score(pokemon,i)})).sort((a,b)=>a.power-b.power)[0];
  const move=api.allMoves[d.learn.moveId];
  inputs[seat]=d.options[seat].find(o=>o.slot===(move.power>weakest.power?weakest.i:null));
 }else if(d.kind==='evolution'){
  inputs[d.requiredSeats[0]]={kind:'evolution',pokemonId:d.pokemonId,choice:d.stage==='pause-confirm'?'continue':'evolve'};
 }else if(['switch-confirm','switch-select','wait-switch'].includes(d.kind)){
  const seat=d.requiredSeats[0],options=d.options[seat];
  inputs[seat]=options.find(o=>o.accept===false||o.choice==='evolve')??options[0];
 }else if(d.kind!=='continuing')throw Error('STEADY_INPUT_UNHANDLED_'+d.kind);
 return inputs;
}

export async function steadyRoute({seed='learning-natural-2',untilWave=26,onStep=()=>{},initialSaved,parties}={}){
 const api=createRequire(import.meta.url)('../../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();
 let saved=initialSaved;
 if(!saved){
  const initial=await defaultTrainerRoute({seed,parties});await initial.h.close();
  const provisioning={seed,identities:initial.profiles.map(p=>p.trainer),sharedPreparation:true};
  saved={formatVersion:3,runId:'steady-'+seed,stage:'battle',provisioning,lobby:null,nativeCheckpoint:initial.initial,intents:[]};
 }
 const adapter=createOriginalCoopAdapter();
 let ctx=await adapter.restoreCheckpoint(saved);const milestones=new Map(),trace=[];
 try{
  for(let n=0;n<3000;n++){
   const c=saved.nativeCheckpoint,step={step:n,wave:c.battle.waveIndex,kind:c.decision.kind};trace.push(step);onStep(step,saved);
   if(c.decision.kind==='wait-actions'&&!milestones.has(c.battle.waveIndex))milestones.set(c.battle.waveIndex,structuredClone(saved));
   if(c.battle.waveIndex>=untilWave||c.decision.kind==='ended')return {saved,trace,milestones};
   try{const r=await adapter.advanceToDecision(ctx,steadyInput(api,c));step.phases=r.events.filter(e=>e.kind==='phase-start').map(e=>e.phase);ctx=r.context;saved=await adapter.captureCheckpoint(ctx);}
   catch(error){step.error=error.code??error.message;return {saved,trace,milestones,error:step.error};}
  }
  throw Error('STEADY_BUDGET_EXCEEDED');
 }finally{await adapter.closeAll();}
}
