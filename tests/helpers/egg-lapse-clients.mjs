import {codec} from './decision-model.mjs';
import {phaseCodec} from './phase-model.mjs';
import {eggCodec} from './egg-model.mjs';
import {copy,requireContract as check} from '../../src/battle-core/coop-contract.mjs';
import {createSnapshotConsumer} from '../../src/battle-core/coop-client.mjs';

const lists=['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'];
// Test client view: original battle models and the recipient's original Eggs /
// hatch Phases are restored. Peer eggs remain public queue positions only;
// IDs (hatch seeds), machines, timestamps and counters never enter shared data.
export function projectEggSnapshot(model,seat){
  const client=model.eggView!==undefined,c=client?model.context:model;
  const ownResources=c.players[seat],raw=codec.capture({...c,players:c.players.map(()=>({money:0,pokeballCounts:{0:0,1:0,2:0,3:0,4:0},modifiers:[]}))});
  const full=codec.capture(c),resources={money:ownResources.money,pokeballCounts:copy(ownResources.pokeballCounts),
    modifiers:full.players[seat].modifiers.map(index=>full.components[index].state)};
  // A v6 model has no egg inventory. Keep that absence through the client
  // projection and restoration instead of upgrading it to an empty v7 model.
  if(raw.version===6){
    check(!client,'INVALID_EGG_VIEW_VERSION');
    return {shared:{battle:raw},personal:{resources}};
  }
  const eggState=raw.eggState;delete raw.eggState;raw.version=6;
  const counts=client?[...model.eggView.counts]:eggState.players.map(row=>row.length);counts[seat]=c.eggState.players[seat].length;
  const hatches=[];
  const hatchView=(descriptor,phase)=>{
    const saved=phase??descriptor.phase;
    check(['start','hatch-commit'].includes(descriptor.remaining),'UNSUPPORTED_HATCH_VIEW_STAGE');
    const ref=saved.fields.egg.value,index=c.eggState.players[ref.seat].findIndex(egg=>egg.id===ref.id);
    check(index>=0,'UNKNOWN_PHASE_EGG');
    if(ref.seat===seat)hatches.push({phaseId:descriptor.phaseId,phase:copy(saved)});
    return {kind:'owned-egg-hatch',phaseId:descriptor.phaseId,seat:ref.seat,index,remaining:descriptor.remaining};
  };
  for(const key of lists){
    if(client){let normal=0;raw.continuation[key]=model.eggView.templates[key].map(entry=>{
      if(entry===null)return raw.continuation[key][normal++];
      if(entry.seat!==seat)return copy(entry);
      const owned=model.eggView.owned.get(entry.phaseId);check(owned,'MISSING_OWNED_HATCH');
      return hatchView({phaseId:entry.phaseId,remaining:entry.remaining},phaseCodec.capture(owned,c));
    });}
    else raw.continuation[key]=raw.continuation[key].map(d=>d.phase?.type==='EggHatchPhase'?hatchView(d):d);
  }
  for(const key of ['currentPhase','standbyPhase']){
    const entry=client?model.eggView.templates[key]:raw.continuation[key];
    if(entry?.kind==='owned-egg-hatch'){
      raw.continuation[key]=entry.seat===seat?hatchView(entry,phaseCodec.capture(model.eggView.owned.get(entry.phaseId),c)):copy(entry);
    }else if(entry?.phase?.type==='EggHatchPhase')raw.continuation[key]=hatchView(entry);
  }
  check(!raw.pendingEffects.some(p=>p.phase.type==='EggHatchPhase'),'UNSUPPORTED_HATCH_VIEW_STAGE');
  // Match the existing personal modifier projection, independent from the
  // empty resource rows in the shared view.
  return {shared:{battle:raw,eggCounts:counts},personal:{resources,eggs:eggCodec.capture(c.eggState).players[seat],hatches}};
}
export function restoreEggView(snapshot){
  const seat=snapshot.seat,raw=copy(snapshot.shared.battle),templates={},owned=new Map(),records=[];
  const withEggs=Object.hasOwn(snapshot.shared,'eggCounts');
  check(raw.version===6&&!Object.hasOwn(raw,'eggState')
    &&withEggs===Object.hasOwn(snapshot.personal,'eggs')&&withEggs===Object.hasOwn(snapshot.personal,'hatches'),
    'INVALID_EGG_VIEW_VERSION');
  for(const key of lists){templates[key]=raw.continuation[key].map(d=>d.kind==='owned-egg-hatch'?copy(d):null);
    records.push(...raw.continuation[key].filter(d=>d.kind==='owned-egg-hatch'));
    raw.continuation[key]=raw.continuation[key].filter(d=>d.kind!=='owned-egg-hatch');}
  for(const key of ['currentPhase','standbyPhase']){
    const entry=raw.continuation[key];templates[key]=entry?.kind==='owned-egg-hatch'?copy(entry):null;
    if(templates[key]){records.push(entry);raw.continuation[key]=null;}
  }
  const r=snapshot.personal.resources;
  raw.players[seat]={money:r.money,pokeballCounts:copy(r.pokeballCounts),modifiers:r.modifiers.map(state=>{
    const index=raw.components.length;raw.components.push({kind:'modifier',state:copy(state)});return index;
  })};
  if(!withEggs){check(records.length===0,'INVALID_EGG_VIEW_VERSION');return codec.restore(raw);}
  const context=codec.restore(raw),rows=[[],[]];rows[seat]=copy(snapshot.personal.eggs);context.eggState=eggCodec.restore({players:rows});
  for(const record of records)if(record.seat===seat){
    const egg=context.eggState.players[seat][record.index];check(egg,'UNKNOWN_PERSONAL_EGG');
    const saved=snapshot.personal.hatches.find(d=>d.phaseId===record.phaseId)?.phase;
    check(saved?.scope===seat&&saved.fields.egg.value.id===egg.id,'INVALID_PERSONAL_HATCH');
    const phase=phaseCodec.restore(saved,context);
    if(owned.has(record.phaseId))check(owned.get(record.phaseId).egg===egg,'CONFLICTING_PHASE_ID');else owned.set(record.phaseId,phase);
  }
  return {context,eggView:{templates,counts:copy(snapshot.shared.eggCounts),owned}};
}
export async function eggClients(f,adapter,identities){
  const pair=[];
  for(const seat of [0,1]){
    const c=await f.client();pair.push(c);c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}
      :seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',name:'B',roomId:pair[0].identity.roomId});
    c.identity=await c.wait(m=>m.type==='welcome');c.acks=[];
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.acks.push(m),adapter:{
      applySnapshot:s=>{c.model=restoreEggView(s);},captureAppliedState:()=>adapter.projectSnapshot(c.model,seat),
      async applyGrantsTransaction(g){check(g.length===0,'UNSUPPORTED_PERMANENT_GRANT');}
    }});
  }
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot');await c.consume(c.snapshot);}return pair;
}
