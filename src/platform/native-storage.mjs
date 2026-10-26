import {json,check,createMetaCodec,digest} from '../local-meta/codec.mjs';
import {canonical} from '../battle-core/coop-contract.mjs';
const ready=new WeakMap();
export function nativeStorageBridge(){const b=globalThis.pokerogueDesktop;return b?.storageVersion===1?b:null;}
export async function unwrap(operation){const reply=await operation;check(reply?.ok,reply?.code??'DESKTOP_STORAGE_FAILED');return reply.value;}

async function readDatabase(factory,name,stores){
  if(factory.databases&&!((await factory.databases()).some(db=>db.name===name)))return Object.fromEntries(stores.map(s=>[s,{}]));
  const db=await new Promise((resolve,reject)=>{
    const req=factory.open(name);let absent=false;
    req.onupgradeneeded=()=>{absent=true;req.transaction.abort();};
    req.onerror=()=>absent?resolve(null):reject(req.error);
    req.onblocked=()=>reject(new Error('LOCAL_DATABASE_BLOCKED'));req.onsuccess=()=>resolve(req.result);
  });
  if(!db)return Object.fromEntries(stores.map(s=>[s,{}]));
  try{
    check(db.version===1,'DESKTOP_LEGACY_VERSION');
    check(stores.every(s=>db.objectStoreNames.contains(s)),'DESKTOP_LEGACY_CORRUPT');
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(stores,'readonly'),out=Object.fromEntries(stores.map(s=>[s,{}]));let failure;
      tx.oncomplete=()=>resolve(out);tx.onabort=()=>reject(failure??tx.error);
      for(const name of stores)tx.objectStore(name).openCursor().onsuccess=event=>{
        try{const c=event.target.result;if(c){check(typeof c.key==='string'&&!['__proto__','constructor','prototype'].includes(c.key),'INVALID_STORE_KEYS');out[name][c.key]=json(c.value);c.continue();}}
        catch(error){failure=error;tx.abort();}
      };
    });
  }finally{db.close();}
}
export async function captureDesktopLegacy(factory=globalThis.indexedDB,preferences=globalThis.localStorage){
  const meta=await readDatabase(factory,'pokerogue-local-meta',['records']);
  const play=await readDatabase(factory,'coop-play-v1',['seats','outbox']);
  const legacy=await readDatabase(factory,'pokerogue-early-local',['saves']);
  const device={};for(const key of ['settings','tutorials','prLang','coop-local-hosts-v1','coop-play-auto-resume-paused']){
    const value=preferences?.getItem(key);if(value!==null&&value!==undefined)device[key]=value;
  }
  return {meta:meta.records,seats:play.seats,outbox:play.outbox,legacy:legacy.saves,preferences:device};
}
async function validateMigration(bundle){
  if(Object.keys(bundle.meta).length){
    const {originalSaveCodec}=await import('../local-meta/original-save-codec');
    const codec=createMetaCodec(originalSaveCodec),index=codec.index(bundle.meta.index);
    for(const p of index.profiles){const profile=codec.profile(bundle.meta['profile:'+p.profileId]);check(profile.revision===p.revision&&profile.profileId===p.profileId,'LOCAL_DIRECTORY_MISMATCH');}
  }
  for(const record of Object.values(bundle.legacy)){check(record.schema===1&&typeof record.value==='string','DESKTOP_LEGACY_CORRUPT');JSON.parse(record.value);}
}
export function ensureNativeStorage(bridge=nativeStorageBridge(),options={}){
  check(bridge,'DESKTOP_STORAGE_UNAVAILABLE');
  if(ready.has(bridge))return ready.get(bridge);
  const task=(async()=>{
    if((await unwrap(bridge.storageStatus())).initialized)return;
    const capture=options.capture??captureDesktopLegacy,validate=options.validate??validateMigration;
    const first=await capture();await validate(first);const hash=await digest(first);
    const summary=Object.fromEntries(Object.entries(first).map(([key,value])=>[key,Object.keys(value).length]));
    const approval=await unwrap(bridge.storagePrepare(summary));check(approval.approved,'DESKTOP_MIGRATION_REQUIRED');
    const second=await capture();check(canonical(first)===canonical(second),'DESKTOP_MIGRATION_CHANGED');
    await unwrap(bridge.storageInitialize({bundle:second,digest:hash,ticket:approval.ticket}));
  })();
  ready.set(bridge,task);task.catch(()=>{if(ready.get(bridge)===task)ready.delete(bridge);});return task;
}
// Preserve the repository's synchronous mutation contract without sending JS functions over IPC.
export function createNativeStore(scope,bridge=nativeStorageBridge()){
  const read=async keys=>{await ensureNativeStorage(bridge);return (await unwrap(bridge.storageSnapshot({scope,keys}))).records;};
  return {read,transact:async(keys,mutation)=>{
    await ensureNativeStorage(bridge);
    for(let attempt=0;attempt<8;attempt++){
      const snapshot=await unwrap(bridge.storageSnapshot({scope,keys}));
      const update=mutation(snapshot.records);
      if(update&&typeof update.then==='function')update.catch?.(()=>{});
      check(update&&typeof update==='object'&&!('then' in update),'ASYNC_LOCAL_TRANSACTION');
      check(update.changes&&Object.keys(update.changes).every(k=>keys===null||keys.includes(k)),'UNREAD_LOCAL_WRITE');
      const changes=json(update.changes),result=update.result===undefined?null:json(update.result);
      const reply=await bridge.storageCommit({scope,keys,expectedRevision:snapshot.revision,changes});
      if(reply?.ok)return result;
      if(reply?.code!=='DESKTOP_REVISION_CONFLICT')await unwrap(reply);
    }
    throw new Error('DESKTOP_REVISION_CONFLICT');
  }};
}
