import fs from 'node:fs';
import ts from 'typescript';
import {parse,evaluate,pokemon,installPokemonTestDependencies} from './original-model.mjs';
import {codec,safeCodec} from './decision-model.mjs';
import {types,modifiers,installModifierTestDependencies,installModifierTypeTestDependencies} from './modifier-model.mjs';
import {originalPhases,phaseCodec,installPhaseTestDependencies} from './phase-model.mjs';
import {compileReference,utils,actionRules} from './move-execution-model.mjs';
import {bindExperience} from './experience-model.mjs';
import {bindOriginalModifierUpdates} from './victory-aftermath-model.mjs';
import {preparationDriver,preparationContext,openMenus} from './preparation-model.mjs';
import {advancePreparationEffect,validatePreparationEffect} from '../../src/battle-core/preparation-effects-runner.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {withOriginalRules} from '../../server/original-random-context.mjs';
import {requireContract as check,copy,canonical} from '../../src/battle-core/coop-contract.mjs';

const enums=file=>evaluate(parse(file).statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n'));
const {Mode}=enums('ui/ui.ts'),{PartyOption,PartyUiMode}=enums('ui/party-ui-handler.ts');
class Scene{}
installModifierTestDependencies({'../battle-scene':{default:Scene},'../utils':{IntegerHolder:utils.IntegerHolder}});
installModifierTypeTestDependencies({'../ui/party-ui-handler':{default:{NoEffectMessage:'NO_EFFECT'}}});
installPhaseTestDependencies({'./ui/party-ui-handler':{PartyOption,PartyUiMode},'./ui/modifier-select-ui-handler':{SHOP_OPTIONS_ROW_LIMIT:6}});
const sceneClass=parse('battle-scene.ts').statements.find(n=>n.name?.text==='BattleScene');
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-preparation-effects-reference.json',import.meta.url),'utf8'));
const rules={...actionRules,...types,...modifiers,Utils:utils,ModifierAchv:class{},MoneyAchv:class{}};
const sceneMethod=(source,args)=>compileReference('method() '+ts.createSourceFile('m.ts',`class C{${source}}`,ts.ScriptTarget.Latest,true).statements[0].members[0].body.getText(),args,rules);
const addModifier={live:sceneMethod(sceneClass.members.find(n=>n.name?.getText()==='addModifier').getText(),'modifier,ignoreUpdate,playSound,virtual,instant'),
  reference:sceneMethod(frozen.addModifier,'modifier,ignoreUpdate,playSound,virtual,instant')};
const waveMoney=sceneMethod(sceneClass.members.find(n=>n.name?.getText()==='getWaveMoneyAmount').getText(),'moneyMultiplier');
const oldClass=ts.createSourceFile('p.ts',`class C{${frozen.start}}`,ts.ScriptTarget.Latest,true).statements[0];
const callback=oldClass.members[0].body.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText()==='modifierSelectCallback')).declarationList.declarations[0].initializer.getText();
const refRules={...rules,BattlePhase:originalPhases.BattlePhase,PartyOption,PartyUiMode,SHOP_OPTIONS_ROW_LIMIT:6,Mode,SelectModifierPhase:originalPhases.SelectModifierPhase};
const referenceFactory=evaluate(`const {${Object.keys(refRules).filter(k=>/^[\w$]+$/.test(k)&&k!=='default').join(',')}}=require('rules');
 export class Reference extends BattlePhase {createModifierSelectCallback(typeOptions){const party=this.scene.getParty();const modifierSelectCallback=${callback};return modifierSelectCallback;}}`,{rules:refRules}).Reference.prototype.createModifierSelectCallback;
const supported=new Set(['POKEBALL','GREAT_BALL','ULTRA_BALL','ROGUE_BALL','MASTER_BALL','NUGGET','BIG_NUGGET','RELIC_GOLD',
  'POTION','SUPER_POTION','HYPER_POTION','MAX_POTION','FULL_RESTORE','REVIVE','MAX_REVIVE','FULL_HEAL',
  'ETHER','MAX_ETHER','ELIXIR','MAX_ELIXIR','PP_UP','PP_MAX',
  'EXP_CHARM','SUPER_EXP_CHARM','GOLDEN_EXP_CHARM','EXP_SHARE','EXP_BALANCE','OVAL_CHARM','AMULET_COIN','GOLDEN_POKEBALL',
  'HEALING_CHARM','SHINY_CHARM','ABILITY_CHARM','MAP','MEGA_BRACELET','DYNAMAX_BAND','TERA_ORB','IV_SCANNER','CANDY_JAR',
  'BERRY_POUCH','FOCUS_BAND','KINGS_ROCK','LEFTOVERS','SHELL_BELL','GRIP_CLAW','BATON','REVIVER_SEED','LUCKY_EGG','GOLDEN_EGG',
  'SOOTHE_BELL','SOUL_DEW','GOLDEN_PUNCH','MINI_BLACK_HOLE','BASE_STAT_BOOSTER','ATTACK_TYPE_BOOSTER','BERRY','TEMP_STAT_BOOSTER']);
