import {bindExperienceModifiers} from './experience-model.mjs';
import {bindOriginalModifierUpdates} from './victory-aftermath-model.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';

// Reuse the same personal modifier scenes as BattleEnd/rewards. The shared
// encounter owns enemy items; each player Pokemon always queries its own list.
export function bindEncounterModifierScenes(c,b,tasks,options={}){
  const root=b.scene,reference=!!options.reference,children=[],patched=[];
  const personal=seat=>c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index).map(e=>e.pokemon);
  const define=(o,k,value)=>{patched.push([o,k,Object.getOwnPropertyDescriptor(o,k)]);Object.defineProperty(o,k,{value,writable:true,configurable:true});};
  root.modifiers=[];root.enemyModifiers=c.enemyModifiers;root.getEnemyParty=()=>c.battle.enemyParty;
  root.modifierBar=root.enemyModifierBar={updateModifiers(){}};root.updateUIPositions=()=>{};
  bindExperienceModifiers(root,reference);bindOriginalModifierUpdates(root,tasks,reference);
  const updateEnemy=root.updateModifiers;
  for(const seat of [0,1]){
    const scene=Object.create(root),tracker=createRuleTaskTracker(scene);
    scene.getParty=()=>personal(seat);scene.modifiers=c.players[seat].modifiers;
    bindExperienceModifiers(scene,reference);bindOriginalModifierUpdates(scene,tracker,reference);
    children.push({scene,tracker});
  }
  root.updateModifiers=(player,instant)=>player===false?updateEnemy(false,instant)
    :tasks.add(Promise.all(children.map(({scene})=>scene.updateModifiers(true,instant))));
  // Shared Phase lookups (e.g. scanner) can see both lists; actor effects cannot.
  root.findModifiers=(filter,player=true)=>(player?c.players.flatMap(p=>p.modifiers):c.enemyModifiers).filter(filter);
  root.findModifier=(filter,player=true)=>root.findModifiers(filter,player)[0];
  const bindPokemon=(pk,seat)=>{
    const scene=seat===null?root:children[seat].scene,tracker=seat===null?tasks:children[seat].tracker;
    pk.scene=scene;
    define(pk,'updateInfo',()=>{b.events.push({kind:'status-display',pokemonId:pk.id});return tracker.add(options.updateInfo?.(pk,seat)??Promise.resolve());});
  };
  for(const e of c.roster.entries)bindPokemon(e.pokemon,e.owner);
  const add=root.addEnemyPokemon;
  if(add)root.addEnemyPokemon=(...args)=>{const pk=add(...args);bindPokemon(pk,null);return pk;};
  options.onModifierBind?.(c,b,{children,tasks});
  return {children,
    async drain(){
      // A failed shared update must not detach personal scenes while an
      // original transfer still has their add/update callbacks in flight.
      const settled=await Promise.allSettled([tasks.drain(),...children.map(child=>child.tracker.drain())]);
      const failure=settled.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    },
    dispose(){for(const [o,k,d]of patched.reverse()){if(d)Object.defineProperty(o,k,d);else delete o[k];}
      for(const child of children)child.tracker.close();}
  };
}
