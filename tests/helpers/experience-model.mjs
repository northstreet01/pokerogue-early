import fs from 'node:fs';
import ts from 'typescript';
import {codec} from './decision-model.mjs';
import {parse,read,evaluate,pokemon,installPokemonTestDependencies} from './original-model.mjs';
import {originalPhases,phaseCodec,phaseRenderGlobals,installPhaseTestDependencies} from './phase-model.mjs';
import {bindAction,compileReference,utils} from './move-execution-model.mjs';
import {damageRules} from './move-effect-model.mjs';
import {modifiers,types,installModifierTestDependencies} from './modifier-model.mjs';
import {enemyFaintContext,advanceEnemyFaint,atVictoryBoundary,enemyFaintDriver,referenceCap,liveCap,waveForDifficulty} from './enemy-faint-model.mjs';
import {queueOwnedPhase} from './native-switch-model.mjs';
import {nextPostPhase,BattleSpec} from './post-damage-model.mjs';
import {advanceVictoryExperience} from "./reference-rules/victory-experience-runner.mjs";
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {requireContract as check} from '../../src/battle-core/coop-contract.mjs';

export const expRules=evaluate(read('data/exp.ts'));
installPokemonTestDependencies({'../data/exp':expRules});
installModifierTestDependencies({'../utils':{NumberHolder:utils.NumberHolder}});
installPhaseTestDependencies({'./system/achv':{achvs:{MAX_FRIENDSHIP:'MAX_FRIENDSHIP'}}});
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-experience-reference.json',import.meta.url),'utf8'));
const expStart=frozen.methods.VictoryPhase.start;
const expBody=expStart.slice(expStart.indexOf('    const participantIds'),expStart.indexOf('    if (!this.scene.getEnemyParty()'));
const rules={...damageRules,...originalPhases,...modifiers,...phaseRenderGlobals,achvs:{MAX_FRIENDSHIP:'MAX_FRIENDSHIP'}};
const referenceQueue=compileReference(`queue(){${expBody}}`,'',rules);
const referencePhases=Object.fromEntries(['ExpPhase','ShowPartyExpBarPhase','HidePartyExpBarPhase'].map(name=>[name,
  compileReference(frozen.methods[name].start,'',rules)]));
const liveSceneClass=parse('battle-scene.ts').statements.find(n=>n.name?.text==='BattleScene');
const methodBody=source=>{const ast=ts.createSourceFile('method.ts',`class C {${source}}`,ts.ScriptTarget.Latest,true);
  return `method() ${ast.statements[0].members[0].body.getText(ast)}`;};
const sceneMethods=Object.fromEntries(Object.entries(frozen.sceneMethods).map(([name,body])=>[name,{
  original:compileReference(methodBody(body),name==='findModifier'?'modifierFilter,player=true':'modifierType,player=true,...args',{}),
  live:compileReference(methodBody(liveSceneClass.members.find(n=>n.name?.getText()===name).getText()),
    name==='findModifier'?'modifierFilter,player=true':'modifierType,player=true,...args',{})
}]));
const is=(p,name)=>p?.constructor===originalPhases[name];
const supportedExp=p=>['ExpPhase','ShowPartyExpBarPhase','HidePartyExpBarPhase'].some(name=>is(p,name));
export const atExperienceEnd=c=>c.continuation.currentPhase===null&&c.continuation.phaseQueuePrepend.length===0
  &&c.continuation.phaseQueue[0]?.remaining==='victory-aftermath';

export function bindExperienceModifiers(scene,reference=false){
  for(const [name,methods]of Object.entries(sceneMethods))scene[name]=methods[reference?'original':'live'].bind(scene);
}

export function bindExperience(c,p,seat,reference){
  const b=bindAction(c,p),s=b.scene;
  s.getParty=()=>c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index).map(e=>e.pokemon);
  s.getEnemyParty=()=>c.battle.enemyParty;
  s.modifiers=c.players[seat].modifiers;s.enemyModifiers=c.enemyModifiers;
  bindExperienceModifiers(s,reference);
  s.gameMode=Object.create(c.scene.gameMode);s.gameMode.getWaveForDifficulty=waveForDifficulty;
  s.getMaxExpLevel=(reference?referenceCap:liveCap).bind(s);
  const index=s.field.getIndex;s.field.getIndex=pk=>pk.isFainted(true)?-1:index(pk);
  s.unshiftPhase=q=>queueOwnedPhase(c,q,seat,true);
  s.validateAchv=id=>b.events.push({kind:'achievement-hook',seat,id});
  return b;
}

export async function experienceContext({share=false,balance=false,bonuses=false,emptySeat=false,levelUp=false}={}){
  let c=enemyFaintContext();c=(await advanceEnemyFaint(c)).context;
  check(atVictoryBoundary(c),'MISSING_VICTORY_BOUNDARY');
  for(const seat of [0,1]){
    const source=c.roster.entries[seat].pokemon,reserve=pokemon.restorePokemonState(pokemon.capturePokemonState(source));
    reserve.id=110+seat;reserve.pokerus=false;reserve.friendship=70;
    c.roster.entries.push({owner:seat,group:'party',index:1,pokemon:reserve});
  }
  if(share){const type=types.modifierTypes.EXP_SHARE();type.id='EXP_SHARE';c.players[0].modifiers.push(new modifiers.ExpShareModifier(type,2));}
  if(balance){const type=types.modifierTypes.EXP_BALANCE();type.id='EXP_BALANCE';c.players[0].modifiers.push(new modifiers.ExpBalanceModifier(type,2));
    const p=c.roster.entries.find(e=>e.pokemon.id===110).pokemon;p.level=3;p.exp=27;p.levelExp=0;}
  if(bonuses){
    for(const [id,seat,pid,args]of [['EXP_CHARM',0,null,[25,1]],['LUCKY_EGG',1,101,[40,1]],['SOOTHE_BELL',1,101,[1]]]){
      const type=types.modifierTypes[id]();type.id=id;
      const modifier=id==='EXP_CHARM'?new modifiers.ExpBoosterModifier(type,...args):id==='LUCKY_EGG'
        ?new modifiers.PokemonExpBoosterModifier(type,pid,...args):new modifiers.PokemonFriendshipBoosterModifier(type,pid,...args);
      c.players[seat].modifiers.push(modifier);
    }
    c.roster.entries[1].pokemon.pokerus=true;
  }
  if(emptySeat){for(const e of c.roster.entries.filter(e=>e.owner===0))e.pokemon.hp=0;c.battle.playerParticipantIds.delete(100);}
  if(levelUp){c.roster.entries[1].pokemon.exp=210;c.roster.entries[1].pokemon.levelExp=85;}
  return codec.restore(codec.capture(c));
}

