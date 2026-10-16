import fs from 'node:fs';
import {evaluate,read,moves,arena} from './original-model.mjs';
import {codec} from './decision-model.mjs';
import {originalPhases,installPhaseTestDependencies,phaseCodec,phaseRenderGlobals} from './phase-model.mjs';
import {effectContext,damageRules,runEffect,nativeEffectDriver} from './move-effect-model.mjs';
import {bindAction,compileReference,utils} from './move-execution-model.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';

export const statRules=evaluate(read('data/battle-stat.ts'));
export const {BattleSpec}=evaluate(read('enums/battle-spec.ts'));
installPhaseTestDependencies({'./data/battle-stat':statRules,'./data/arena-tag':arena,'./enums/battle-spec':{BattleSpec}});
utils.fixedInt=n=>n; // Presentation duration only; no rule RNG or clocks are replaced.
installPhaseTestDependencies({'./utils':{fixedInt:utils.fixedInt}});
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-post-damage-reference.json',import.meta.url),'utf8'));
const rules={...damageRules,...statRules,...arena,...phaseRenderGlobals,BattleSpec};
const reference=Object.fromEntries(Object.entries(frozen.methods).map(([name,methods])=>[name,
  Object.fromEntries(Object.entries(methods).map(([method,body])=>[method,
    compileReference(body.replaceAll('super.end();','this.scene.shiftPhase();'),
      method==='updateAmount'?'amount':method==='getStatChangeMessages'?'stats,levels,relLevels':'',rules)]))]));

export function statContext(seat=0,{stats=[statRules.BattleStat.ATK],levels=-1,selfTarget=false,showMessage=true,stage=0,inactive=false}={}){
  const c=effectContext(seat),p=c.roster.entries[seat].pokemon;
  p.summonData.battleStats.fill(stage);if(inactive)p.hp=0;
  const phase=new originalPhases.StatChangePhase({},seat,selfTarget,stats,levels,showMessage);
  c.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase:phaseCodec.capture(phase,c,seat),remaining:'start'}];
  c.decision.id='post-0';return c;
}

export async function postEffectContext(seat=0,move=moves.Moves.TACKLE,{faint=false}={}){
  const c=effectContext(seat,move,'post-damage');
  if(faint)c.roster.entries[2].pokemon.hp=1;
  const result=await runEffect(c);result.context.decision.id='post-0';return result.context;
}

// Only these declared branches are exercised. Faint and final-boss transitions
// require separate ownership/victory decisions and must not run here.
export function postDamageDriver({reference:useReference=false,onBind,bindModifiers}={}){return {
  supports:(c,p)=>c.battle.battleSpec!==BattleSpec.FINAL_BOSS&&
    [originalPhases.DamagePhase.prototype,originalPhases.StatChangePhase.prototype,
      originalPhases.MoveEffectPhase.prototype].includes(Object.getPrototypeOf(p)),
  async execute(c,phase){
    if(Object.getPrototypeOf(phase)===originalPhases.MoveEffectPhase.prototype){
      if(!useReference)return nativeEffectDriver.execute(c,phase,{bindModifiers});
      // runEffect selects the Phase itself; preserve selection for its live reference path.
      const descriptor=c.continuation.currentPhase;c.continuation.currentPhase=null;
      c.continuation.phaseQueue.unshift(descriptor);
      const result=await runEffect(c,{reference:true,clone:false,bindModifiers});
      c.continuation.currentPhase=descriptor;
      return {completed:true,pendingTasks:0,events:result.events,grants:[]};
    }
    const b=bindAction(c,phase),tasks=createRuleTaskTracker(b.scene),callbacks=[];
    let modifierBinding;
    const temporary=[];
    const defer=fn=>callbacks.push(fn);
    const define=(object,key,value)=>{temporary.push([object,key,Object.getOwnPropertyDescriptor(object,key)]);
      Object.defineProperty(object,key,{value,configurable:true});};
    try{
      const s=b.scene;
      s.playSound=sound=>b.events.push({kind:'sound',sound});
      s.toggleInvert=value=>b.events.push({kind:'invert',value});
      s.damageNumberHandler={add:(p,amount,result,critical)=>b.events.push({kind:'damage-display',pokemonId:p.id,amount,result,critical})};
      s.time={delayedCall:(_ms,fn)=>defer(fn),addEvent:config=>{
        const timer={repeatCount:config.repeat};
        for(let n=config.repeat;n>=0;n--)defer(()=>{timer.repeatCount=n;config.callback();});return timer;
      }};
      s.field.scale=1;
      s.add={tileSprite:()=>Object.fromEntries(['setPipeline','setAlpha','setScale','setOrigin','setMask'].map(k=>[k,()=>{}]))};
      s.tweens={add:config=>{if(config.onComplete)defer(config.onComplete);}};
      for(const {pokemon:p}of c.roster.entries){
        define(p,'getSprite',()=>({setVisible:()=>{}}));define(p,'getSpriteScale',()=>1);
        define(p,'enableMask',()=>{});define(p,'disableMask',()=>{});
        define(p,'updateInfo',()=>{b.events.push({kind:'status-display',pokemonId:p.id});
          const task=Promise.resolve();tasks.add(task);return task;});
      }
      if(useReference)for(const [name,method]of Object.entries(reference[phase.constructor.name]))define(phase,name,method);
      modifierBinding=bindModifiers?.(c,phase,b,tasks);
      onBind?.(c,phase,{...b,tasks,callbacks});
      phase.start();
      // Presentation callbacks are explicit queued work, never persisted or used as rule clocks.
      let steps=0;
      while(callbacks.length){if(++steps>100)throw Error('Presentation did not settle');callbacks.shift()();}
      await (modifierBinding?.drain()??tasks.drain());await Promise.resolve();
      return {completed:b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
    }finally{
      modifierBinding?.dispose();
      for(const [object,key,descriptor]of temporary.reverse()){if(descriptor)Object.defineProperty(object,key,descriptor);else delete object[key];}
      tasks.close();b.dispose();
    }
  }
};}
const nextId=c=>`post-${Number(c.decision.id.split('-').at(-1))+1}`;
export const advancePostDamage=(c,options={})=>advanceQueuedRulePhase(c,codec,postDamageDriver(options),{decisionId:nextId(c)});
export async function runPostDamageReference(c){
  const id=nextId(c),descriptor=selectNextPhase(c.continuation,()=>{throw Error('Empty post-damage queue');}).phase;
  const driver=postDamageDriver({reference:true});if(!driver.supports(c,descriptor.phase))throw Error('Unsupported reference Phase');
  const result=await driver.execute(c,descriptor.phase);if(!result.completed)throw Error('Reference did not end');
  c.continuation.currentPhase=null;c.decision.id=id;codec.capture(c);return {context:c,...result};
}
export function nextPostPhase(c){const state={...c.continuation,phaseQueue:[...c.continuation.phaseQueue],phaseQueuePrepend:[...c.continuation.phaseQueuePrepend]};
  return selectNextPhase(state,()=>{}).phase?.phase;}
