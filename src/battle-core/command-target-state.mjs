import {canonical,requireContract as check} from './coop-contract.mjs';
import {pokemonRuleNodes} from './pokemon-state.mjs';

function references(context){
  const result=[];
  for(const slot of [0,1,2,3]){
    const command=context.battle?.turnCommands[slot];if(!command)continue;
    for(const [field,array]of [['targets',command.targets],['move',command.move?.targets],...(command.args??[]).map((arg,i)=>[`arg-${i}`,arg?.targets])])if(Array.isArray(array)){
      const parent=field==='targets'?command:field==='move'?command.move:command.args[Number(field.slice(4))];
      result.push({ref:{command:slot,field},array,set:value=>{parent.targets=value;}});
    }
  }
  for(const {pokemon:p}of context.roster.entries)for(const [path,node]of pokemonRuleNodes(p))if(Array.isArray(node)&&node.length<=4&&node.every(Number.isSafeInteger)){
    const parts=JSON.parse(path);if(!parts.length)continue;
    const parent=parts.slice(0,-1).reduce((v,k)=>v[k],p);
    result.push({ref:{pokemonId:p.id,path:parts},array:node,set:value=>Object.defineProperty(parent,parts.at(-1),{value,writable:true,enumerable:true,configurable:true})});
  }
  return result;
}
export function captureCommandTargetGroups(context){
  const groups=new Map();
  for(const {ref,array}of references(context)){if(!groups.has(array))groups.set(array,[]);groups.get(array).push(ref);}
  return [...groups.values()].filter(group=>group.length>1&&group.some(ref=>Object.hasOwn(ref,'command')));
}
export function restoreCommandTargetGroups(context,groups){
  check(Array.isArray(groups)&&groups.length<=10000,'INVALID_COMMAND_TARGET_ALIAS');
  const allowed=new Map(references(context).map(value=>[canonical(value.ref),value])),used=new Set();
  for(const group of groups){
    check(Array.isArray(group)&&group.length>1&&group.length<=100000&&group.some(ref=>ref&&Object.hasOwn(ref,'command')),'INVALID_COMMAND_TARGET_ALIAS');
    let target;
    for(const ref of group){
      const key=canonical(ref),node=allowed.get(key);check(node&&!used.has(key),'INVALID_COMMAND_TARGET_ALIAS');used.add(key);
      if(target===undefined)target=node.array;
      else{check(canonical(target)===canonical(node.array),'CONFLICTING_COMMAND_TARGET_ALIAS');node.set(target);}
    }
  }
  check(canonical(captureCommandTargetGroups(context))===canonical(groups),'INVALID_COMMAND_TARGET_ALIAS');
}
