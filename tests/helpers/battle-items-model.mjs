import fs from 'node:fs';
import {codec} from './decision-model.mjs';
import {read,parse,evaluate} from './original-model.mjs';
import {originalPhases,installPhaseTestDependencies} from './phase-model.mjs';
import {bindAction,compileReference,common,abilityRules,utils} from './move-execution-model.mjs';
import {damageRules} from './move-effect-model.mjs';
import {modifiers,types,installModifierTestDependencies} from './modifier-model.mjs';
import {bindEncounterModifierScenes} from './encounter-modifier-binding.mjs';
import {persistentType} from './persistent-rewards-model.mjs';
import {roundContext} from './round-loop-model.mjs';
import {advanceCycle,runCycleReference} from './command-cycle-model.mjs';
import {replacementDriver,forcedSwitchDriver,chooseReplacementInputs} from './replacement-model.mjs';
import {bindCoopModifierScope} from '../../src/battle-core/modifier-scope.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {resolveForcedSwitchIntent} from '../../src/battle-core/switch-command.mjs';
import {advanceForcedSwitch} from '../../src/battle-core/forced-switch-runner.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {copy,requireContract as check} from '../../src/battle-core/coop-contract.mjs';
import {bindItemTransfers} from './item-transfer-binding.mjs';
import {withOriginalRules} from '../../server/original-random-context.mjs';
import {faintDriver} from './faint-model.mjs';

Object.assign(utils,evaluate(parse('utils.ts').statements.find(statement=>statement.name?.text==='toReadableString').getText()));
export const berryRules=evaluate(read('data/berry.ts'),{...common,'./ability':abilityRules});
installModifierTestDependencies({'../data/berry':berryRules,'../data/ability':abilityRules,
  '../phases':originalPhases,'../messages':common['../messages'],'../utils':utils});
class CommonBattleAnim{
  constructor(anim,source){this.anim=anim;this.source=source;}
  play(scene,done){scene.recordItemAnimation?.(this.anim,this.source);done();}
}
class HealAchv{}
installPhaseTestDependencies({'./data/battle-anims':{CommonBattleAnim},'./system/achv':{HealAchv},'./data/ability':abilityRules});
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-battle-items-reference.json',import.meta.url),'utf8'));
const rules={...damageRules,...originalPhases,CommonBattleAnim,HealAchv};
const reference=Object.fromEntries(Object.entries(frozen.methods).map(([name,methods])=>[name,
  Object.fromEntries(Object.entries(methods).map(([method,body])=>[method,compileReference(body
    .replaceAll('super.start()','CommonAnimPhase.prototype.start.call(this)').replaceAll('super.end()','this.scene.shiftPhase()'),'',rules)]))]));
const damageFrozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-move-effect-reference.json',import.meta.url),'utf8'));
const referenceDamage=compileReference(damageFrozen.pokemonApply
  .replace('this.scene.applyModifiers(AttackTypeBoosterModifier','source.scene.applyModifiers(AttackTypeBoosterModifier')
  .replace('this.scene.applyModifiers(TempBattleStatBoosterModifier','source.scene.applyModifiers(TempBattleStatBoosterModifier')
  .replace('this.scene.applyModifiers(DamageMoneyRewardModifier','source.scene.applyModifiers(DamageMoneyRewardModifier'),
  'source,battlerMove',damageRules);
const allowed=new Set(['EXP_CHARM','HEALING_CHARM','EXP_SHARE','LUCKY_EGG','GOLDEN_EGG','BASE_STAT_BOOSTER','SOUL_DEW',
  'ATTACK_TYPE_BOOSTER','BERRY','TEMP_STAT_BOOSTER','LEFTOVERS','SHELL_BELL','BERRY_POUCH']);
