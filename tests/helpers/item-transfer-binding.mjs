import fs from 'node:fs';
import {parse} from './original-model.mjs';
import {compileReference,utils,actionRules,abilityRules} from './move-execution-model.mjs';
import {modifiers,types,installModifierTestDependencies} from './modifier-model.mjs';
import {ruleRandom} from '../../src/battle-core/random-context.mjs';
import {requireContract as check} from '../../src/battle-core/coop-contract.mjs';

const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-transfer-revive-reference.json',import.meta.url),'utf8'));
const sceneClass=parse('battle-scene.ts').statements.find(n=>n.name?.text==='BattleScene');
const rules={...actionRules,...types,...modifiers,...abilityRules,Utils:utils,ModifierAchv:class{},MoneyAchv:class{}};
const args={addModifier:'modifier,ignoreUpdate,playSound,virtual,instant',addEnemyModifier:'modifier,ignoreUpdate,instant',
  tryTransferHeldItemModifier:'itemModifier,target,transferStack,playSound,instant,ignoreUpdate'};
const methods=Object.fromEntries(Object.entries(args).map(([name,parameters])=>[name,{
  live:compileReference(sceneClass.members.find(n=>n.name?.getText()===name).getText(),parameters,rules),
  reference:compileReference(frozen.scene[name],parameters,rules)
}]));
const referenceApply=compileReference(frozen.transferApply,'args',rules);
installModifierTestDependencies({'../utils':{...utils,getSceneRandom:()=>ruleRandom(()=>{throw Error('UNSCOPED_ITEM_RANDOM');})}});

// All effects below remain original. Select only the owning scene for the
// original remove/add/update transaction; never borrow the partner's inventory.
export function bindItemTransfers(context,binding,modifierBinding,tasks,options={}){
  const root=binding.scene,children=modifierBinding.children,patched=[];
  const patch=(o,k,v)=>{patched.push([o,k,Object.getOwnPropertyDescriptor(o,k)]);Object.defineProperty(o,k,{value:v,writable:true,configurable:true});};
  const method=name=>methods[name][options.reference?'reference':'live'];
  patch(root,'addEnemyModifier',(...a)=>tasks.add(method('addEnemyModifier').call(root,...a)));
  for(const {scene,tracker}of children)patch(scene,'addModifier',(...a)=>tracker.add(method('addModifier').call(scene,...a)));
  const transfer=(item,target,...a)=>{
    const source=context.roster.entries.find(e=>e.pokemon.id===item.pokemonId),dest=context.roster.entries.find(e=>e.pokemon===target);
    check(source&&dest&&item instanceof modifiers.PokemonHeldItemModifier,'INVALID_TRANSFER_ACTOR');
    const sourceList=source.owner===null?context.enemyModifiers:context.players[source.owner].modifiers;
    check(sourceList.includes(item),'INVALID_TRANSFER_SOURCE');
    check(source.owner===null||dest.owner===null||source.owner===dest.owner,'CROSS_PLAYER_ITEM_TRANSFER');
    const seat=source.owner??dest.owner,host=seat===null?root:children[seat].scene,tracker=seat===null?tasks:children[seat].tracker;
    // A player source must update that player's list even when an enemy steals
    // it. The opposite-side add method still uses the original enemy list.
    const run=()=>method('tryTransferHeldItemModifier').call(host,item,target,...a);
    return tracker.add(options.beforeTransfer?Promise.resolve(options.beforeTransfer(context,item,target)).then(run):run());
  };
  patch(root,'tryTransferHeldItemModifier',transfer);
  for(const {scene}of children)patch(scene,'tryTransferHeldItemModifier',transfer);
  if(options.reference)for(const item of [...context.players.flatMap(p=>p.modifiers),...context.enemyModifiers]){
    if(item instanceof modifiers.HeldItemTransferModifier)patch(item,'apply',referenceApply);
  }
  return ()=>{for(const [o,k,d]of patched.reverse()){if(d)Object.defineProperty(o,k,d);else delete o[k];}};
}
