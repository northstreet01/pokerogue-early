import {copy} from './coop-contract.mjs';

// Checkpoints may retain original presentation metadata needed when rebuilding
// a queued Phase. It must not enter the shared rule digest (or depend on locale).
export function checkpointRuleProjection(checkpoint) {
  const state=copy(checkpoint);
  const visit=v=>{
    if(!v||typeof v!=='object')return;
    if(v.version===1&&typeof v.type==='string'&&Object.hasOwn(v,'presentation'))v.presentation={};
    if(v.type==='Trainer'&&Object.hasOwn(v,'configId')){v.name={presence:'absent'};v.partnerName={presence:'absent'};}
    for(const child of Object.values(v))visit(child);
  };
  visit(state);return state;
}
