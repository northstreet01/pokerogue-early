import {cycleContext,advanceCycle,runCycleReference,chooseCycleInputs} from './command-cycle-model.mjs';
import {moves,pokemon,battler} from './original-model.mjs';

export async function mixedContext({forcedSeats=[1],mode='queued',move=moves.Moves.TACKLE,invalidHead=false}={}){
  const c=await cycleContext({seed:'mixed-commands'});
  for(const seat of forcedSeats){const p=c.roster.entries[seat].pokemon;
    p.moveset=[new pokemon.PokemonMove(move,0,0,false)];
    if(mode==='queued')p.summonData.moveQueue=[...(invalidHead?[{move:moves.Moves.SURF,targets:[2],ignorePP:false}]:[]),
      {move,targets:[2],ignorePP:false}];
    else{const tag=battler.getBattlerTag('ENCORE',3,moves.Moves.ENCORE,p.id);tag.moveId=move;p.summonData.tags.push(tag);}
  }
  c.decision={id:'mixed-0',kind:'continuing',requiredSeats:[],reason:'effects'};
  return c;
}
export const advanceMixed=(c,inputs={},options={})=>advanceCycle(c,inputs,{...options,allowSuspend:true});
export const referenceMixed=(c,inputs={})=>runCycleReference(c,inputs,{allowSuspend:true});
export const chooseMixedInputs=c=>c.decision.kind==='continuing'?{}:chooseCycleInputs(c);
