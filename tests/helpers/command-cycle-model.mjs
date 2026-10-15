import fs from 'node:fs';
import ts from 'typescript';
import {codec} from './decision-model.mjs';
import {parse,evaluate,moves,pokemon} from './original-model.mjs';
import {originalPhases,installPhaseTestDependencies} from './phase-model.mjs';
import {damageRules} from './move-effect-model.mjs';
import {bindAction,compileReference,moveRules} from './move-execution-model.mjs';
import {roundContext,roundDriver,finishRoundBoundary,resolveRoundFight,roundFightOptions} from './round-loop-model.mjs';
import {nextPostPhase,BattleSpec} from './post-damage-model.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {advanceCollectedFightCommands,selectFightCommand} from '../../src/battle-core/fight-command.mjs';
import {prepareQueuedFight,selectEncoreFight} from '../../src/battle-core/forced-command.mjs';
import {selectEnemyCommand} from '../../src/battle-core/enemy-command.mjs';
import {applyTargetSelection,createTargetDecision,resolveTargetIntent} from '../../src/battle-core/target-command.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {copy,requireContract as check} from '../../src/battle-core/coop-contract.mjs';

const enumOf=(file,name)=>evaluate(parse(file).statements.filter(n=>n.name?.text===name).map(n=>n.getText()).join('\n'))[name];
const Command=enumOf('ui/command-ui-handler.ts','Command'),Mode=enumOf('ui/ui.ts','Mode');
installPhaseTestDependencies({'./ui/ui':{Mode},'./battle-core/forced-command.mjs':{prepareQueuedFight,selectEncoreFight},
  './battle-core/fight-command.mjs':{selectFightCommand},'./battle-core/target-command.mjs':{applyTargetSelection},
  './battle-core/enemy-command.mjs':{selectEnemyCommand}});
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-command-cycle-reference.json',import.meta.url),'utf8'));
const reference=Object.fromEntries(Object.entries(frozen.methods).map(([name,methods])=>[name,
  Object.fromEntries(Object.entries(methods).map(([method,body])=>[method,
    compileReference(body.replaceAll('super.end()','this.scene.shiftPhase()').replaceAll('allyCommand.command','allyCommand?.command'),
      method==='handleCommand'?'command,cursor,...args':'',
      {...damageRules,...originalPhases,Command,Mode,prepareQueuedFight,selectEncoreFight,selectFightCommand,
        applyTargetSelection,selectEnemyCommand,getMoveTargets:moveRules.getMoveTargets})]))]));
const referencePokemon=Object.fromEntries(Object.entries(frozen.pokemonMethods).map(([name,body])=>[name,
  compileReference(body,name==='getNextTargets'?'moveId':'',damageRules)]));
// Independent pre-extraction target callback. TurnCommand is the original
// captured data binding; resumption never calls SelectTargetPhase.start again.
const oldTarget=JSON.parse(fs.readFileSync(new URL('../fixtures/early-target-command-reference.json',import.meta.url),'utf8'));
const targetAst=ts.createSourceFile('target-reference.ts',oldTarget.source,ts.ScriptTarget.Latest,true);
let targetCallback;
function findTargetCallback(node){if(ts.isArrowFunction(node)&&node.parameters[0]?.name.getText(targetAst)==='cursor')targetCallback=node;
  ts.forEachChild(node,findTargetCallback);}
findTargetCallback(targetAst);
const referenceTargetResume=compileReference(`resume(cursor,turnCommand) ${targetCallback.body.getText(targetAst)}`,
  'cursor,turnCommand',{...originalPhases,Command,Mode});
const playerPhase=p=>!!p&&[originalPhases.CommandPhase.prototype,originalPhases.SelectTargetPhase.prototype].includes(Object.getPrototypeOf(p));

