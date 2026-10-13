import {initialDecision,codec,safeCodec,modifierCodec} from './decision-model.mjs';
import {originalPokemon,installPokemonTestDependencies} from './original-model.mjs';
import {originalPhases,phaseCodec,evolutionCodec} from './phase-model.mjs';
import {modifiers,types} from './modifier-model.mjs';
import {applySafeDecisionAction} from '../../src/battle-core/safe-decisions.mjs';

installPokemonTestDependencies({'../modifier/modifier':modifiers});
const descriptor=(c,phase,scope,remaining,id=0)=>({kind:'original-phase',phaseId:id,phase:phaseCodec.capture(phase,c,scope),remaining});
const result=events=>({events,grants:[]});
export function safeContext(kind='map') {
  const c=initialDecision();
  c.players.forEach(p=>{p.money=1000;p.modifiers=[];});
  if(kind==='starter-ready') {
    c.roster.entries=c.roster.entries.filter(e=>e.owner!==null);c.roster.field=[null,null,null,null];c.battle=null;
    for(const seat of [0,1])for(const index of [1,2])c.roster.entries.push({owner:seat,group:'party',index,pokemon:originalPokemon(200+seat*10+index)});
    c.decision={id:'starters-selected',kind,requiredSeats:[0,1],starters:[0,1].map(s=>c.roster.entries.filter(e=>e.owner===s&&e.group==='party').sort((a,b)=>a.index-b.index).map(e=>e.pokemon.id)),ready:[false,false]};
    c.continuation.currentPhase=descriptor(c,new originalPhases.SelectStarterPhase({}),null,'starter-ready');
  } else if(kind==='map') {
    c.decision={id:'map-1',kind,requiredSeats:[0,1],sourceBiome:c.arena.biomeType,biomes:[1,2],choices:[null,null]};
    c.continuation.currentPhase=descriptor(c,new originalPhases.SelectBiomePhase({}),null,'map-select');
  } else if(kind==='preparation') {
    const potion=types.modifierTypes.POTION();potion.id='POTION';
    c.decision={id:'prepare-1',kind,requiredSeats:[0,1],players:[0,1].map(()=>({ready:false,rewardResolved:false,rerollCount:0,rerollCost:250,
      rewards:[{id:'reward-potion',type:types.captureModifierTypeState(potion),cost:0}],shop:[{id:'shop-potion',type:types.captureModifierTypeState(potion),cost:100}],selection:null,subdecision:null}))};
    for(const seat of [0,1])c.pendingEffects.push({id:`prepare-${seat}`,phase:phaseCodec.capture(new originalPhases.SelectModifierPhase({},0),c,seat),remaining:'reward-select'});
    c.roster.entries.push({owner:0,group:'reserve',index:0,pokemon:originalPokemon(190)});
  } else if(kind==='evolution') {
    const p=c.roster.entries[0].pokemon;p.level=16;p.fusionSpecies=null;p.summonData.speciesForm=null;
    c.decision={id:'evolve-1',kind,requiredSeats:[0],pokemonId:p.id,reference:evolutionCodec.capture(evolutionCodec.restore({id:1,index:0})),lastLevel:15,stage:'evolve-or-cancel'};
  } else if(kind==='ended') {
    c.decision={id:'ended-1',kind,requiredSeats:[],victory:true,reason:'victory'};
    c.continuation.currentPhase=descriptor(c,new originalPhases.GameOverPhase({},true),null,'ended');
  }
  return c;
}
function waitActions(c,id) {
  c.continuation.currentPhase=null;
  c.decision={id,kind:'wait-actions',requiredSeats:[0,1],options:Object.fromEntries([0,1].map(s=>[s,[{kind:'test-continue',pokemonId:c.roster.field[s]}]]))};
}
export const hooks={
  startAdventure(c){
    // Test runner supplies the next original Battle only after both ready. The
    // actual selected-starter checkpoint itself contains no Battle/enemy yet.
    const next=initialDecision();c.battle=next.battle;c.roster.entries.push(next.roster.entries[2]);c.roster.field=[100,101,102,null];
    waitActions(c,'battle-after-starters');return result([{kind:'starters-ready'}]);
  },
  chooseBiome(c,biome){
    // The selected original SwitchBiomePhase is retained as pending work. The
    // full scene transition is M3; this gate must not redraw map choices.
    c.continuation.phaseQueuePrepend.push(descriptor(c,new originalPhases.SwitchBiomePhase({},biome),null,'start',10));
    c.arena.biomeType=biome;waitActions(c,'battle-after-map');return result([{kind:'biome-selected',biome}]);
  },
  nextBattle(c){c.pendingEffects=[];waitActions(c,'battle-after-preparation');return result([{kind:'both-ready'}]);},
  endEvolution(c,id){waitActions(c,'battle-after-evolution');return result([{kind:'evolution-ended',pokemonId:id}]);},
  async evolve(c,id,reference,lastLevel){
    const p=c.roster.entries.find(e=>e.pokemon.id===id).pokemon,events=[];
    p.scene={gameMode:c.battle.gameMode,applyModifiers(){},applyModifier(){},gameData:{
      setPokemonSeen:p=>events.push({kind:'seen-hook',pokemonId:p.id,speciesId:p.species.speciesId}),
      async setPokemonCaught(p){events.push({kind:'caught-hook',pokemonId:p.id,speciesId:p.species.speciesId});}
    }};
    // Rendering-only hooks. evolve/generateCompatibleTms/calculateStats are the
    // actual original methods and continue to use original formulas.
    Object.defineProperties(p,{loadAssets:{value:async()=>{},configurable:true},updateInfo:{value:async()=>{},configurable:true}});
    try {await p.evolve(evolutionCodec.restore(reference));}
    finally {delete p.loadAssets;delete p.updateInfo;delete p.scene;}
    events.push({kind:'evolved',pokemonId:id,speciesId:p.species.speciesId,lastLevel});
    waitActions(c,'battle-after-evolution');return result(events);
  },
  applyModifier(c,seat,saved,action){
    const type=types.restoreModifierTypeState(saved),p=c.roster.entries.find(e=>e.pokemon.id===action.pokemonId)?.pokemon;
    const modifier=type.newModifier(p);
    if(!modifier.shouldApply([p,1]))throw Error('Modifier cannot apply');
    modifier.apply([p,1]);return result([{kind:'modifier-applied',seat,pokemonId:p.id,hp:p.hp}]);
  },
  reroll(c,seat){
    // Test provider: an original RNG draw chooses among persisted static types.
    // The separate pool suite covers full original threshold regeneration.
    const count=c.sceneRandom.integer(100),p=c.decision.players[seat];
    p.rewards[0].id=`reward-${p.rerollCount}-${count}`;
    const phase=c.pendingEffects.find(e=>e.id===`prepare-${seat}`).phase;phase.rerollCount=p.rerollCount;
    phase.scene={currentBattle:c.battle};p.rerollCost=phase.getRerollCost();delete phase.scene;
    return result([{kind:'rerolled',seat,count}]);
  },
  transfer(){throw Error('Test fixture has no transferrable item');}
};
export const safeAdapter=kind=>({rulesVersion:'m2-safe-boundaries-test',contentHash:'synthetic-pokemon-full-evolution-form-catalog',
  createInitialContext:()=>safeContext(kind),captureCheckpoint:codec.capture,restoreCheckpoint:codec.restore,validateCheckpoint:codec.validate,
  describeDecision:c=>({id:c.decision.id,requiredSeats:c.decision.requiredSeats,collection:safeCodec.collection(c.decision)}),
  validateAction:codec.validateAction,
  async advanceToDecision(c,inputs){const [seat,action]=Object.entries(inputs)[0];return applySafeDecisionAction(c,Number(seat),action,codec,safeCodec,hooks);},
  projectSnapshot:(c,seat)=>({shared:codec.capture({...c,players:c.players.map(()=>({money:0,pokeballCounts:{0:0,1:0,2:0,3:0,4:0},modifiers:[]}))}),
    personal:{resources:{money:c.players[seat].money,pokeballCounts:c.players[seat].pokeballCounts,modifiers:c.players[seat].modifiers.map(modifierCodec.capture)}}})
});
