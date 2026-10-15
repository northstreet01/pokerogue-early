import {effectContext,effectsDriver,optionAction} from './preparation-effects-model.mjs';
import {codec,safeCodec} from './decision-model.mjs';
import {types,modifiers,installModifierTestDependencies} from './modifier-model.mjs';
import {originalPhases} from './phase-model.mjs';
import {pokemon} from './original-model.mjs';
import {expRules} from './experience-model.mjs';
import {progressionDriver} from './level-up-model.mjs';
import {advancePreparationEffect,validatePreparationEffect} from '../../src/battle-core/preparation-effects-runner.mjs';
import {advancePreparationGrowth} from '../../src/battle-core/preparation-growth-runner.mjs';
import {copy} from '../../src/battle-core/coop-contract.mjs';
import {projectPreparation,restorePreparation} from './preparation-model.mjs';
import {createSnapshotConsumer} from '../../src/battle-core/coop-client.mjs';
export {optionAction};

installModifierTestDependencies({'../phases':{LevelUpPhase:originalPhases.LevelUpPhase},'../data/exp':expRules});
const owned=(c,seat)=>c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index);
export async function growthContext({seat=0,level=5,full=false,all=false,booster=0,pause=false}={}){
  const c=await effectContext();
  for(const e of owned(c,seat)){
    const pk=e.pokemon;pk.level=level;pk.exp=expRules.getLevelTotalExp(level,pk.species.growthRate);pk.levelExp=0;pk.pauseEvolutions=pause;
    pk.moveset=(full?[33,57,45,73]:[33,57]).map(id=>new pokemon.PokemonMove(id));pk.summonData.moveset=null;
  }
  const type=types.modifierTypes[all?'RARER_CANDY':'RARE_CANDY']();type.id=all?'RARER_CANDY':'RARE_CANDY';
  c.decision.players[seat].rewards=[{id:'fixture-candy',type:types.captureModifierTypeState(type),cost:0}];
  if(booster){const t=types.modifierTypes.CANDY_JAR();t.id='CANDY_JAR';c.players[seat].modifiers.push(new modifiers.LevelIncrementBoosterModifier(t,booster));}
  return codec.restore(copy(codec.capture(c)));
}
export const growthIntent=(c,seat=0)=>optionAction(c,seat,'reward',c.decision.players[seat].rewards[0].type.catalogId,
  c.decision.players[seat].rewards[0].type.catalogId==='RARE_CANDY'?owned(c,seat)[0].pokemon.id:null);
export function validateGrowth(c,seat,a){
  if(c.decision.kind==='preparation'&&c.decision.players[seat].subdecision!==null){safeCodec.validateAction(c,seat,a);return;}
  validatePreparationEffect(c,seat,a,safeCodec,effectsDriver({progression:true}));
}
export async function executeGrowth(c,seat,a,options={}){
  validateGrowth(c,seat,a);
  if(c.decision.players[seat].subdecision!==null)
    return advancePreparationGrowth(c,seat,a,codec,safeCodec,progressionDriver(options));
  const r=await advancePreparationEffect(c,seat,a,codec,safeCodec,effectsDriver({...options,progression:true}));
  if(!r.context.pendingEffects.some(e=>e.id.startsWith(`preparation-growth-${seat}-`)))return r;
  const next=await advancePreparationGrowth(r.context,seat,null,codec,safeCodec,progressionDriver(options));
  return {context:next.context,events:[...r.events,...next.events],grants:[...r.grants,...next.grants]};
}
export function growthChoice(c,seat,{slot=0,evolve='evolve',pause='pause'}={}){
  const d=c.decision.players[seat].subdecision;
  return d.kind==='learn-move'?{kind:'learn-move',pokemonId:d.learn.pokemonId,slot}
    :{kind:'evolution',pokemonId:d.pokemonId,choice:d.stage==='pause-confirm'?pause:evolve};
}

const isGrowth=e=>e.id.startsWith('preparation-growth-');
export function projectGrowth(model,seat){
  const client=model.context!==undefined,c=client?model.context:model;
  const all=codec.capture(c).pendingEffects.filter(isGrowth);
  const personalContext={...c,pendingEffects:c.pendingEffects.filter(e=>!isGrowth(e)||e.id.startsWith(`preparation-growth-${seat}-`))};
  const view=projectPreparation(client?{...model,context:personalContext}:personalContext,seat);
  view.personal.growth=view.shared.battle.pendingEffects.filter(isGrowth);
  view.shared.battle.pendingEffects=view.shared.battle.pendingEffects.filter(e=>!isGrowth(e));
  view.shared.preparationGrowth=[...all.map(e=>({id:e.id,seat:e.phase.scope,type:e.phase.type,remaining:e.remaining})),
    ...(model.foreignGrowth??[])].sort((a,b)=>a.id.localeCompare(b.id));
  return view;
}
export function restoreGrowth(snapshot){
  const wire=copy(snapshot);wire.shared.battle.pendingEffects.push(...wire.personal.growth);
  const model=restorePreparation(wire);
  model.foreignGrowth=copy(wire.shared.preparationGrowth.filter(e=>e.seat!==snapshot.seat));return model;
}
export async function growthClients(f,adapter,identities){
  const pair=[];
  for(const seat of [0,1]){
    const c=await f.client();pair.push(c);c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}
      :seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',name:'B',roomId:pair[0].identity.roomId});
    c.identity=await c.wait(m=>m.type==='welcome');c.acks=[];
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.acks.push(m),adapter:{
      applySnapshot:s=>{c.model=restoreGrowth(s);},captureAppliedState:()=>adapter.projectSnapshot(c.model,seat),
      async applyGrantsTransaction(g){if(g.length)throw Error('Unexpected growth grant');}
    }});
  }
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot');await c.consume(c.snapshot);}return pair;
}
