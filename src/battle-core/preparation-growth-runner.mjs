import {canonical,copy,requireContract as check} from './coop-contract.mjs';
import {advanceQueuedRulePhase} from './rule-phase-runner.mjs';
import {advanceProgressionChoice} from './progression-choice-runner.mjs';

// Original move learning can enqueue automatic form changes (e.g. Keldeo).
// Keep them owned and inside the same protected growth queue, not a new choice.
const types=['LevelUpPhase','LearnMovePhase','EvolutionPhase','EndEvolutionPhase','FormChangePhase','QuietFormChangePhase'];
const prefix=seat=>`preparation-growth-${seat}-`;
const nextId=id=>{const m=/^(.*?)(?:~(\d+))?$/.exec(id),n=Number(m[2]??0)+1;
  check(Number.isSafeInteger(n)&&`${m[1]}~${n}`.length<=128,'DECISION_SEQUENCE_EXHAUSTED');return `${m[1]}~${n}`;};

// Re-enter the existing original Phase/choice runners with the shared queue
// still present. Personal suspended Phases return to pendingEffects; they never
// occupy the other player's menu or restart an already suspended Phase.
export async function advancePreparationGrowth(context,seat,action,codec,safe,driver){
  check([0,1].includes(seat)&&context.decision.kind==='preparation','UNSAFE_PREPARATION_GROWTH');
  const preparation=copy(context.decision),row=preparation.players[seat];
  if(row.subdecision!==null)safe.validateAction(context,seat,action);
  else check(action===null,'INVALID_PREPARATION_GROWTH_INPUT');
  const before=codec.capture(context),records=before.pendingEffects.filter(e=>e.id.startsWith(prefix(seat)));
  check(records.length>0&&records.every((e,i)=>e.phase.scope===seat&&types.includes(e.phase.type)
    &&(i===0?['start','learn-apply','evolution-apply','evolution-pause'].includes(e.remaining):e.remaining==='start')),
  'INVALID_PREPARATION_GROWTH');
  check((row.subdecision===null)===(records[0].remaining==='start'),'INVALID_PREPARATION_GROWTH');
  const original=before.continuation;
  check(original.currentPhase===null&&original.standbyPhase===null&&original.phaseQueuePrepend.length===0
    &&original.phaseQueuePrependSpliceIndex===-1,'UNSAFE_PREPARATION_GROWTH');
  let c=codec.restore(before);
  const sharedIds=new Set([...original.phaseQueue,...original.nextCommandPhaseQueue].map(p=>p.phaseId));
  check(sharedIds.size===original.phaseQueue.length+original.nextCommandPhaseQueue.length,'INVALID_PREPARATION_QUEUE');
  const pending=c.pendingEffects.filter(e=>e.id.startsWith(prefix(seat)));
  c.pendingEffects=c.pendingEffects.filter(e=>!e.id.startsWith(prefix(seat)));
  let phaseId=Math.max(-1,...sharedIds)+1;
  const phases=pending.map(p=>({kind:'original-phase',phaseId:phaseId++,phase:p.phase,remaining:p.remaining}));
  c.continuation.phaseQueue.unshift(...phases);
  c.decision=row.subdecision??{id:preparation.id,kind:'continuing',requiredSeats:[],reason:'effects'};
  const events=[],grants=[];
  const accept=r=>{check(r.grants.length===0,'UNSUPPORTED_PREPARATION_GRANT');c=r.context;events.push(...r.events);};
  if(row.subdecision!==null){
    c.continuation.currentPhase=c.continuation.phaseQueue.shift();
    accept(await advanceProgressionChoice(c,{[seat]:action},codec,safe,driver,{decisionId:nextId(preparation.id)}));
  }
  let steps=0;
  while(c.decision.kind==='continuing'){
    const state=c.continuation;
    // LearnMove appends delayed form changes. Resolve this seat's growth
    // before returning to its menu, without executing/reordering shared phases.
    if(!state.phaseQueuePrepend.length&&sharedIds.has(state.phaseQueue[0]?.phaseId)){
      const index=state.phaseQueue.findIndex(p=>!sharedIds.has(p.phaseId));
      if(index>0)state.phaseQueue.unshift(state.phaseQueue.splice(index,1)[0]);
    }
    const next=state.phaseQueuePrepend[0]??state.phaseQueue[0];
    if(!next||sharedIds.has(next.phaseId))break;
    check(++steps<=1000,'PREPARATION_GROWTH_LIMIT');
    const wire=codec.capture(c),record=wire.continuation.phaseQueuePrepend[0]??wire.continuation.phaseQueue[0];
    check(next.remaining==='start'&&record.phase.scope===seat&&types.includes(record.phase.type),'INVALID_PREPARATION_GROWTH');
    accept(await advanceQueuedRulePhase(c,codec,driver,{decisionId:nextId(c.decision.id)}));
  }
  const state=c.continuation,current=state.currentPhase;
  check(state.standbyPhase===null&&(!current||!sharedIds.has(current.phaseId)),'INVALID_PREPARATION_GROWTH');
  const remaining=[...(current?[current]:[]),...state.phaseQueuePrepend,...state.phaseQueue.filter(p=>!sharedIds.has(p.phaseId))];
  state.phaseQueue=state.phaseQueue.filter(p=>sharedIds.has(p.phaseId));state.phaseQueuePrepend=[];
  state.phaseQueuePrependSpliceIndex=-1;state.currentPhase=null;
  check(c.decision.kind==='continuing'||['learn-move','evolution'].includes(c.decision.kind),'INVALID_PREPARATION_GROWTH');
  row.subdecision=c.decision.kind==='continuing'?null:copy(c.decision);
  check((row.subdecision===null)===(remaining.length===0),'INVALID_PREPARATION_GROWTH');
  preparation.id=c.decision.id;row.ready=false;c.decision=preparation;
  c.pendingEffects.push(...remaining.map((p,index)=>({id:`${prefix(seat)}${index}`,phase:p.phase,remaining:p.remaining})));
  const after=codec.capture(c);
  for(const key of ['battle','arena','scene','players','enemyModifiers','components','eggState'])
    check(canonical(after[key]??null)===canonical(before[key]??null),'PREPARATION_GROWTH_CHANGED_SHARED_STATE');
  check(canonical(after.continuation)===canonical(original),'PREPARATION_GROWTH_CHANGED_SHARED_QUEUE');
  check(canonical(after.roster.entries.filter(e=>e.owner!==seat||e.group!=='party'))
    ===canonical(before.roster.entries.filter(e=>e.owner!==seat||e.group!=='party'))
    &&canonical(after.roster.entries.map(({pokemon,...e})=>e))===canonical(before.roster.entries.map(({pokemon,...e})=>e))
    &&canonical(after.roster.field)===canonical(before.roster.field)&&canonical(after.roster.retiredIds)===canonical(before.roster.retiredIds),
  'PREPARATION_GROWTH_CHANGED_PEER');
  const owners=new Map(context.roster.entries.map(e=>[e.pokemon.id,e]));
  const foreignGroups=(s,key)=>s.roster[key].filter(group=>group.some(ref=>{
    const e=owners.get(ref.pokemonId);return !e||e.owner!==seat||e.group!=='party';
  }));
  for(const key of ['ruleGroups','tagGroups'])check(canonical(foreignGroups(after,key))===canonical(foreignGroups(before,key)),
    'PREPARATION_GROWTH_CHANGED_PEER');
  const foreign=ctx=>codec.capture({...ctx,pendingEffects:ctx.pendingEffects.filter(e=>!e.id.startsWith(prefix(seat)))}).pendingEffects;
  check(canonical(foreign(c))===canonical(foreign(context)), 'PREPARATION_GROWTH_CHANGED_PEER');
  check(canonical(preparation.players[1-seat])===canonical(context.decision.players[1-seat]),'PREPARATION_GROWTH_CHANGED_PEER');
  return {context:c,events:copy(events),grants};
}