// Execute the real Command/Target/Enemy phase, substituting only the UI boundary
// with already validated intents. Native Command.end's Promise is retained.
export function commandPhaseDriver({reference:useReference=false,inputs={},onBind,allowSuspend=false}={}){
const consumed=new Set(),targeted=new Set();return {
  supports:(_c,p)=>playerPhase(p)||Object.getPrototypeOf(p)===originalPhases.EnemyCommandPhase.prototype,
  async execute(c,p,{resume=false}={}){const b=bindAction(c,p),tasks=createRuleTaskTracker(b.scene),patched=[],used=[];let waiting=null;
    const patch=(object,name,fn)=>{patched.push([object,name,Object.getOwnPropertyDescriptor(object,name)]);
      Object.defineProperty(object,name,{value:fn,configurable:true});};
    try{
      b.scene.ui={setMode(mode,seat,_move,callback){
        if(mode===Mode.COMMAND){if(!p.checkFightOverride()){
          const action=inputs[seat];
          if(action?.kind==='fight'&&!consumed.has(seat)){
            consumed.add(seat);used.push(seat);check(p.handleCommand(Command.FIGHT,action.cursor,false),'ORIGINAL_COMMAND_REJECTED');
          }else{check(allowSuspend,'COMMAND_INPUT_UNAVAILABLE');waiting='wait-actions';}}
        }else if(mode===Mode.TARGET_SELECT){const action=inputs[seat];
          if(action?.kind==='fight'&&Number.isInteger(action.target)&&!targeted.has(seat)){
            targeted.add(seat);callback(action.target);
          }else{check(allowSuspend,'TARGET_INPUT_UNAVAILABLE');waiting='wait-target';}
        }else check(mode===Mode.MESSAGE,'UNSUPPORTED_COMMAND_UI');
        const result=Promise.resolve();tasks.add(result);return result;
      }};
      if(useReference){for(const [name,fn]of Object.entries(reference[p.constructor.name]))patch(p,name,fn);
        if(p.constructor===originalPhases.EnemyCommandPhase){const enemy=b.scene.getEnemyField()[p.fieldIndex];
          for(const [name,fn]of Object.entries(referencePokemon))patch(enemy,name,fn);}}
      onBind?.(c,p,b,tasks,{resume});
      if(!resume)p.start();
      else if(p.constructor===originalPhases.CommandPhase){const seat=p.fieldIndex,action=inputs[seat];
        check(action?.kind==='fight'&&!consumed.has(seat),'COMMAND_INPUT_UNAVAILABLE');
        consumed.add(seat);used.push(seat);check(p.handleCommand(Command.FIGHT,action.cursor,false),'ORIGINAL_COMMAND_REJECTED');
      }else{check(p.constructor===originalPhases.SelectTargetPhase,'UNSUPPORTED_COMMAND_RESUME');
        const seat=p.fieldIndex,action=inputs[seat];check(action?.kind==='target','TARGET_INPUT_UNAVAILABLE');
        consumed.add(seat);targeted.add(seat);used.push(seat);
        if(useReference)referenceTargetResume.call(p,action.target,c.battle.turnCommands[seat]);
        else{b.scene.ui.setMode(Mode.MESSAGE);
          applyTargetSelection(c.battle.turnCommands,seat,action.target,{ballCommand:Command.BALL,
            requeueCommand:index=>b.scene.unshiftPhase(new originalPhases.CommandPhase(b.scene,index))});p.end();}
      }
      await tasks.drain();await Promise.resolve();
      if(p.constructor===originalPhases.EnemyCommandPhase){
        // Native getNextMove returns a data literal in the test VM. Rehome only
        // that plain record, preserving its targets/queue references. Production
        // and the strict command codec do not have or permit cross-realm data.
        const move=c.battle.turnCommands[p.fieldIndex+2].move;
        if(move){check(Object.getPrototypeOf(move)?.constructor.name==='Object','INVALID_VM_QUEUED_MOVE');Object.setPrototypeOf(move,Object.prototype);}
      }
      return {completed:b.ended,suspended:!b.ended&&waiting!==null,pendingTasks:tasks.pendingTasks,events:b.events,grants:[],used};
    }finally{for(const [object,name,descriptor]of patched.reverse()){
      if(descriptor)Object.defineProperty(object,name,descriptor);else delete object[name];}tasks.close();b.dispose();}
  }
};}

