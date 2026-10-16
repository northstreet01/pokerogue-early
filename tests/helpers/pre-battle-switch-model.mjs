import fs from 'node:fs';
import ts from 'typescript';
import {codec} from './decision-model.mjs';
import {nextBattleContext,createNextBattle,advanceEntry,entryDriver,nextPostPhase} from './next-battle-model.mjs';
import {replacementDriver} from './replacement-model.mjs';
import {originalPhases,phaseCodec,installPhaseTestDependencies} from './phase-model.mjs';
import {parse,evaluate} from './original-model.mjs';
import {bindAction,compileReference,actionRules,abilityRules} from './move-execution-model.mjs';
import {queueOwnedPhase} from './native-switch-model.mjs';
import {finishRoundBoundary} from './round-loop-model.mjs';
import {advanceCycle,runCycleReference,chooseCycleInputs,cycleDriver} from './command-cycle-model.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {advancePreBattleSwitch} from '../../src/battle-core/pre-battle-switch-runner.mjs';
import {createPreBattleSwitchDecision} from '../../src/battle-core/switch-command.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {copy,requireContract as check} from '../../src/battle-core/coop-contract.mjs';

const enums=file=>evaluate(parse(file).statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n'));
const {Mode}=enums('ui/ui.ts'),{PartyOption,PartyUiMode}=enums('ui/party-ui-handler.ts');
const filter=parse('ui/party-ui-handler.ts').statements.find(n=>n.name?.text==='PartyUiHandler').members.find(n=>n.name?.getText()==='FilterNonFainted');
const FilterNonFainted=evaluate(`export const filter=${filter.initializer.getText()}`).filter;
const uiRules={Mode,PartyOption,PartyUiMode,PartyUiHandler:{FilterNonFainted}};
installPhaseTestDependencies({'./ui/party-ui-handler':uiRules,'./ui/ui':{Mode},'./data/ability':abilityRules});
const frozenNext=JSON.parse(fs.readFileSync(new URL('../fixtures/early-next-battle-reference.json',import.meta.url),'utf8'));
const switchSource=JSON.parse(fs.readFileSync(new URL('../fixtures/early-switch-command-reference.json',import.meta.url),'utf8')).source;
const ast=ts.createSourceFile('confirm.ts',`class C{${frozenNext.phases.CheckSwitchPhase.start}}`,99,true);
let confirmCall;function visit(n){if(ts.isCallExpression(n)&&n.arguments[0]?.getText(ast)==='Mode.CONFIRM')confirmCall=n;ts.forEachChild(n,visit);}visit(ast);
const rules={...actionRules,...uiRules};
const fromArrow=(arrow,args='')=>compileReference(`resume(){${arrow.body.getText(arrow.getSourceFile()).slice(1,-1).replaceAll('super.end()','this.scene.shiftPhase()')}}`,args,rules);
const referenceConfirm=[fromArrow(confirmCall.arguments[1]),fromArrow(confirmCall.arguments[2])];
const switchAst=ts.createSourceFile('switch.ts',switchSource,99,true);let selectArrow;
function find(n){if(ts.isArrowFunction(n)&&n.parameters[0]?.name.getText(switchAst)==='slotIndex')selectArrow=n;ts.forEachChild(n,find);}find(switchAst);
const referenceSelect=fromArrow(selectArrow,'slotIndex,option,fieldIndex');
const checkStart=compileReference(frozenNext.phases.CheckSwitchPhase.start.replaceAll('super.end()','this.scene.shiftPhase()'),'',rules);
const switchStart=compileReference(switchAst.statements[0].members.find(n=>n.name?.getText(switchAst)==='start').getText(switchAst)
  .replaceAll('super.end()','this.scene.shiftPhase()'),'',rules);
const is=(p,name)=>p?.constructor===originalPhases[name];
const owned=(c,seat)=>c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index);
const nextId=c=>`pre-switch-${Number(c.decision.id.split('-').at(-1))+1}`;