export function experienceDriver(options={}){const base=enemyFaintDriver(options);return {
  supports(c,p){return c.battle.battleSpec===BattleSpec.DEFAULT&&(is(p,'VictoryPhase')&&c.battle.battleType===0
    &&p.player===false||supportedExp(p)||base.supports(c,p));},
  async queueExperience(c,p){
    check(is(p,'VictoryPhase')&&c.roster.entries.find(e=>e.pokemon.id===c.roster.field[p.battlerIndex])?.pokemon.isFainted(true),
      'INVALID_VICTORY_PHASE');
    let baseExp;const events=[];
    for(const seat of [0,1]){
      const b=bindExperience(c,p,seat,options.reference),tasks=createRuleTaskTracker(b.scene);
      try{
        if(baseExp===undefined)baseExp=p.getPokemon().getExpValue();
        options.onExperienceBind?.(c,p,b,tasks,{seat,stage:'queue'});
        if(options.reference){
          // Frozen original calls getExpValue. Bind the already calculated value
          // without mutating the Pokemon or its catalog methods.
          const originalGet=p.getPokemon;p.getPokemon=()=>({getExpValue:()=>baseExp});
          try{referenceQueue.call(p);}finally{delete p.getPokemon;check(p.getPokemon===originalGet,'INVALID_REFERENCE_BINDING');}
        }else p.queueExperience(baseExp);
        await tasks.drain();events.push(...b.events);
      }finally{tasks.close();b.dispose();}
    }
    return {completed:true,pendingTasks:0,events,grants:[]};
  },
  async execute(c,p){
    if(!supportedExp(p)){check(!is(p,'VictoryPhase'),'VICTORY_AFTERMATH_UNAVAILABLE');return base.execute(c,p);}
    const seat=phaseCodec.capture(p,c).scope;check(seat===0||seat===1,'INVALID_EXP_OWNER');
    const b=bindExperience(c,p,seat,options.reference),tasks=createRuleTaskTracker(b.scene),temporary=[];
    const define=(object,key,value)=>{temporary.push([object,key,Object.getOwnPropertyDescriptor(object,key)]);Object.defineProperty(object,key,{value,configurable:true});};
    let finish;const ended=new Promise(resolve=>finish=resolve),shift=b.scene.shiftPhase;
    b.scene.shiftPhase=()=>{shift();finish();};
    const tracked=()=>{const task=Promise.resolve();tasks.add(task);return task;};
    try{
      b.scene.ui={showText:(text,_delay,done)=>{b.events.push({kind:'experience-message',seat,text});done();}};
      b.scene.partyExpBar={showPokemonExp:(pk,exp)=>{b.events.push({kind:'experience-bar',seat,pokemonId:pk.id,exp});return tracked();},hide:tracked};
      for(const {pokemon:pk}of c.roster.entries)define(pk,'updateInfo',tracked);
      options.onExperienceBind?.(c,p,b,tasks,{seat,stage:'apply'});
      if(options.reference)referencePhases[p.constructor.name].call(p);else p.start();
      await ended;await tasks.drain();return {completed:b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
    }finally{for(const [o,k,d]of temporary.reverse()){if(d)Object.defineProperty(o,k,d);else delete o[k];}tasks.close();b.dispose();}
  },
  finishBoundary:(c,_p,id)=>({id,kind:'continuing',requiredSeats:[],reason:'effects'})
};}
const nextId=c=>`experience-${Number(c.decision.id.split('-').at(-1))+1}`;
export const advanceExperience=(c,options={})=>atVictoryBoundary(c)&&!atExperienceEnd(c)
  ?advanceVictoryExperience(c,codec,experienceDriver(options),{decisionId:nextId(c)})
  :advanceQueuedRulePhase(c,codec,experienceDriver(options),{decisionId:nextId(c)});

export async function referenceExperience(c){
  const id=nextId(c),driver=experienceDriver({reference:true}),d=selectNextPhase(c.continuation,()=>check(false,'EMPTY_EXP_QUEUE')).phase;
  check(d.remaining==='start'&&driver.supports(c,d.phase),'UNSUPPORTED_RULE_PHASE');
  const result=is(d.phase,'VictoryPhase')?await driver.queueExperience(c,d.phase):await driver.execute(c,d.phase);
  check(result.completed&&result.pendingTasks===0,'REFERENCE_EXPERIENCE_INCOMPLETE');c.continuation.currentPhase=null;
  if(is(d.phase,'VictoryPhase')){d.remaining='victory-aftermath';c.continuation.phaseQueue.unshift(d);}
  c.decision=driver.finishBoundary(c,d.phase,id);codec.capture(c);return {context:c,events:result.events,grants:[]};
}
export const referenceSoloVictory=compileReference(expStart,'',{...rules,modifierTypes:types.modifierTypes});
