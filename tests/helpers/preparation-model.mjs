import fs from 'node:fs';
import ts from 'typescript';
import {codec,safeCodec} from './decision-model.mjs';
import {parse,evaluate,moves} from './original-model.mjs';
import {types,modifiers,installModifierTypeTestDependencies} from './modifier-model.mjs';
import {originalPhases,phaseCodec,installPhaseTestDependencies,evolutionModule,formModule} from './phase-model.mjs';
import {compileReference,utils,moveRules} from './move-execution-model.mjs';
import {bindExperience} from './experience-model.mjs';
import {eggLapseContext,advanceEggs} from './egg-lapse-model.mjs';
import {withOriginalRules} from '../../server/original-random-context.mjs';
import {ruleRandom} from '../../src/battle-core/random-context.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {openPreparation,advancePreparation,coopRewardExclusions} from '../../src/battle-core/preparation-runner.mjs';
import {copy,requireContract as check} from '../../src/battle-core/coop-contract.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {projectEggSnapshot,restoreEggView} from './egg-lapse-clients.mjs';
import {createSnapshotConsumer} from '../../src/battle-core/coop-client.mjs';

const enums=file=>evaluate(parse(file).statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n'));
const realUtils=evaluate('function getSceneRandom(){return resolveRandom();}\n'+parse('utils.ts').statements
  .filter(n=>ts.isFunctionDeclaration(n)&&['randSeedInt','randSeedItem','shiftCharCodes'].includes(n.name?.text)).map(n=>n.getText()).join('\n'),{},{resolveRandom:()=>ruleRandom(()=>{throw Error('no room');})});
Object.assign(utils,realUtils,{getSceneRandom:()=>ruleRandom(()=>{throw Error('no room');})});
installModifierTypeTestDependencies({'../utils':utils,'../data/pokemon-evolutions':evolutionModule,'../data/pokemon-forms':formModule,
  '../data/move':moveRules,'../data/enums/moves':moves,'../system/unlockables':enums('system/unlockables.ts')});
installPhaseTestDependencies({'./modifier/modifier-type':types,'./modifier/modifier':modifiers});
const Mode=enums('ui/ui.ts').Mode;
installPhaseTestDependencies({'./ui/ui':{Mode}});
const sceneClass=parse('battle-scene.ts').statements.find(n=>n.name?.text==='BattleScene');
const method=(name,args)=>compileReference('method() '+sceneClass.members.find(n=>n.name?.getText()===name).body.getText(),args,{Utils:utils});
const resetSeed=method('resetSeed','waveIndex'),waveMoney=method('getWaveMoneyAmount','moneyMultiplier');
const findModifiers=method('findModifiers','modifierFilter,player=true');
const getModifiers=method('getModifiers','modifierType,player=true');
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-preparation-reference.json',import.meta.url),'utf8'));
const referenceRules={...types,...modifiers,BattlePhase:originalPhases.BattlePhase,Utils:utils,Mode,
  regenerateModifierPoolThresholds:(party,pool)=>types.regenerateModifierPoolThresholds(party,pool,coopRewardExclusions)};
const referenceStart=evaluate(`const {${Object.keys(referenceRules).join(',')}}=require('rules');
  export class Reference extends BattlePhase {${frozen.start}}`,{rules:referenceRules}).Reference.prototype.start;
export async function preparationContext({emptySeat=null,rows=[[],[]]}={}){
  const c=await eggLapseContext({rows,emptySeat});return (await advanceEggs(c)).context;
}
export function preparationDriver(options={}){return {
  async openPersonalMenu(c,_p,{seat,phase}){
    const p=phase??new originalPhases.SelectModifierPhase({},0),b=bindExperience(c,p,seat),s=b.scene,tasks=createRuleTaskTracker(s);
    let menu;
    try{
      Object.defineProperty(p,'getExcludedModifierIds',{value:()=>options.exclusions??coopRewardExclusions,configurable:true});
      s.seed=c.scene.seed;Object.defineProperty(s,'waveSeed',{get:()=>c.scene.waveSeed,set:v=>c.scene.waveSeed=v});
      s.resetSeed=resetSeed.bind(s);s.getWaveMoneyAmount=waveMoney.bind(s);
      s.findModifiers=findModifiers.bind(s);
      s.getModifiers=getModifiers.bind(s);
      s.gameData={unlocks:{}};
      s.ui={setMode(mode,player,options,callback,cost){if(mode!==Mode.MODIFIER_SELECT)throw Error('unexpected menu');menu={options,callback,cost};}};
      options.onMenuBind?.(c,p,b,tasks,{seat});
      options.onStart?.(seat);
      await withOriginalRules(c,()=>{if(options.reference)referenceStart.call(p);else p.start();});
      // The source is evaluated in a VM for renderer isolation. Normalize only
      // its plain pool tables across that test realm; retain original models.
      c.modifierPools=JSON.parse(JSON.stringify(c.modifierPools));
      await tasks.drain();if(!menu||b.ended)throw Error('missing reward menu');
      const pack=(list,prefix)=>list.map((o,index)=>({id:`${prefix}-${index}`,type:types.captureModifierTypeState(o.type),cost:o.cost}));
      const shop=types.getPlayerShopModifierTypeOptionsForWave(c.battle.waveIndex,s.getWaveMoneyAmount(1));
      // Original shop factories do not assign catalog IDs; resolve their exact
      // trusted factory before passing them to the existing type codec.
      for(const o of shop)if(!o.type.id)o.type.id=Object.keys(types.modifierTypes).find(id=>{
        const candidate=types.modifierTypes[id]();return candidate.constructor===o.type.constructor&&candidate.name===o.type.name;});
      delete p.getExcludedModifierIds;phaseCodec.capture(p,c,seat);
      return {completed:false,suspended:true,pendingTasks:tasks.pendingTasks,phase:p,rerollCost:menu.cost,
        rewards:pack(menu.options,'reward'),shop:pack(shop,'shop'),events:[{kind:'preparation-open',seat,count:menu.options.length}],grants:[]};
    }finally{delete p.getExcludedModifierIds;tasks.close();b.dispose();}
  }
};}
export const openMenus=(c,options={})=>openPreparation(c,codec,preparationDriver(options),{decisionId:'preparation-'+c.decision.id});
export const choosePreparation=(c,seat,action)=>advancePreparation(c,seat,action,codec,safeCodec);
export const atPreparationEnd=c=>c.decision.kind==='continuing'&&c.decision.reason==='next-battle';
export async function referenceMenus(c){
  const id='preparation-'+c.decision.id,d=selectNextPhase(c.continuation,()=>{throw Error('empty reward queue');}).phase;
  const players=[];
  for(const seat of [0,1]){const r=await preparationDriver({reference:true}).openPersonalMenu(c,d.phase,{seat});
    c.pendingEffects.push({id:`preparation-${d.phaseId}-${seat}`,phase:r.phase,remaining:'reward-select'});
    players.push({ready:false,rewardResolved:false,rerollCount:0,rerollCost:r.rerollCost,rewards:r.rewards,shop:r.shop,selection:null,subdecision:null});}
  c.continuation.currentPhase=null;c.decision={id,kind:'preparation',requiredSeats:[0,1],players};
  codec.capture(c);return c;
}
export function projectPreparation(model,seat){
  const view=projectEggSnapshot(model,seat),d=view.shared.battle.decision;
  view.personal.preparation=d.kind==='preparation'?copy(d.players[seat]):null;
  if(d.kind==='preparation')d.players=d.players.map(p=>({...p,rewards:[],shop:[],selection:null,subdecision:null}));
  return view;
}
export function restorePreparation(snapshot){
  const saved=copy(snapshot);
  if(saved.shared.battle.decision.kind==='preparation')saved.shared.battle.decision.players[saved.seat]=saved.personal.preparation;
  return restoreEggView(saved);
}
export async function preparationClients(f,adapter,identities){
  const pair=[];
  for(const seat of [0,1]){
    const c=await f.client();pair.push(c);c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}
      :seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',name:'B',roomId:pair[0].identity.roomId});
    c.identity=await c.wait(m=>m.type==='welcome');c.acks=[];
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.acks.push(m),adapter:{
      applySnapshot:s=>{c.model=restorePreparation(s);},captureAppliedState:()=>adapter.projectSnapshot(c.model,seat),
      async applyGrantsTransaction(g){check(g.length===0,'UNSUPPORTED_PREPARATION_GRANT');}
    }});
  }
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot');await c.consume(c.snapshot);}return pair;
}
