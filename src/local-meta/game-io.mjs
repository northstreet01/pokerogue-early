import {check, digest, exact, id, json} from './codec.mjs';

/** One immutable profile binding per game instance; no global mutable save key. */
export async function openGameProfileIO(repository, profileId, {mode='solo',readOnly=false,owner=globalThis.crypto.randomUUID(),onLost=()=>{}}={}) {
  let profile=await repository.read(profileId), accepting=true,alive=true,queue=Promise.resolve(),clearSlot=null,writeFailure=null;
  if(mode==='solo'&&!readOnly) {
    check(profile.soloRuns.every(r=>r.ownership==='confirmed'),'LOCAL_SOLO_OWNERSHIP_REQUIRED');
    // Do not let the original solo EggLapse consume a cooperative reserved egg.
    check(profile.deferredHatches.length===0,'LOCAL_EGGS_RESERVED');
  }
  const lease=readOnly?null:await repository.acquire(profileId,owner);
  let timer;
  const assertAlive=()=>check(alive,'LOCAL_PROFILE_CLOSED');
  const lose=error=>{if(alive){alive=false;accepting=false;clearInterval(timer);onLost(error);}};
  if(lease) {timer=setInterval(()=>{
    queue=queue.then(async()=>{assertAlive();await repository.renew(profileId,lease);}).catch(lose);
  },10000);timer.unref?.();}
  function enqueue(mutation) {
    check(accepting&&!readOnly,'LOCAL_PROFILE_CLOSED');
    const work=queue.then(async()=>{
      assertAlive();
      const next=await repository.save(profileId,profile.revision,lease,p=>{assertAlive();return mutation(p);});
      assertAlive();profile=next;writeFailure=null;return next;
    });
    queue=work.catch(error=>{writeFailure=error;});return work;
  }
  function setSession(p,slot,session) {
    check([0,1,2].includes(slot),'INVALID_LOCAL_SLOT');
    const existing=p.soloRuns.find(r=>r.legacySlot===slot);
    check(!existing||existing.ownership==='confirmed','LOCAL_SOLO_OWNERSHIP_REQUIRED');
    const run={runId:existing?.runId??globalThis.crypto.randomUUID(),profileId,legacySlot:slot,
      ownership:'confirmed',originalSession:session,grantCursor:existing?.grantCursor??[]};
    p.soloRuns=[...p.soloRuns.filter(r=>r.legacySlot!==slot),run];
  }
  const system=value=>typeof value==='string'?JSON.parse(value):json(value);
  // Caller must first authenticate and durably bind the seat; hashing a supplied
  // token here only detects later changes, it does not authenticate a host.
  // Stage original-rule effects outside IDB, then commit system and receipts
  // together under this profile's existing writer lease and CAS.
  function applyCoopGrants(grants, binding, apply) {
    check(accepting && !readOnly && mode === 'coop','LOCAL_COOP_WRITER_REQUIRED');
    check(Array.isArray(grants) && grants.length > 0 && grants.length <= 1000 && typeof apply === 'function','INVALID_COOP_GRANTS');
    exact(binding,['hostId','runId','roomId','seat','profileId','token','isCurrent']);
    check(id(binding.hostId) && id(binding.runId) && /^[A-Z0-9]{6}$/.test(binding.roomId)
      && [0,1].includes(binding.seat) && binding.profileId === profileId
      && typeof binding.token === 'string' && binding.token.length > 0 && binding.token.length <= 256
      && typeof binding.isCurrent === 'function','INVALID_COOP_BINDING');
    binding={...binding};
    const requested=json(grants);
    const work=queue.then(async()=>{
      const current=()=>{assertAlive();check(binding.isCurrent(),'COOP_BINDING_EXPIRED');};
      current();
      const pending=[],seen=new Set();
      for(const grant of requested) {
        exact(grant,['id','seat','payload']);
        check(typeof grant.id==='string' && /^[a-zA-Z0-9_:-]{1,128}$/.test(grant.id)
          && grant.seat===binding.seat && grant.payload && typeof grant.payload==='object'
          && !Array.isArray(grant.payload),'INVALID_COOP_GRANT');
        const key='coop:'+await digest({hostId:binding.hostId,runId:binding.runId,seat:binding.seat,id:grant.id});
        const payloadHash=await digest({hostId:binding.hostId,runId:binding.runId,roomId:binding.roomId,
          seat:binding.seat,profileId,token:binding.token,grant});
        check(!seen.has(key),'DUPLICATE_COOP_GRANT');seen.add(key);
        const old=profile.grantLedger.find(entry=>entry.id===key);
        if(old){check(old.payloadHash===payloadHash && old.sourceRunId===binding.runId,'COOP_GRANT_CONFLICT');continue;}
        pending.push({grant,key,payloadHash});
      }
      current();
      if(!pending.length)return json(profile.originalSystem);
      const proposed=await apply(json(profile.originalSystem),pending.map(item=>item.grant));
      current();
      check(proposed && Array.isArray(proposed.kinds) && proposed.kinds.length===pending.length
        && proposed.kinds.every(kind=>['seen','caught','ivs','evolution','voucher','completion'].includes(kind)),
        'INVALID_COOP_GRANT_RESULT');
      const nextSystem=system(proposed.system);
      // This phase handles permanent results only. Egg progress and hatching
      // have separate ownership/terminal rules and cannot be overwritten here.
      check(JSON.stringify(nextSystem.eggs)===JSON.stringify(profile.originalSystem.eggs),'COOP_EGG_INVENTORY_CHANGED');
      let next;
      try {
        next=await repository.save(profileId,profile.revision,lease,p=>{
          current();
          p.originalSystem=nextSystem;
          pending.forEach((item,index)=>p.grantLedger.push({id:item.key,sourceRunId:binding.runId,
            ownerProfileId:profileId,kind:proposed.kinds[index],payloadHash:item.payloadHash,revision:p.revision+1}));
          return p;
        });
      } catch(error) { writeFailure=error;throw error; }
      assertAlive();profile=next;writeFailure=null;return json(next.originalSystem);
    });
    queue=work.catch(()=>{});return work;
  }
  return Object.freeze({profileId,mode,
    get displayName(){return profile.displayName;},get profile(){return json(profile);},
    applyCoopGrants,
    async read(key){assertAlive();if(key==='data')return JSON.stringify(profile.originalSystem);
      const m=/^sessionData([12])?$/.exec(key);check(m,'UNSUPPORTED_PROFILE_KEY');
      const run=profile.soloRuns.find(r=>r.legacySlot===Number(m[1]??0));return run?JSON.stringify(run.originalSession):null;},
    writeSystem(value,expected) {
      return enqueue(p=>{if(expected!==undefined&&expected!==null)check(JSON.stringify(p.originalSystem)===JSON.stringify(json(JSON.parse(expected))),'LOCAL_REVISION_CONFLICT');
        p.originalSystem=system(value);
        if(clearSlot!==null)p.soloRuns=p.soloRuns.filter(r=>r.legacySlot!==clearSlot);
        return p;
      }).then(next=>{clearSlot=null;return JSON.stringify(next.originalSystem);});
    },
    saveAdventure(systemData,sessionData,slot) {
      check(mode==='solo','LOCAL_COOP_SESSION_FORBIDDEN');
      return enqueue(p=>{p.originalSystem=system(systemData);setSession(p,slot,system(sessionData));return p;});
    },
    deleteSession(slot){check(mode==='solo','LOCAL_COOP_SESSION_FORBIDDEN');check([0,1,2].includes(slot),'INVALID_LOCAL_SLOT');return enqueue(p=>{p.soloRuns=p.soloRuns.filter(r=>r.legacySlot!==slot);return p;});},
    async beginClear(slot){await queue;assertAlive();check(mode==='solo'&&!readOnly,'LOCAL_COOP_SESSION_FORBIDDEN');
      const exists=profile.soloRuns.some(r=>r.legacySlot===slot);if(exists)clearSlot=slot;return [true,exists];},
    async close(){if(!alive){if(lease)await repository.release(profileId,lease);return;}
      accepting=false;await queue;if(writeFailure){accepting=true;throw writeFailure;}
      clearInterval(timer);alive=false;if(lease)await repository.release(profileId,lease);},
    invalidate(){accepting=false;alive=false;clearInterval(timer);if(lease)void repository.release(profileId,lease).catch(()=>{});},
  });
}
