import fs from 'node:fs';
import ts from 'typescript';
import sineIn from 'phaser/src/math/easing/sine/In.js';
import {codec,battleTestGlobals} from './decision-model.mjs';
import {parse,status} from './original-model.mjs';
import {originalPhases,phaseCodec,installPhaseTestDependencies} from './phase-model.mjs';
import {modifiers,types} from './modifier-model.mjs';
import {compileReference,actionRules,abilityRules} from './move-execution-model.mjs';
import {experienceContext,bindExperience,bindExperienceModifiers} from './experience-model.mjs';
import {levelUpContext,advanceLevelUp,referenceProgression,chooseProgression,progressionDriver,atExperienceEnd} from './level-up-model.mjs';
import {nextPostPhase,BattleSpec} from './post-damage-model.mjs';
import {queueOwnedPhase} from './native-switch-model.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {advanceVictoryAftermath,recoverVictoryParties} from '../../src/battle-core/victory-aftermath-runner.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {copy,requireContract as check} from '../../src/battle-core/coop-contract.mjs';

Object.assign(battleTestGlobals.Phaser,{Tweens:{Builders:{GetEaseFunction:key=>{check(key==='Sine.easeIn','UNSUPPORTED_EASE');return sineIn;}}}});
installPhaseTestDependencies({'./data/ability':abilityRules,'./modifier/modifier-type':types});
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-victory-aftermath-reference.json',import.meta.url),'utf8'));
const rules={...actionRules,...modifiers,...battleTestGlobals,modifierTypes:types.modifierTypes};
const originalVictory=frozen.methods.VictoryPhase.start;
const aftermathBody=originalVictory.slice(originalVictory.indexOf('    if (!this.scene.getEnemyParty()'),originalVictory.lastIndexOf('}'));
const defeatStatement=originalVictory.slice(originalVictory.indexOf('    this.scene.gameData.gameStats.pokemonDefeated++'),
  originalVictory.indexOf(';',originalVictory.indexOf('    this.scene.gameData.gameStats.pokemonDefeated++'))+1);
const referenceAftermath=compileReference(`resume(){${defeatStatement}${aftermathBody}}`,'',rules);
const referenceBattleEnd=compileReference(frozen.methods.BattleEndPhase.start,'',rules);
const referenceBattleScore=compileReference(frozen.methods.Battle.addBattleScore,'scene',rules);
const sceneClass=parse('battle-scene.ts').statements.find(n=>n.name?.text==='BattleScene');
const sceneArgs={clearEnemyHeldItemModifiers:'',updateModifiers:'player,instant',updatePartyForModifiers:'party,instant',
  removeModifier:'modifier,enemy',findModifiers:'modifierFilter,player=true'};
const sceneMethods=Object.fromEntries(Object.entries(frozen.sceneMethods).map(([name,source])=>[name,{
  reference:compileReference(source,sceneArgs[name],rules),
  live:compileReference(sceneClass.members.find(n=>n.name?.getText()===name).getText(),sceneArgs[name],rules)
}]));
const is=(p,name)=>p?.constructor===originalPhases[name];
const nextId=c=>`aftermath-${Number(c.decision.id.split('-').at(-1))+1}`;
export const atEggBoundary=c=>c.continuation.currentPhase===null&&is(nextPostPhase(c),'EggLapsePhase');
export const atBattleEnd=c=>c.continuation.currentPhase===null&&is(nextPostPhase(c),'BattleEndPhase');
const personal=(c,seat)=>c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index).map(e=>e.pokemon);

// Reuse these exact original update methods in the personal reward adapter as
// well as BattleEnd. Only modifier-bar presentation is supplied by the host.
export function bindOriginalModifierUpdates(scene,tasks,reference=false){
  for(const name of ['findModifiers','removeModifier','updatePartyForModifiers'])
    scene[name]=sceneMethods[name][reference?'reference':'live'].bind(scene);
  scene.updateModifiers=(player,instant)=>tasks.add(sceneMethods.updateModifiers[reference?'reference':'live'].call(scene,player,instant));
}