export async function preBattleContext({seats=[0,1],ready=true}={}){
  const c=await nextBattleContext({ready});
  for(const seat of seats){const reserve=owned(c,seat)[1].pokemon;reserve.hp=reserve.stats[0]=100;reserve.status=null;}
  return codec.restore(copy(codec.capture(c)));
}
export const createPreBattle=(c,options={})=>createNextBattle(c,{...options,preBattleSwitch:true});
export function choiceDriver(options={}){return {
  finishBoundary:finishRoundBoundary,
  async execute(c,p){return run(c,p,null);},
  async resumeChoice(c,p,intent){return run(c,p,intent);},
  suspendBoundary(c,p,id){const kind=is(p,'CheckSwitchPhase')?'switch-confirm':'switch-select';
    return {remaining:kind,decision:createPreBattleSwitchDecision(id,c,p.fieldIndex,kind)};}
};
  async function run(c,p,intent){
    const seat=p.fieldIndex,b=bindAction(c,p),s=b.scene,tasks=createRuleTaskTracker(s);let waiting=false;
    let modifierBinding;
    try{
      s.getParty=()=>owned(c,seat).map(e=>e.pokemon);s.field.getAll=()=>c.roster.field.map(id=>c.roster.entries.find(e=>e.pokemon.id===id)?.pokemon).filter(Boolean);
      s.currentBattle=Object.create(c.battle);s.currentBattle.getBattlerCount=()=>1;
      s.unshiftPhase=q=>queueOwnedPhase(c,q,seat,true);
      s.ui={showText:(text,_delay,done)=>{b.events.push({kind:'switch-question',seat,text});done?.();},
        setMode(mode){if(mode===Mode.PARTY||mode===Mode.CONFIRM)waiting=true;else check(mode===Mode.MESSAGE,'UNSUPPORTED_SWITCH_UI');return tasks.add(Promise.resolve());}};
      modifierBinding=options.bindModifiers?.(c,p,b,tasks);options.onChoiceBind?.(c,p,b,tasks,intent);
      if(intent){
        if(intent.kind==='switch-confirm'){
          if(options.reference)referenceConfirm[intent.action.accept?0:1].call(p);
          else p.createSwitchConfirmCallbacks()[intent.action.accept?'accept':'cancel']();
        }else{
          const entry=intent.action.pokemonId===null?null:owned(c,seat).find(e=>e.pokemon.id===intent.action.pokemonId);
          const slot=entry?.index??6,option=entry?PartyOption.SEND_OUT:PartyOption.CANCEL;
          if(options.reference)referenceSelect.call(p,slot,option,0);
          else p.createSwitchSelectCallback(0)(slot,option);
        }
      }else if(is(p,'CheckSwitchPhase')){
        if(options.reference)checkStart.call(p);else p.start();
      }else{
        // The global owner stays in the checkpoint/scope; the original personal
        // menu operates on its own local active slot, just like faint replacement.
        p.fieldIndex=0;
        try{if(options.reference)switchStart.call(p);else p.start();}finally{p.fieldIndex=seat;}
      }
      await (modifierBinding?.drain()??tasks.drain());await Promise.resolve();
      return {completed:b.ended,suspended:waiting&&!b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
    }finally{modifierBinding?.dispose();p.fieldIndex=seat;tasks.close();b.dispose();}
  }
}
export function preBattleDriver(options={}){
  const base=entryDriver(options),choices=choiceDriver(options),replacement=replacementDriver({...options,preBattleReturn:true}),cycle=cycleDriver(options);
  return {
    supports:(c,p)=>is(p,'CheckSwitchPhase')||is(p,'SwitchPhase')||is(p,'SwitchSummonPhase')||base.supports(c,p)||cycle.supports(c,p),
    execute:(c,p)=>is(p,'CheckSwitchPhase')||is(p,'SwitchPhase')?choices.execute(c,p)
      :is(p,'SwitchSummonPhase')||is(p,'PostSummonPhase')?replacement.execute(c,p):base.supports(c,p)?base.execute(c,p):cycle.execute(c,p),
    resume:replacement.resume,
    suspendBoundary:(c,p,id,r)=>is(p,'CheckSwitchPhase')||is(p,'SwitchPhase')?choices.suspendBoundary(c,p,id,r):replacement.suspendBoundary(c,p,id,r),
    finishBoundary:finishRoundBoundary
  };
}
export function advancePreBattle(c,inputs={},options={}){
  const config={decisionId:nextId(c)};
  if(c.decision.kind.startsWith('switch-'))return advancePreBattleSwitch(c,inputs,codec,choiceDriver(options),config);
  if(c.decision.kind==='continuing'&&c.decision.reason==='next-battle')return createPreBattle(c,options);
  if(['wait-actions','wait-target'].includes(c.decision.kind))return advanceCycle(c,inputs,options);
  return advanceQueuedRulePhase(c,codec,preBattleDriver(options),config);
}
export const choosePreBattle=(c,{accept=true,cancel=false}={})=>c.decision.kind==='switch-confirm'
  ?{[c.decision.requiredSeats[0]]:c.decision.options[c.decision.requiredSeats[0]].find(a=>a.accept===accept)}
  :c.decision.kind==='switch-select'?{[c.decision.requiredSeats[0]]:(cancel?c.decision.options[c.decision.requiredSeats[0]].at(-1):c.decision.options[c.decision.requiredSeats[0]][0])}
  :c.decision.kind==='continuing'?{}:chooseCycleInputs(c);
export async function referencePreBattle(c,inputs={},options={}){
  const id=nextId(c);
  if(c.decision.kind.startsWith('switch-')){
    const seat=c.decision.requiredSeats[0];codec.validateAction(c,seat,inputs[seat]);
    const r=await choiceDriver({...options,reference:true}).resumeChoice(c,c.continuation.currentPhase.phase,{seat,kind:c.decision.kind,action:inputs[seat]});
    check(r.completed&&r.pendingTasks===0,'INCOMPLETE_SWITCH_CALLBACK');c.continuation.currentPhase=null;
    c.decision=finishRoundBoundary(c,null,id);codec.capture(c);return {context:c,events:r.events,grants:[]};
  }
  if(['wait-actions','wait-target'].includes(c.decision.kind))return runCycleReference(c,inputs,options);
  const driver=preBattleDriver({...options,reference:true}),resume=!!c.continuation.currentPhase;
  const d=c.continuation.currentPhase||selectNextPhase(c.continuation,()=>check(false,'EMPTY_SWITCH_QUEUE')).phase;
  const r=await(resume?driver.resume(c,d.phase,d.remaining):driver.execute(c,d.phase));
  check((r.completed||r.suspended)&&r.pendingTasks===0,'INCOMPLETE_SWITCH_PHASE');
  if(r.suspended){const stop=driver.suspendBoundary(c,d.phase,id,r);d.remaining=stop.remaining;c.decision=stop.decision;}
  else{c.continuation.currentPhase=null;c.decision=driver.finishBoundary(c,d.phase,id);}
  codec.capture(c);return {context:c,events:r.events,grants:[]};
}
export {nextPostPhase};