export function validateBattleItems(context,options={}){
  for(const modifier of [...context.players.flatMap(player=>player.modifiers),...context.enemyModifiers]){
    const id=modifier.type.generatorId||modifier.type.id;
    check(allowed.has(id)||options.transferAndRevive&&['GRIP_CLAW','MINI_BLACK_HOLE','REVIVER_SEED'].includes(id),'UNSUPPORTED_BATTLE_ITEM');
    if(['GRIP_CLAW','MINI_BLACK_HOLE','REVIVER_SEED'].includes(id)){
      const holder=context.roster.entries.find(e=>e.pokemon.id===modifier.pokemonId)?.pokemon;
      check(holder&&modifier instanceof modifiers.PokemonHeldItemModifier&&modifier.virtualStackCount===0
        &&modifier.stackCount<=modifier.getMaxHeldItemCount(holder),'UNSUPPORTED_ADVANCED_ITEM_STACK');
    }
    if(modifier instanceof modifiers.BerryModifier)check([berryRules.BerryType.SITRUS,berryRules.BerryType.LUM,berryRules.BerryType.LEPPA]
      .includes(modifier.berryType),'UNSUPPORTED_BATTLE_BERRY');
  }
}
export function bindBattleItems(context,phase,binding,tasks,options={}){
  validateBattleItems(context,options);
  const modifierBinding=bindEncounterModifierScenes(context,binding,tasks,options);
  const unscope=bindCoopModifierScope(context,binding.scene,modifierBinding.children.map(child=>child.scene),phase);
  const untransfer=options.transferAndRevive?bindItemTransfers(context,binding,modifierBinding,tasks,options):()=>{};
  const patched=[];
  if(options.reference)for(const entry of context.roster.entries){
    patched.push([entry.pokemon,Object.getOwnPropertyDescriptor(entry.pokemon,'apply')]);
    Object.defineProperty(entry.pokemon,'apply',{value:referenceDamage,configurable:true});
  }
  return {drain:()=>modifierBinding.drain(),dispose(){
    for(const [actor,descriptor]of patched){if(descriptor)Object.defineProperty(actor,'apply',descriptor);else delete actor.apply;}
    untransfer();unscope();modifierBinding.dispose();
  }};
}
const isItemPhase=phase=>[originalPhases.BerryPhase,originalPhases.PokemonHealPhase,originalPhases.CommonAnimPhase].includes(phase.constructor);
function itemPhaseDriver(options){return {
  supports:(_context,phase)=>isItemPhase(phase)&&(!phase.revive||options.transferAndRevive),
  async execute(context,phase){
    const binding=bindAction(context,phase),tasks=createRuleTaskTracker(binding.scene),patched=[];
    let modifierBinding;
    try{
      binding.scene.gameData.gameStats.highestHeal=0;
      binding.scene.damageNumberHandler={add:(actor,amount,result)=>binding.events.push({kind:'heal-display',pokemonId:actor.id,amount,result})};
      binding.scene.recordItemAnimation=(anim,actor)=>binding.events.push({kind:'item-animation',anim,pokemonId:actor?.id??null});
      modifierBinding=options.bindModifiers(context,phase,binding,tasks);
      if(options.reference)for(const [method,fn]of Object.entries(reference[phase.constructor.name])){
        patched.push(method);Object.defineProperty(phase,method,{value:fn,configurable:true});
      }
      phase.start();await modifierBinding.drain();await Promise.resolve();
      return {completed:binding.ended,pendingTasks:tasks.pendingTasks,events:binding.events,grants:[]};
    }finally{modifierBinding?.dispose();for(const method of patched)delete phase[method];tasks.close();binding.dispose();}
  }
};}
function configured(options){return {...options,allowSuspend:true,
  bindModifiers:(context,phase,binding,tasks)=>bindBattleItems(context,phase,binding,tasks,options)};}