function suspendCommand(c,phase,id){
  if(phase.constructor===originalPhases.CommandPhase){const seat=phase.fieldIndex;
    return {remaining:'wait-actions',decision:{id,kind:'wait-actions',requiredSeats:[seat],options:{[seat]:roundFightOptions(c,seat)}}};
  }
  check(phase.constructor===originalPhases.SelectTargetPhase,'UNSUPPORTED_COMMAND_SUSPENSION');
  const b=bindAction(c,phase);
  try{return {remaining:'wait-target',decision:createTargetDecision(id,c,phase.fieldIndex,moveRules.getMoveTargets)};}
  finally{b.dispose();}
}
export function validateCycleInput(c,seat,action){
  if(c.decision.kind!=='wait-target')return resolveRoundFight(c,seat,action);
  const b=bindAction(c,c.continuation.currentPhase.phase);
  try{return resolveTargetIntent(c,seat,action,moveRules.getMoveTargets);}finally{b.dispose();}
}

export function collectedCommandDriver(options={}){return {
  validateInput:validateCycleInput,
  async executeCollected(c,inputs){const driver=commandPhaseDriver({...options,inputs}),events=[],used=[];
    let steps=0;
    // Select the original queue; never sort seats by input arrival or hand-build
    // commands. Original SelectTarget insertions are drained before the next seat.
    while(c.continuation.currentPhase||playerPhase(nextPostPhase(c))){
      check(++steps<=8,'COMMAND_PHASE_LIMIT');
      const current=c.continuation.currentPhase,descriptor=current||selectNextPhase(c.continuation,()=>check(false,'COMMAND_QUEUE_EMPTY')).phase;
      check(descriptor.kind==='original-phase'&&(current?['wait-actions','wait-target'].includes(descriptor.remaining):descriptor.remaining==='start'),'UNSAFE_COMMAND_PHASE');
      const result=await driver.execute(c,descriptor.phase,{resume:!!current});
      check((result.completed||result.suspended)&&result.pendingTasks===0&&c.continuation.currentPhase===descriptor,'INCOMPLETE_COMMAND_PHASES');
      events.push(...result.events);used.push(...result.used);
      if(result.suspended){const stop=suspendCommand(c,descriptor.phase,c.decision.id);descriptor.remaining=stop.remaining;c.decision=stop.decision;
        check(JSON.stringify(used.sort())===JSON.stringify(Object.keys(inputs).map(Number).sort()),'UNCONSUMED_COMMAND_INPUTS');
        return {completed:true,suspended:true,pendingTasks:0,events,grants:[]};}
      c.continuation.currentPhase=null;
    }
    check(JSON.stringify(used.sort())===JSON.stringify(Object.keys(inputs).map(Number).sort()),'UNCONSUMED_COMMAND_INPUTS');
    check(Object.keys(inputs).every(seat=>c.battle.turnCommands[seat]?.command===Command.FIGHT),'INVALID_COMMAND_RESULT');
    check(nextPostPhase(c)?.constructor===originalPhases.EnemyCommandPhase,'UNSUPPORTED_COMMAND_CONTINUATION');
    return {completed:true,pendingTasks:0,events,grants:[]};
  }
};}