const party=(c,seat)=>c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index).map(e=>e.pokemon);
function optionFor(c,seat,a){return c.decision.players[seat][a.operation==='buy'?'shop':'rewards'].find(o=>o.id===a.optionId);}
export function effectsDriver(options={}){return {
  validate(c,seat,a){
    if(a.operation==='reroll'){
      const row=c.decision.players[seat],p=Object.assign(Object.create(originalPhases.SelectModifierPhase.prototype),{rerollCount:row.rerollCount,scene:{currentBattle:c.battle}});
      check(row.rerollCost===p.getRerollCost(),'STALE_REROLL_PRICE');return;
    }
    const o=optionFor(c,seat,a);check(o,'INVALID_PREPARATION_OPTION');
    check(!o.type.catalogId.startsWith('VOUCHER'),'COOP_VOUCHER_RULE_UNCONFIRMED');
    check(supported.has(o.type.catalogId)||options.progression&&['RARE_CANDY','RARER_CANDY'].includes(o.type.catalogId),'PREPARATION_EFFECT_UNAVAILABLE');
    const type=types.restoreModifierTypeState(o.type),pk=party(c,seat).find(p=>p.id===a.pokemonId);
    if(a.operation==='buy'){
      const index=c.decision.players[seat].shop.indexOf(o),base=waveMoney.call({currentBattle:c.battle},1);
      const live=types.getPlayerShopModifierTypeOptionsForWave(c.battle.waveIndex,base)[index];
      check(live&&live.cost===o.cost,'STALE_PREPARATION_SHOP');live.type.id=o.type.catalogId;
      check(canonical(types.captureModifierTypeState(live.type))===canonical(o.type),'STALE_PREPARATION_SHOP');
    }
    if(type instanceof types.PokemonModifierType){
      check(pk&&a.fusionId===null,'INVALID_PREPARATION_TARGET');
      if(type instanceof types.PokemonHeldItemModifierType){
        // Original held-item filters inspect pokemon.scene. Validate on an
        // isolated original candidate instead of attaching a scene to the input.
        const candidate=codec.restore(codec.capture(c)),target=party(candidate,seat).find(p=>p.id===pk.id);
        const b=bindExperience(candidate,new originalPhases.SelectModifierPhase({}),seat);
        try{check(type.selectFilter(target)===null,'INVALID_PREPARATION_TARGET');}finally{b.dispose();}
      }else check(type.selectFilter(pk)===null,'INVALID_PREPARATION_TARGET');
      if(type instanceof types.PokemonMoveModifierType)check(a.moveIndex!==null&&pk.getMoveset()[a.moveIndex]
        &&type.moveSelectFilter(pk.getMoveset()[a.moveIndex])===null,'INVALID_PREPARATION_MOVE');
      else check(a.moveIndex===null,'INVALID_PREPARATION_MOVE');
    }else check(a.pokemonId===null&&a.moveIndex===null&&a.fusionId===null,'INVALID_PREPARATION_TARGET');
  },
  async execute(c,p,{seat,action:a}){
    const b=bindExperience(c,p,seat),s=b.scene,tasks=createRuleTaskTracker(s);let next=null;const growth=[];
    const temporary=[];const define=(o,k,value)=>{temporary.push([o,k,Object.getOwnPropertyDescriptor(o,k)]);Object.defineProperty(o,k,{value,configurable:true});};
    try{
      Object.setPrototypeOf(s,Scene.prototype);s.party=party(c,seat);s.pokeballCounts=c.players[seat].pokeballCounts;
      Object.defineProperty(s,'money',{get:()=>c.players[seat].money,set:v=>c.players[seat].money=v});
      s.getWaveMoneyAmount=waveMoney.bind(s);s.updateMoneyText=()=>{};s.playSound=()=>{};s.sound={get:()=>true};
      s.validateAchvs=()=>{};s.unshiftPhase=q=>{
        if(options.progression&&q.constructor===originalPhases.LevelUpPhase){phaseCodec.capture(q,c,seat);growth.push(q);}
        else {check(!next,'DUPLICATE_REROLL_PHASE');next=q;}
      };
      s.addModifier=(...args)=>tasks.add(addModifier[options.reference?'reference':'live'].call(s,...args));
      s.modifierBar=s.enemyModifierBar={updateModifiers:()=>options.onModifierBar?.(c,{seat})};
      bindOriginalModifierUpdates(s,tasks,options.reference);
      for(const pk of s.party)define(pk,'updateInfo',()=>tasks.add(options.updateInfo?.(pk)??Promise.resolve()));
      s.ui={clearText(){},playError(){throw Error('ORIGINAL_MENU_REJECTED');},getHandler:()=>({updateCostText(){}}),
        setMode:()=>Promise.resolve(),
        setModeWithoutClear(mode,_partyMode,_unused,fn,filter,moveFilter){
          check(mode===Mode.PARTY,'UNSUPPORTED_MENU_MODE');const index=s.party.findIndex(pk=>pk.id===a.pokemonId),pk=s.party[index];
          check(pk&&filter(pk)===null,'INVALID_PREPARATION_TARGET');
          if(moveFilter)check(moveFilter(pk.getMoveset()[a.moveIndex])===null,'INVALID_PREPARATION_MOVE');
          fn(index,a.moveIndex===null?undefined:PartyOption.MOVE_1+a.moveIndex);
        }};
      options.onEffectBind?.(c,p,b,tasks,{seat,action:a});
      const row=c.decision.players[seat],typeOptions=row.rewards.map(o=>new types.ModifierTypeOption(types.restoreModifierTypeState(o.type),0,o.cost));
      const cb=(options.reference?referenceFactory:p.createModifierSelectCallback).call(p,typeOptions);
      await withOriginalRules(c,async()=>{
        if(a.operation==='reroll')cb(0,0);
        else if(a.operation==='reward')cb(1,row.rewards.findIndex(o=>o.id===a.optionId));
        else{
          const index=row.shop.findIndex(o=>o.id===a.optionId);
          // Original UI row mapping: when there are >6 shop items the first
          // six use row 3, and the remainder use row 2 with cursor offset.
          cb(row.shop.length>6&&index<6?3:2,row.shop.length>6&&index>=6?index-6:index);
        }
        await tasks.drain();
      });
      await tasks.drain();
      const result={completed:true,pendingTasks:tasks.pendingTasks,ended:b.ended,events:[...b.events,{kind:'preparation-effect',seat,operation:a.operation}],grants:[]};
      if(a.operation==='reroll'){
        check(next?.constructor===originalPhases.SelectModifierPhase&&b.ended,'INCOMPLETE_ORIGINAL_REROLL');
        // Finish the old callback before starting the newly queued original
        // reroll Phase. It uses the current room stream; no seed reset at >0.
        b.dispose();const menu=await preparationDriver(options).openPersonalMenu(c,null,{seat,phase:next});
        result.menu=menu;result.phase=menu.phase;result.events.push(...menu.events);
      }else check(next===null,'UNEXPECTED_PREPARATION_PHASE');
      if(growth.length)result.growth=growth;
      return result;
    }finally{for(const [o,k,d]of temporary.reverse()){if(d)Object.defineProperty(o,k,d);else delete o[k];}tasks.close();b.dispose();}
  }
};}
export const executePreparation=(c,seat,a,options={})=>advancePreparationEffect(c,seat,a,codec,safeCodec,effectsDriver(options));
export const validateEffect=(c,seat,a)=>validatePreparationEffect(c,seat,a,safeCodec,effectsDriver());
export async function effectContext(){const c=(await openMenus(await preparationContext())).context;c.players.forEach(p=>p.money=3000);return c;}
export function optionAction(c,seat,operation,id,pokemonId=null,moveIndex=null){
  const row=c.decision.players[seat][operation==='buy'?'shop':'rewards'],o=row.find(o=>o.type.catalogId===id);check(o,'MISSING_TEST_OPTION');
  return {kind:'preparation',operation,optionId:o.id,pokemonId,moveIndex,fusionId:null};
}
