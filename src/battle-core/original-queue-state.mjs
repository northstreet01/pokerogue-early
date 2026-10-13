import { canonical, copy, requireContract as check } from './coop-contract.mjs';
import { restoreContinuation } from './phase-continuation.mjs';

const arrays=['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'];
const scalars=['currentPhase','standbyPhase'];
// Adapters supply the current logical boundary, not an animation position.
// Each actual Phase gets a stable table identity, preserving repeated references
// without serializing methods, constructors, scene objects or UI callbacks.
export function createOriginalQueueStateCodec(phases) {
  function capture(state,context,{scopeForPhase,remainingForPhase}) {
    check(typeof scopeForPhase==='function'&&typeof remainingForPhase==='function','PHASE_BOUNDARY_ADAPTER_UNAVAILABLE');
    const ids=new Map();
    const graph=phases.createGraph();
    const encode=(phase,current)=>{
      if(phase===null)return null;
      if(!ids.has(phase))ids.set(phase,ids.size);
      const remaining=current?remainingForPhase(phase):'start';
      check(typeof remaining==='string','UNSAFE_PHASE_BOUNDARY');
      return {kind:'original-phase',phaseId:ids.get(phase),phase:phases.capture(phase,context,scopeForPhase(phase),graph),remaining};
    };
    const result={};
    for(const key of scalars)result[key]=encode(state[key],true);
    for(const key of arrays){check(Array.isArray(state[key]),'INVALID_CONTINUATION');result[key]=state[key].map(p=>encode(p,false));}
    result.phaseQueuePrependSpliceIndex=state.phaseQueuePrependSpliceIndex;
    restore(result,context);return result;
  }
  function restore(input,context,sceneForScope) {
    const identities=new Map(),snapshots=new Map();
    const encodeGraph=phases.createGraph(),decodeGraph=phases.createGraph();
    const pack=d=>d&&phases.isPhase(d.phase)?{...d,phase:phases.capture(d.phase,context,undefined,encodeGraph)}:d;
    const packed={...input,phaseQueue:input.phaseQueue.map(pack),phaseQueuePrepend:input.phaseQueuePrepend.map(pack),nextCommandPhaseQueue:input.nextCommandPhaseQueue.map(pack),currentPhase:pack(input.currentPhase),standbyPhase:pack(input.standbyPhase)};
    const state=restoreContinuation(packed,context.roster,s=>phases.restore(s,context));
    const decode=d=>{
      if(d===null)return null;check(d.kind==='original-phase','INVALID_ORIGINAL_PHASE_QUEUE');
      const content=canonical(d.phase);
      if(identities.has(d.phaseId)){check(snapshots.get(d.phaseId)===content,'CONFLICTING_PHASE_ID');return identities.get(d.phaseId);}
      const phase=phases.restore(d.phase,context,sceneForScope,decodeGraph);identities.set(d.phaseId,phase);snapshots.set(d.phaseId,content);return phase;
    };
    const result={phaseQueuePrependSpliceIndex:state.phaseQueuePrependSpliceIndex};
    for(const key of scalars)result[key]=decode(state[key]);
    for(const key of arrays)result[key]=state[key].map(decode);
    return {state:result,boundaries:copy(state)};
  }
  return Object.freeze({capture,restore});
}
