import fs from 'node:fs';
import ts from 'typescript';
import {nativeSwitchStep,queueOwnedPhase} from './native-switch-model.mjs';
import {codec} from './decision-model.mjs';
import {parse,evaluate,originalPokemon,pokemon,moves} from './original-model.mjs';
import {originalPhases,phaseCodec,installPhaseTestDependencies} from './phase-model.mjs';
import {bindAction,compileReference,abilityRules} from './move-execution-model.mjs';
import {damageRules} from './move-effect-model.mjs';
import {faintContext,faintDriver,advanceFaint} from './faint-model.mjs';
import {advanceCycle,runCycleReference,chooseCycleInputs} from './command-cycle-model.mjs';
import {nextPostPhase,BattleSpec} from './post-damage-model.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {advanceForcedSwitch} from '../../src/battle-core/forced-switch-runner.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {resolveForcedSwitchIntent,selectSwitchSummon} from '../../src/battle-core/switch-command.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {requireContract as check} from '../../src/battle-core/coop-contract.mjs';

// The older native-switch helper loads a narrow dispatcher for its own suite.
// This composed suite uses the full original ability catalogue and dispatcher.
installPhaseTestDependencies({'./data/ability':abilityRules});
const enumOf=(file,name)=>evaluate(parse(file).statements.filter(n=>n.name?.text===name).map(n=>n.getText()).join('\n'))[name];
const Mode=enumOf('ui/ui.ts','Mode'),PartyOption=enumOf('ui/party-ui-handler.ts','PartyOption');
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-replacement-reference.json',import.meta.url),'utf8'));
const rules={...damageRules,...originalPhases,...abilityRules,Mode,PartyOption};
const referenceSummonOnEnd=compileReference(frozen.methods.SummonPhase.onEnd,'',rules);
const oldFinish=JSON.parse(fs.readFileSync(new URL('../fixtures/early-continuation-reference.json',import.meta.url),'utf8'));
const referenceSwitchOnEnd=compileReference(oldFinish.finish.replace('super.onEnd()','referenceSummonOnEnd.call(this)'),'',
  {...rules,referenceSummonOnEnd,Command:enumOf('ui/command-ui-handler.ts','Command')});
const referenceMethods={...Object.fromEntries(Object.entries(frozen.methods.SummonPhase).map(([k,v])=>[k,
  compileReference(v.replaceAll('super.end()','this.scene.shiftPhase()'),'',rules)])),
  ...Object.fromEntries(Object.entries(frozen.methods.SwitchSummonPhase).map(([k,v])=>[k,compileReference(v,'',rules)])),onEnd:referenceSwitchOnEnd};
const oldSwitch=JSON.parse(fs.readFileSync(new URL('../fixtures/early-switch-command-reference.json',import.meta.url),'utf8'));
const callbackAst=ts.createSourceFile('switch-reference.ts',oldSwitch.source,ts.ScriptTarget.Latest,true);let callback;
function visit(n){if(ts.isArrowFunction(n)&&n.parameters[0]?.name.getText(callbackAst)==='slotIndex')callback=n;ts.forEachChild(n,visit);}visit(callbackAst);
const referenceCallback=compileReference(`resume(slotIndex,option,fieldIndex) ${callback.body.getText(callbackAst).replaceAll('super.end()','this.scene.shiftPhase()')}`,
  'slotIndex,option,fieldIndex',rules);
const referencePost=compileReference(frozen.methods.PostSummonPhase.start,'',rules);
const is=(p,name)=>p?.constructor===originalPhases[name];
const patchMethods=(p,methods)=>{const old=[];for(const [key,value]of Object.entries(methods)){
  old.push([key,Object.getOwnPropertyDescriptor(p,key)]);Object.defineProperty(p,key,{value,configurable:true});}
  return ()=>{for(const [key,d]of old){if(d)Object.defineProperty(p,key,d);else delete p[key];}};};

