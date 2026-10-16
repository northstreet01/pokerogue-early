import {requireContract as check} from './coop-contract.mjs';

export function bindCoopModifierScope(context,scene,personalScenes,phase){
  check(personalScenes.length===2,'INVALID_MODIFIER_SCENES');
  const originals=new Map(),entries=context.roster.entries;
  const owner=pokemon=>entries.find(entry=>entry.pokemon===pokemon)?.owner;
  const phaseOwner=()=>typeof phase.getPokemon==='function'?owner(phase.getPokemon()):undefined;
  const patch=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(scene,name));scene[name]=value;};
  const enemyApply=scene.applyModifiers.bind(scene),enemyApplyOne=scene.applyModifier.bind(scene);
  const enemyUpdate=scene.updateModifiers.bind(scene),enemyRemove=scene.removeModifier.bind(scene);
  const personal=(args=[])=>{
    const entry=entries.find(candidate=>candidate.pokemon===args[0]);
    const seat=entry?entry.owner:phaseOwner();
    check(seat===0||seat===1,'AMBIGUOUS_MODIFIER_OWNER');
    return personalScenes[seat];
  };
  patch('applyModifiers',(type,player=true,...args)=>player
    ?personal(args).applyModifiers(type,true,...args):enemyApply(type,false,...args));
  patch('applyModifier',(type,player=true,...args)=>player
    ?personal(args).applyModifier(type,true,...args):enemyApplyOne(type,false,...args));
  const lists=player=>{
    if(!player)return context.enemyModifiers;
    const seat=phaseOwner();
    return seat===0||seat===1?context.players[seat].modifiers:context.players.flatMap(player=>player.modifiers);
  };
  patch('findModifiers',(predicate,player=true)=>lists(player).filter(predicate));
  patch('findModifier',(predicate,player=true)=>lists(player).find(predicate));
  patch('getModifiers',(type,player=true)=>lists(player).filter(modifier=>modifier instanceof type));
  patch('removeModifier',modifier=>{
    if(context.enemyModifiers.includes(modifier))return enemyRemove(modifier,true);
    const seats=context.players.flatMap((player,seat)=>player.modifiers.includes(modifier)?[seat]:[]);
    check(seats.length<=1,'AMBIGUOUS_MODIFIER_OWNER');
    return seats.length===1?personalScenes[seats[0]].removeModifier(modifier,false):false;
  });
  patch('updateModifiers',(player=true,instant)=>{
    if(!player)return enemyUpdate(false,instant);
    const seat=phaseOwner();
    return seat===0||seat===1?personalScenes[seat].updateModifiers(true,instant)
      :Promise.all(personalScenes.map(child=>child.updateModifiers(true,instant)));
  });
  return ()=>{for(const [name,descriptor]of originals){if(descriptor)Object.defineProperty(scene,name,descriptor);else delete scene[name];}};
}
