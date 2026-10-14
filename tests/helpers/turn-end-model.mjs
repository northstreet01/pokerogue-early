import fs from 'node:fs';
import {codec} from './decision-model.mjs';
import {effectContext,damageRules} from './move-effect-model.mjs';
import {bindAction,compileReference,common} from './move-execution-model.mjs';
import {originalPhases,phaseCodec} from './phase-model.mjs';
import {moves,weather,terrain,battler} from './original-model.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';

const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-turn-end-reference.json',import.meta.url),'utf8'));
const reference=Object.fromEntries(Object.entries(frozen.methods).map(([name,method])=>[name,
  compileReference(method,'',{...damageRules,...originalPhases,Utils:damageRules.Utils,
    ...weather,...terrain})]));

export function cleanupContext(seat=0,{disabledTurns=2,fieldEffects=false}={}){
  const c=effectContext(seat),p=c.roster.entries[seat].pokemon;
  c.arena.tags=[];c.arena.ignoreAbilities=true;
  if(fieldEffects){c.arena.weather=new weather.Weather(1,2);c.arena.terrain=new terrain.Terrain(1,2);}
  p.summonData.disabledMove=moves.Moves.TACKLE;p.summonData.disabledTurns=disabledTurns;
  const tagTypes=common['./enums/battler-tag-type'].BattlerTagType;
  p.summonData.tags=[battler.getBattlerTag(tagTypes.NO_CRIT,1,moves.Moves.TACKLE),
    battler.getBattlerTag(tagTypes.BYPASS_SLEEP,1,moves.Moves.TACKLE)];
  const phases=[new originalPhases.MoveEndPhase({},seat),new originalPhases.TurnEndPhase({})];
  c.continuation.phaseQueue=phases.map((phase,phaseId)=>({kind:'original-phase',phaseId,
    phase:phaseCodec.capture(phase,c,phase.player?phase.fieldIndex:null),remaining:'start'}));
  c.decision.id='cleanup-0';c.battle.randSeedInt(100);return codec.restore(codec.capture(c));
}

export function cleanupDriver(useReference=false,onBind){return {
  supports:(_c,p)=>[originalPhases.MoveEndPhase.prototype,originalPhases.TurnEndPhase.prototype].includes(Object.getPrototypeOf(p)),
  async execute(c,phase){const b=bindAction(c,phase),tasks=createRuleTaskTracker(b.scene);
    try{onBind?.(c,phase,b,tasks);
      if(useReference)reference[phase.constructor.name].call(phase);else phase.start();
      await tasks.drain();return {completed:b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
    }finally{tasks.close();b.dispose();}
  }};
}
export const advanceCleanup=(c,options={})=>advanceQueuedRulePhase(c,codec,cleanupDriver(options.reference,options.onBind),
  {decisionId:`cleanup-${Number(c.decision.id.split('-').at(-1))+1}`});

// Uninterrupted reference retains the same live context between original calls.
export async function runCleanupReference(c){
  const descriptor=selectNextPhase(c.continuation,()=>{throw Error('Empty cleanup queue');}).phase;
  const result=await cleanupDriver(true).execute(c,descriptor.phase);
  if(!result.completed)throw Error('Reference phase did not end');
  c.continuation.currentPhase=null;c.decision.id=`cleanup-${Number(c.decision.id.split('-').at(-1))+1}`;
  codec.capture(c);return {context:c,...result};
}