export async function aftermathContext({emptySeat=null,held=false,temporary=false,levelUp=false}={}){
  let c=levelUp?await levelUpContext({level:7,full:true}):await experienceContext();
  let steps=0;while(!atExperienceEnd(c)){check(++steps<60,'MISSING_AFTERMATH');c=(await advanceLevelUp(c,chooseProgression(c))).context;}
  if(emptySeat!==null)for(const p of personal(c,emptySeat)){p.hp=0;p.status=new status.Status(status.StatusEffect.FAINT);}
  if(temporary)for(const seat of [0,1]){
    const type=new types.TempBattleStatBoosterModifierType(0);type.id='TEMP_STAT_BOOSTER';
    c.players[seat].modifiers.push(new modifiers.TempBattleStatBoosterModifier(type,0,seat+1,1));
  }
  if(held){
    const enemy=c.battle.enemyParty[0],type=new types.AttackTypeBoosterModifierType(0,20);type.id='ATTACK_TYPE_BOOSTER';
    const item=new modifiers.AttackTypeBoosterModifier(type,enemy.id,0,20,1);item.pokemonId=null;
    c.enemyModifiers.push(item);c.battle.postBattleLoot.push(item);
  }
  return codec.restore(codec.capture(c));
}

export async function resumeAftermath(c,p,options={}){
  const b=bindExperience(c,p,0,options.reference),s=b.scene,tasks=createRuleTaskTracker(s);
  try{
    s.gameData={gameStats:{pokemonDefeated:0}};s.gameMode.isWaveFinal=()=>false;
    Object.defineProperty(s,'score',{get:()=>c.scene.score,set:value=>c.scene.score=value});
    s.updateScoreText=()=>{};s.offsetGym=c.scene.offsetGym;
    s.pushPhase=q=>queueOwnedPhase(c,q,null);
    options.onAftermathBind?.(c,p,b,tasks,{stage:'victory'});
    if(options.reference)referenceAftermath.call(p);else {p.recordDefeat();p.queueAftermath();}
    await tasks.drain();b.events.push({kind:'defeated-stat-hook',count:s.gameData.gameStats.pokemonDefeated});
    return {completed:b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
  }finally{tasks.close();b.dispose();}
}

// Room scene coordinates the once-per-battle original Phase. Each Pokemon's
// own scene points to its personal party/modifiers, including stat recalculation.
export async function runBattleEnd(c,p,options={}){
  check(c.roster.entries.some(e=>e.owner!==null&&e.group==='party'&&!e.pokemon.isFainted()),'UNCONFIRMED_SIMULTANEOUS_WIPE');
  check(c.battle.enemyParty.every(pk=>pk.isFainted(true)),'BATTLE_NOT_WON');
  const b=bindExperience(c,p,0,options.reference),s=b.scene,tasks=createRuleTaskTracker(s),children=[],temporary=[];
  const define=(o,k,value)=>{temporary.push([o,k,Object.getOwnPropertyDescriptor(o,k)]);Object.defineProperty(o,k,{value,configurable:true});};
  const method=name=>sceneMethods[name][options.reference?'reference':'live'];
  let finish;const done=new Promise(resolve=>finish=resolve),shift=s.shiftPhase;s.shiftPhase=()=>{shift();finish();};
  const tracked=()=>tasks.add(Promise.resolve());
  try{
    s.getParty=()=>[...personal(c,0),...personal(c,1)];
    Object.defineProperty(s,'score',{get:()=>c.scene.score,set:value=>c.scene.score=value});s.updateScoreText=()=>{};
    s.gameData={gameStats:{battles:0,trainersDefeated:0,highestEndlessWave:0}};
    s.updateUIPositions=()=>{};s.modifierBar=s.enemyModifierBar={updateModifiers(){}};
    for(const seat of [0,1]){
      const child=Object.create(s);child.getParty=()=>personal(c,seat);child.modifiers=c.players[seat].modifiers;
      bindExperienceModifiers(child,options.reference);
      child.unshiftPhase=q=>queueOwnedPhase(c,q,seat,true);child.pushPhase=q=>queueOwnedPhase(c,q,seat);
      children.push({scene:child,tracker:createRuleTaskTracker(child)});
      for(const name of ['findModifiers','removeModifier','updatePartyForModifiers'])child[name]=method(name).bind(child);
      child.updateModifiers=(player,instant)=>tasks.add(method('updateModifiers').call(child,player,instant));
    }
    // Each actor sees only its own modifiers during original stat/ability rules.
    for(const e of c.roster.entries){e.pokemon.scene=e.owner===null?s:children[e.owner].scene;define(e.pokemon,'updateInfo',tracked);}
    p.scene=s;c.arena.scene=s;
    s.unshiftPhase=q=>queueOwnedPhase(c,q,null,true);s.pushPhase=q=>queueOwnedPhase(c,q,null);
    s.findModifiers=(filter,player=true)=>(player?c.players.flatMap(p=>p.modifiers):c.enemyModifiers).filter(filter);
    s.removeModifier=(modifier,enemy)=>{
      if(enemy)return method('removeModifier').call(s,modifier,true);
      const seat=c.players.findIndex(player=>player.modifiers.includes(modifier));
      check(seat>=0,'UNKNOWN_PERSONAL_MODIFIER');return method('removeModifier').call(children[seat].scene,modifier);
    };
    s.updatePartyForModifiers=method('updatePartyForModifiers').bind(s);
    s.updateModifiers=(player,instant)=>player===false?tasks.add(method('updateModifiers').call(s,false,instant))
      :tasks.add(Promise.all(children.map(({scene})=>scene.updateModifiers(true,instant))));
    s.clearEnemyHeldItemModifiers=method('clearEnemyHeldItemModifiers').bind(s);
    if(options.reference)define(c.battle,'addBattleScore',referenceBattleScore);
    options.onAftermathBind?.(c,p,b,tasks,{stage:'battle-end'});
    if(options.reference)referenceBattleEnd.call(p);else p.start();
    await done;await tasks.drain();for(const child of children)await child.tracker.drain();
    b.events.push({kind:'battle-stat-hook',...s.gameData.gameStats});
    b.events.push(...recoverVictoryParties(c,(pk,seat)=>{
      const revive=types.modifierTypes.REVIVE().newModifier(pk);check(revive.shouldApply([pk]),'REVIVE_NOT_APPLICABLE');
      options.onAftermathBind?.(c,p,b,tasks,{stage:'recovery',seat});return revive.apply([pk]);
    }));
    await tasks.drain();return {completed:b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
  }catch(error){
    try{await tasks.drain();for(const child of children)await child.tracker.drain();}catch{}
    throw error;
  }finally{
    for(const [o,k,d]of temporary.reverse()){if(d)Object.defineProperty(o,k,d);else delete o[k];}
    for(const child of children)child.tracker.close();tasks.close();b.dispose();
  }
}

export function aftermathDriver(options={}){const base=progressionDriver(options);return {...base,
  supports:(c,p)=>c.battle.battleSpec===BattleSpec.DEFAULT&&c.battle.battleType===0&&(is(p,'VictoryPhase')||is(p,'BattleEndPhase')||base.supports(c,p)),
  resumeVictory:(c,p)=>resumeAftermath(c,p,options),
  execute:(c,p)=>is(p,'BattleEndPhase')?runBattleEnd(c,p,options):base.execute(c,p)
};}
export function advanceAftermath(c,inputs={},options={}){
  if(atExperienceEnd(c))return advanceVictoryAftermath(c,codec,aftermathDriver(options),{decisionId:nextId(c)});
  if(atBattleEnd(c))return advanceQueuedRulePhase(c,codec,aftermathDriver(options),{decisionId:nextId(c)});
  return advanceLevelUp(c,inputs,options);
}
export async function referenceAfterBattle(c,inputs={}){
  if(!atExperienceEnd(c)&&!atBattleEnd(c))return referenceProgression(c,inputs);
  const id=nextId(c),d=selectNextPhase(c.continuation,()=>check(false,'EMPTY_AFTERMATH_QUEUE')).phase;
  const result=await (is(d.phase,'VictoryPhase')?resumeAftermath(c,d.phase,{reference:true}):runBattleEnd(c,d.phase,{reference:true}));
  check(result.completed&&result.pendingTasks===0,'REFERENCE_AFTERMATH_INCOMPLETE');
  c.continuation.currentPhase=null;c.decision={id,kind:'continuing',requiredSeats:[],reason:'effects'};
  codec.capture(c);return {context:c,events:copy(result.events),grants:[]};
}