export function battleItemsDriver(options={}){
  const config=configured(options),base=replacementDriver(config),items=itemPhaseDriver(config);
  const enemy=faintDriver({...config,allowEnemy:true});
  // getPokemon needs a live scene; inspect its saved global field slot here.
  const enemyHeldRevive=(c,p)=>options.transferAndRevive&&p.constructor===originalPhases.FaintPhase&&!p.player&&!p.preventEndure
    &&c.enemyModifiers.some(m=>m instanceof modifiers.PokemonInstantReviveModifier&&m.pokemonId===c.roster.field[2+p.fieldIndex]);
  return {...base,supports:(context,phase)=>items.supports(context,phase)||enemyHeldRevive(context,phase)||base.supports(context,phase),
    execute:(context,phase)=>{
      const run=()=>items.supports(context,phase)?items.execute(context,phase):enemyHeldRevive(context,phase)?enemy.execute(context,phase):base.execute(context,phase);
      return options.transferAndRevive?withOriginalRules(context,run):run();
    }};
}
const nextId=context=>`battle-items-${Number(context.decision.id.split('-').at(-1))+1}`;
export async function advanceBattleItems(context,inputs={},options={}){
  validateBattleItems(context,options);const decisionId=nextId(context),config=configured(options);let result;
  if(context.decision.kind==='wait-switch')result=await advanceForcedSwitch(context,inputs,codec,forcedSwitchDriver(config),{decisionId});
  else if(['wait-actions','wait-target'].includes(context.decision.kind))result=await advanceCycle(context,inputs,config);
  else result=await advanceQueuedRulePhase(context,codec,battleItemsDriver(options),{decisionId});
  result.context.decision.id=decisionId;codec.capture(result.context);return result;
}
export async function referenceBattleItems(context,inputs={},options={}){
  validateBattleItems(context,options);const decisionId=nextId(context),config=configured({...options,reference:true});let result;
  if(context.decision.kind==='wait-switch'){
    const seat=context.decision.requiredSeats[0];codec.validateAction(context,seat,inputs[seat]);
    const intent=resolveForcedSwitchIntent(context,seat,inputs[seat]);
    result=await forcedSwitchDriver(config).resumeSwitch(context,context.continuation.currentPhase.phase,{seat,...intent});
    check(result.completed&&result.pendingTasks===0,'INCOMPLETE_ITEM_SWITCH');context.continuation.currentPhase=null;
    context.decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
  }else if(['wait-actions','wait-target'].includes(context.decision.kind))result=await runCycleReference(context,copy(inputs),config);
  else{
    const driver=battleItemsDriver({...options,reference:true}),current=context.continuation.currentPhase;
    const descriptor=current||selectNextPhase(context.continuation,()=>check(false,'EMPTY_ITEM_QUEUE')).phase;
    check(driver.supports(context,descriptor.phase),'UNSUPPORTED_RULE_PHASE');
    result=await (current?driver.resume(context,descriptor.phase,descriptor.remaining):driver.execute(context,descriptor.phase));
    check((result.completed||result.suspended)&&result.pendingTasks===0,'INCOMPLETE_ITEM_PHASE');
    if(result.suspended){const stop=driver.suspendBoundary(context,descriptor.phase,decisionId,result);descriptor.remaining=stop.remaining;context.decision=stop.decision;}
    else{context.continuation.currentPhase=null;context.decision=driver.finishBoundary(context,descriptor.phase,decisionId);}
  }
  context.decision.id=decisionId;codec.capture(context);return {context,events:result.events,grants:result.grants};
}
export function addBattleItem(context,seat,id,{pokemonId,stack=1,berry=berryRules.BerryType.SITRUS}={}){
  const actor=context.roster.entries.find(entry=>entry.pokemon.id===(pokemonId??context.roster.field[seat===null?2:seat])).pokemon;
  const type=id==='BERRY'?new types.BerryModifierType(berry):persistentType(id);type.id=id;
  const modifier=type.newModifier(...(type instanceof types.PokemonModifierType?[actor]:[]));modifier.stackCount=stack;
  (seat===null?context.enemyModifiers:context.players[seat].modifiers).push(modifier);return modifier;
}
export async function itemRoundContext({seat=0,seed='battle-items-round'}={}){
  const context=roundContext({seat,seed});context.decision.id='battle-items-0';
  for(const {pokemon:actor}of context.roster.entries){actor.level=30;actor.hp=1;}
  const binding=bindAction(context,new originalPhases.TurnInitPhase({})),tasks=createRuleTaskTracker(binding.scene);
  const modifiersBinding=bindBattleItems(context,new originalPhases.TurnInitPhase({}),binding,tasks);
  try{for(const {pokemon:actor}of context.roster.entries){actor.calculateStats();actor.hp=actor.getMaxHp();}await modifiersBinding.drain();}
  finally{modifiersBinding.dispose();tasks.close();binding.dispose();}
  return codec.restore(codec.capture(context));
}
export const chooseBattleItems=chooseReplacementInputs;
export async function itemInputContext(seat=0){
  let context=await itemRoundContext();
  while(context.decision.kind!=='wait-actions')context=(await advanceBattleItems(context,chooseBattleItems(context))).context;
  for(const entry of context.roster.entries)entry.pokemon.hp=entry.pokemon.getMaxHp();
  context.roster.entries[seat].pokemon.hp=20;
  addBattleItem(context,seat,'BERRY',{stack:2});addBattleItem(context,seat,'LEFTOVERS');addBattleItem(context,1-seat,'SHELL_BELL');
  return context;
}