function finishCycleBoundary(c,p,id,serial=false){
  if(serial)return finishSerialBoundary(c,p,id);
  const next=nextPostPhase(c);
  if(next?.constructor===originalPhases.CommandPhase){
    const owner=next.fieldIndex,actor=c.roster.entries.find(e=>e.pokemon.id===c.roster.field[owner]).pokemon;
    // This original helper may discard unusable queue heads, on the candidate
    // only. A valid forced head stays queued until the original move executes.
    if(prepareQueuedFight(actor)||selectEncoreFight(actor,pokemon=>pokemon.getTag(damageRules.EncoreTag)))
      return {id,kind:'continuing',requiredSeats:[],reason:'effects'};
    for(const seat of [0,1].filter(seat=>seat>owner&&c.battle.turnCommands[seat]===null)){
      const later=c.roster.entries.find(e=>e.pokemon.id===c.roster.field[seat]).pokemon;
      check(!prepareQueuedFight(later)&&!selectEncoreFight(later,pokemon=>pokemon.getTag(damageRules.EncoreTag)),
        'UNSUPPORTED_MIXED_FORCED_ORDER');
    }
  }
  return finishRoundBoundary(c,p,id);
}
function finishSerialBoundary(c,p,id){
  // Populate via the already verified original queue helper, without opening
  // its old batched menu. Actual Command.start determines whether input is needed.
  const next=nextPostPhase(c);
  if(!next){finishRoundBoundary(c,p,id);}
  return {id,kind:'continuing',requiredSeats:[],reason:'effects'};
}
export function cycleDriver(options={}){const round=roundDriver(options),commands=commandPhaseDriver(options);return {
  supports:(c,p)=>c.battle.battleSpec===BattleSpec.DEFAULT&&(round.supports(c,p)||commands.supports(c,p)),
  execute:(c,p)=>commands.supports(c,p)?commands.execute(c,p):round.execute(c,p),
  finishBoundary:(c,p,id)=>finishCycleBoundary(c,p,id,options.allowSuspend),
  suspendBoundary:suspendCommand
};}
const nextId=c=>`cycle-${Number(c.decision.id.split('-').at(-1))+1}`;
export const advanceCycle=(c,inputs={},options={})=>['wait-actions','wait-target'].includes(c.decision.kind)
  ?advanceCollectedFightCommands(c,inputs,codec,collectedCommandDriver(options),{decisionId:nextId(c)})
  :advanceQueuedRulePhase(c,codec,cycleDriver(options),{decisionId:nextId(c)});

export async function runCycleReference(c,inputs={},options={}){const id=nextId(c);let result;
  if(['wait-actions','wait-target'].includes(c.decision.kind)){
    for(const seat of c.decision.requiredSeats){codec.validateAction(c,seat,inputs[seat]);validateCycleInput(c,seat,inputs[seat]);}
    c.decision={id,kind:'continuing',requiredSeats:[],reason:'effects'};
    result=await collectedCommandDriver({...options,reference:true}).executeCollected(c,copy(inputs));
  }else{
    const driver=cycleDriver({...options,reference:true}),descriptor=selectNextPhase(c.continuation,()=>check(false,'COMMAND_QUEUE_EMPTY')).phase;
    check(driver.supports(c,descriptor.phase),'UNSUPPORTED_RULE_PHASE');result=await driver.execute(c,descriptor.phase);
    check((result.completed||result.suspended)&&result.pendingTasks===0,'INCOMPLETE_RULE_PHASE');
    if(result.suspended){const stop=driver.suspendBoundary(c,descriptor.phase,id);descriptor.remaining=stop.remaining;c.decision=stop.decision;}
    else{c.continuation.currentPhase=null;c.decision=driver.finishBoundary(c,descriptor.phase,id);}
  }
  codec.capture(c);return {context:c,events:result.events,grants:result.grants};
}
export async function cycleContext(options={}){let c=roundContext(options);
  while(c.decision.kind==='continuing')c=(await advanceCycle(c)).context;
  return c;
}
export const chooseCycleInputs=c=>Object.fromEntries(c.decision.requiredSeats.map(seat=>[seat,
  c.decision.options[seat].find(a=>a.target===2)||c.decision.options[seat][0]]));