export async function replacementContext({seat=0,both=false,reserves=2,lethalRound=false}={}){
  let c=faintContext({seat,both,reserves,lethalRound});
  if(both){const p=originalPokemon(130+1-seat);p.hp=p.stats[0]=200;p.status=null;p.fusionSpecies=null;p.summonData.speciesForm=null;
    p.summonData.fusionSpeciesForm=null;p.summonData.moveset=null;p.summonData.tags=[];p.summonData.moveQueue=[];p.summonData.disabledMove=0;
    p.moveset=[new pokemon.PokemonMove(moves.Moves.TACKLE,0,0,false)];
    c.roster.entries.push({owner:1-seat,group:'party',index:1,pokemon:p});}
  while(c.decision.kind==='continuing')c=(await advanceFaint(c)).context;
  check(c.decision.kind==='wait-switch','MISSING_SWITCH_BOUNDARY');return c;
}

export function forcedSwitchDriver({reference=false,onSwitchBind}={}){return {
  async resumeSwitch(c,p,intent){const {seat,partyIndex}=intent,b=bindAction(c,p),tasks=createRuleTaskTracker(b.scene);
    try{
      // The original menu callback uses one local active slot in this seat's
      // personal party. The global seat stays on Switch and in the phase scope.
      const battle=c.battle;b.scene.currentBattle=Object.create(battle);
      b.scene.currentBattle.getBattlerCount=()=>1;
      b.scene.unshiftPhase=q=>queueOwnedPhase(c,q,seat,true);
      b.scene.ui={setMode(mode){check(mode===Mode.MESSAGE,'UNSUPPORTED_SWITCH_UI');const task=Promise.resolve();tasks.add(task);return task;}};
      onSwitchBind?.(c,p,b,tasks,{stage:'wait-switch'});
      if(reference)referenceCallback.call(p,partyIndex,PartyOption.SEND_OUT,0);
      else{
        const summon=selectSwitchSummon(0,partyIndex,1,false,PartyOption.SEND_OUT,PartyOption.PASS_BATON);
        check(summon,'ORIGINAL_SWITCH_REJECTED');
        b.scene.unshiftPhase(new originalPhases.SwitchSummonPhase(b.scene,summon.fieldIndex,summon.slotIndex,summon.doReturn,summon.batonPass));
        b.scene.ui.setMode(Mode.MESSAGE).then(()=>p.end());
      }
      await tasks.drain();await Promise.resolve();return {completed:b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
    }finally{tasks.close();b.dispose();}
  }
};}

export function replacementDriver(options={}){const faint=faintDriver(options);return {
  supports:(c,p)=>c.battle.battleSpec===BattleSpec.DEFAULT&&(faint.supports(c,p)
    ||is(p,'PostSummonPhase')||is(p,'SwitchSummonPhase')&&p.player===true&&p.doReturn===false&&p.batonPass===false),
  async execute(c,p){
    if(is(p,'SwitchSummonPhase'))return runStage(c,p);
    if(!is(p,'PostSummonPhase'))return faint.execute(c,p);
    const b=bindAction(c,p),tasks=createRuleTaskTracker(b.scene);
    try{options.onSwitchBind?.(c,p,b,tasks,{stage:'post-summon'});
      if(options.reference)referencePost.call(p);else p.start();
      await tasks.drain();await Promise.resolve();return {completed:b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
    }finally{tasks.close();b.dispose();}
  },
  resume:runStage,
  finishBoundary:faint.finishBoundary,
  suspendBoundary(c,p,id,result){
    if(!is(p,'SwitchSummonPhase'))return faint.suspendBoundary(c,p,id,result);
    check(['summon-initialize','summon-finish'].includes(result.remaining),'INVALID_SWITCH_STAGE');
    return {remaining:result.remaining,decision:{id,kind:'continuing',requiredSeats:[],reason:'switch'}};
  }
};
  async function runStage(c,p){
    check(is(p,'SwitchSummonPhase')&&p.player&&p.doReturn===false&&p.batonPass===false,'UNSUPPORTED_SWITCH_RESUME');
    const seat=phaseCodec.capture(p,c).scope;check(seat===0||seat===1,'INVALID_SWITCH_SCOPE');
    const party=c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index),stage=c.continuation.currentPhase.remaining;
    check(p.partyMemberIndex===0&&party[0]?.pokemon.id===c.roster.field[seat],'INVALID_SWITCH_PARTY');
    if(stage==='start')check(p.fieldIndex===0&&party[0].pokemon.isFainted()&&p.slotIndex>0
      &&party[p.slotIndex]&&!party[p.slotIndex].pokemon.isFainted(),'INVALID_SWITCH_PARTY');
    else check(['summon-initialize','summon-finish'].includes(stage)&&p.fieldIndex===seat
      &&party[p.slotIndex]?.pokemon===p.lastPokemon&&p.lastPokemon.isFainted()&&!party[0].pokemon.isFainted(),'INVALID_SWITCH_PARTY');
    const result=await nativeSwitchStep(c,seat,false,{managed:true,onBind:options.onSwitchBind,
      patchPhase:options.reference?phase=>patchMethods(phase,referenceMethods):undefined});
    return {completed:result.completed,suspended:result.suspended,remaining:result.remaining,pendingTasks:result.pendingTasks,events:result.events,grants:[]};
  }
}
const nextId=c=>`replacement-${Number(c.decision.id.split('-').at(-1))+1}`;
export function advanceReplacement(c,inputs={},options={}){
  const config={decisionId:nextId(c)};
  if(c.decision.kind==='wait-switch')return advanceForcedSwitch(c,inputs,codec,forcedSwitchDriver(options),config);
  if(['wait-actions','wait-target'].includes(c.decision.kind))return advanceCycle(c,inputs,{...options,allowSuspend:true});
  return advanceQueuedRulePhase(c,codec,replacementDriver(options),config);
}
export const chooseReplacementInputs=c=>c.decision.kind==='continuing'?{}:c.decision.kind==='wait-switch'
  ?Object.fromEntries(c.decision.requiredSeats.map(s=>[s,c.decision.options[s].at(-1)])):chooseCycleInputs(c);
export async function referenceReplacement(c,inputs={}){
  const id=nextId(c);
  if(c.decision.kind==='wait-switch'){
    const seat=c.decision.requiredSeats[0];codec.validateAction(c,seat,inputs[seat]);const intent=resolveForcedSwitchIntent(c,seat,inputs[seat]);
    const result=await forcedSwitchDriver({reference:true}).resumeSwitch(c,c.continuation.currentPhase.phase,{seat,...intent});
    check(result.completed&&result.pendingTasks===0,'REFERENCE_SWITCH_INCOMPLETE');c.continuation.currentPhase=null;
    c.decision={id,kind:'continuing',requiredSeats:[],reason:'effects'};codec.capture(c);return {context:c,events:result.events,grants:[]};
  }
  if(['wait-actions','wait-target'].includes(c.decision.kind))return runCycleReference(c,inputs,{allowSuspend:true});
  const driver=replacementDriver({reference:true}),resuming=!!c.continuation.currentPhase,
    d=c.continuation.currentPhase||selectNextPhase(c.continuation,()=>check(false,'EMPTY_SWITCH_QUEUE')).phase;
  check(driver.supports(c,d.phase),'UNSUPPORTED_RULE_PHASE');
  const result=await (resuming?driver.resume(c,d.phase,d.remaining):driver.execute(c,d.phase));
  check((result.completed||result.suspended)&&result.pendingTasks===0,'REFERENCE_SWITCH_INCOMPLETE');
  if(result.suspended){const stop=driver.suspendBoundary(c,d.phase,id,result);d.remaining=stop.remaining;c.decision=stop.decision;}
  else{c.continuation.currentPhase=null;c.decision=driver.finishBoundary(c,d.phase,id);}
  codec.capture(c);return {context:c,events:result.events,grants:[]};
}
