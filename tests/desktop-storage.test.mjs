import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createRequire,isBuiltin} from 'node:module';
import {build} from 'vite';
import {IDBFactory} from 'fake-indexeddb';
import {openDesktopStorage,STORAGE_SCOPES,bundleDigest} from '../desktop/storage.mjs';
import {createNativeStore,ensureNativeStorage,captureDesktopLegacy} from '../src/platform/native-storage.mjs';
import {createNativePlayStorage} from '../src/coop/native-play-storage.mjs';
import {createProfileRepository} from '../src/local-meta/repository.mjs';
import {createMetaCodec} from '../src/local-meta/codec.mjs';
import {deviceStorage} from '../src/platform/preferences.mjs';
const empty=()=>Object.fromEntries(STORAGE_SCOPES.map(s=>[s,{}]));
const root=resolve('build/desktop-storage/tests');mkdirSync(root,{recursive:true});
const directory=()=>mkdtempSync(join(root,'run-'));
const wrap=operation=>{try{return {ok:true,value:operation()};}catch(e){return {ok:false,code:e.code??e.message};}};
function bridgeFor(db,{approve=true}={}){
  return {storageVersion:1,storageStatus:()=>wrap(()=>db.status()),storagePrepare:()=>({ok:true,value:{approved:approve,ticket:'test'}}),
    storageInitialize:r=>wrap(()=>db.initialize(r.bundle,r.digest)),storageSnapshot:r=>wrap(()=>db.snapshot(r.scope,r.keys)),storageCommit:r=>wrap(()=>db.commit(r)),
    preference:r=>wrap(()=>{if(!db.status().initialized)return {initialized:false};const snap=db.snapshot('preferences',[r.key]);
      if(r.action!=='get')db.commit({scope:'preferences',keys:[r.key],expectedRevision:snap.revision,changes:{[r.key]:r.action==='delete'?null:r.value}});
      return {initialized:true,value:snap.records[r.key]};})};
}
function setup(options){const dir=directory(),db=openDesktopStorage(dir,options),bundle=empty();db.initialize(bundle,bundleDigest(bundle));return {dir,db,bridge:bridgeFor(db)};}
function commit(db,scope,changes){const snap=db.snapshot(scope,Object.keys(changes));return db.commit({scope,keys:Object.keys(changes),expectedRevision:snap.revision,changes});}

test('SQLite keeps all rows atomic, rejects stale CAS and persists across reopen',async()=>{
  const e=setup();let db=e.db;
  const port=createNativeStore('meta',e.bridge);
  await port.transact(['collection','ledger'],()=>({changes:{collection:{n:1},ledger:{n:1}}}));
  const old=db.snapshot('meta',['collection','ledger']);commit(db,'preferences',{settings:'{"volume":2}'});
  assert.throws(()=>db.commit({scope:'meta',keys:['collection'],expectedRevision:old.revision,changes:{collection:{n:99}}}),/DESKTOP_REVISION_CONFLICT/);
  await assert.rejects(port.transact(['collection'],()=>({changes:{ledger:{n:3}}})),/UNREAD_LOCAL_WRITE/);
  await assert.rejects(port.transact(['collection'],async()=>{throw Error('rejected async');}),/ASYNC_LOCAL_TRANSACTION/);
  db.close();db=openDesktopStorage(e.dir);
  try{assert.deepEqual(db.snapshot('meta',['collection','ledger']).records,{collection:{n:1},ledger:{n:1}});}finally{db.close();}
});

test('write failure rolls back every row and revision',async()=>{
  let fail=false;const e=setup({beforeCommit:op=>{if(fail&&op==='commit')throw Error('disk failure');}});
  try{commit(e.db,'meta',{a:{n:1},b:{n:1}});const before=e.db.snapshot('meta',null);fail=true;
    await assert.rejects(createNativeStore('meta',e.bridge).transact(['a','b'],()=>({changes:{a:{n:2},b:{n:2}}})),/disk failure/);
    assert.deepEqual(e.db.snapshot('meta',null),before);
  }finally{e.db.close();}
});

test('process termination before COMMIT leaves the last complete database',()=>{
  const e=setup();commit(e.db,'meta',{collection:{n:1},ledger:{n:1}});e.db.close();
  const script=join(e.dir,'crash.mjs');
  writeFileSync(script,`import {openDesktopStorage} from ${JSON.stringify(new URL('../desktop/storage.mjs',import.meta.url).href)};
    const db=openDesktopStorage(${JSON.stringify(e.dir)},{beforeCommit:op=>{if(op==='commit')process.exit(23);}});
    db.commit({scope:'meta',keys:['collection','ledger'],expectedRevision:db.status().revision,changes:{collection:{n:2},ledger:{n:2}}});`);
  assert.equal(spawnSync(process.execPath,[script],{encoding:'utf8'}).status,23);
  const db=openDesktopStorage(e.dir);try{assert.deepEqual(db.snapshot('meta',null).records,{collection:{n:1},ledger:{n:1}});}finally{db.close();}
});

test('consistent backup restores all scopes, protects current data and invalidates stale writers',()=>{
  const e=setup();try{
    commit(e.db,'meta',{'profile:test':{revision:1},'lease:test':{owner:'old'}});
    commit(e.db,'legacy',{'coop-profile-lease':{schema:1,value:'{"expires":9999999999999}'},data:{schema:1,value:'{"a":1}'}});
    commit(e.db,'seats',{seat:{token:'synthetic-private'}});commit(e.db,'outbox',{action:{actionId:'immutable-action',expectedRevision:1}});
    commit(e.db,'preferences',{settings:'{"volume":1}'});
    const backup=e.db.backup();commit(e.db,'meta',{'profile:test':{revision:2}});const previous=e.db.status().revision;
    const restored=e.db.restore(backup);assert.ok(restored.revision>previous);
    assert.deepEqual(e.db.snapshot('meta',null).records,{'profile:test':{revision:1}});
    assert.equal(e.db.snapshot('legacy',['coop-profile-lease']).records['coop-profile-lease'],null);
    assert.equal(e.db.snapshot('outbox',null).records.action.actionId,'immutable-action');
    assert.equal(e.db.snapshot('preferences',null).records.settings,'{"volume":1}');
    const protection=new DatabaseSync(restored.protectiveBackup,{readOnly:true});
    try{assert.equal(JSON.parse(protection.prepare("SELECT value FROM records WHERE scope='meta' AND key='profile:test'").get().value).revision,2);}finally{protection.close();}
    assert.throws(()=>e.db.commit({scope:'meta',keys:['x'],expectedRevision:previous,changes:{x:1}}),/DESKTOP_REVISION_CONFLICT/);
    const bad=join(e.dir,'bad.sqlite');writeFileSync(bad,'broken');const state=e.db.snapshot('meta',null);
    assert.throws(()=>e.db.restore(bad));assert.deepEqual(e.db.snapshot('meta',null),state);
  }finally{e.db.close();}
});

test('corrupt and future databases fail closed without replacing bytes',()=>{
  const dir=directory(),path=join(dir,'personal.sqlite');writeFileSync(path,'broken database');const bytes=readFileSync(path);
  assert.throws(()=>openDesktopStorage(dir));assert.deepEqual(readFileSync(path),bytes);
  const future=directory(),db=new DatabaseSync(join(future,'personal.sqlite'));db.exec('PRAGMA user_version=99');db.close();
  assert.throws(()=>openDesktopStorage(future),/DESKTOP_DATABASE_VERSION/);
});

async function seed(factory,name,rows){
  const db=await new Promise((resolve,reject)=>{const r=factory.open(name,1);r.onupgradeneeded=()=>{for(const store of Object.keys(rows))r.result.createObjectStore(store);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(rows),'readwrite');for(const [store,values] of Object.entries(rows))for(const [key,value] of Object.entries(values))tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
test('migration refusal, source change and failed initialization preserve old IDB and retry safely',async()=>{
  const factory=new IDBFactory(),prefs={getItem:key=>key==='prLang'?'zh-Hans':null};
  await seed(factory,'pokerogue-local-meta',{records:{}});
  await seed(factory,'pokerogue-early-local',{saves:{data:{schema:1,value:'{"dex":"18446744073709551616"}',updatedAt:5}}});
  await seed(factory,'coop-play-v1',{seats:{'host|ABC123|0':{roomId:'ABC123',seat:0,token:'synthetic-only'}},outbox:{action:{actionId:'same-id',expectedRevision:7}}});
  const capture=()=>captureDesktopLegacy(factory,prefs),original=await capture();
  let fail=true;const db=openDesktopStorage(directory(),{beforeCommit:op=>{if(fail&&op==='initialize')throw Error('migration interrupted');}});
  try{
    await assert.rejects(ensureNativeStorage(bridgeFor(db,{approve:false}),{capture}),/DESKTOP_MIGRATION_REQUIRED/);assert.equal(db.status().initialized,false);
    let n=0;await assert.rejects(ensureNativeStorage(bridgeFor(db),{capture:async()=>{const b=await capture();if(++n===2)b.preferences.prLang='en';return b;}}),/DESKTOP_MIGRATION_CHANGED/);
    const bridge=bridgeFor(db);await assert.rejects(ensureNativeStorage(bridge,{capture}),/migration interrupted/);assert.equal(db.status().initialized,false);
    fail=false;await ensureNativeStorage(bridge,{capture});for(const scope of STORAGE_SCOPES)assert.deepEqual(db.snapshot(scope,null).records,original[scope]);
    assert.deepEqual(await capture(),original);commit(db,'preferences',{prLang:'en'});await ensureNativeStorage(bridgeFor(db),{capture});assert.equal(db.snapshot('preferences',null).records.prLang,'en');
  }finally{db.close();}
});

test('native seats/outbox preserve identity and reject delayed old sessions even after CAS retry',async()=>{
  const e=setup();let current=true;const first={id:'first',isCurrent:()=>current},second={id:'second',isCurrent:()=>true};
  const play=createNativePlayStorage(e.bridge),origin='host-identity|profile-identity';
  const seat={roomId:'ABC123',seat:0,token:'synthetic-private',hostId:'host-identity',profileId:'profile-identity',runId:'original-run'};
  try{
    await play.beginSession(origin,first);assert.equal(await play.saveSeat(origin,seat,first),true);
    const action={roomId:'ABC123',actionId:'original-action',expectedRevision:4,payload:{pick:0}};await play.saveAction(origin,0,action);
    assert.deepEqual(await play.pendingActions(origin,'ABC123',0),[action]);assert.equal((await play.listSeats(origin))[0].token,undefined);
    const originalCommit=e.bridge.storageCommit;let inject=true;
    e.bridge.storageCommit=request=>{if(inject&&request.scope==='seats'){inject=false;commit(e.db,'seats',{['active:'+origin]:{sessionId:second.id,key:null,paused:false}});}return originalCommit(request);};
    assert.equal(await play.saveSeat(origin,{...seat,token:'wrong'},first),false);
    assert.equal(await play.pauseSession(origin,first),false);assert.equal(await play.loadSeat(origin),null);
    current=false;assert.equal(await play.resumeSession(origin,first,'ABC123',0),null);
    assert.deepEqual(await play.resumeSession(origin,second,'ABC123',0),seat);
    assert.deepEqual(await play.pendingActions('different-host','ABC123',0),[]);
    await play.pauseSession(origin,second);assert.equal(await play.beginSession(origin,second,true),null);
    e.db.close();const reopened=openDesktopStorage(e.dir);
    try{const next=createNativePlayStorage(bridgeFor(reopened));assert.equal(await next.loadSeat(origin),null);assert.deepEqual(await next.pendingActions(origin,'ABC123',0),[action]);}finally{reopened.close();}
  }catch(error){try{e.db.close();}catch{}throw error;}
});

let api,original,codec;
before(async()=>{
  globalThis.indexedDB=new IDBFactory();
  await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[{find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},{find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')}]},ssr:{noExternal:true},build:{ssr:resolve('tests/fixtures/desktop-storage-entry.mjs'),outDir:resolve('build/desktop-storage/original'),emptyOutDir:true,minify:false,rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
  api=createRequire(import.meta.url)('../build/desktop-storage/original/entry.cjs');await new Promise(setImmediate);original=await api.originalFixture();codec=createMetaCodec(api.originalSaveCodec);
});

test('actual original profile codec/repository keeps leases, CAS, history and archive on SQLite',async()=>{
  let fail=false;const e=setup({beforeCommit:op=>{if(fail&&op==='commit')throw Error('profile interrupted');}});
  try{
    const store=createNativeStore('meta',e.bridge),repo=createProfileRepository({store,codec});
    const plan=await repo.previewLegacy({format:'legacy-records',records:{data:JSON.stringify(original.system),sessionData:JSON.stringify(original.session)},preferences:{settings:null,tutorials:null,prLang:'zh-Hans'}},{sourceId:'native-old',displayName:'本地测试'});
    await repo.install(plan);const id=plan.profile.profileId,lease=await repo.acquire(id,'writer');
    const before=e.db.snapshot('meta',null);fail=true;
    await assert.rejects(repo.save(id,0,lease,p=>({...p,displayName:'不应保存'})),/profile interrupted/);assert.deepEqual(e.db.snapshot('meta',null),before);
    fail=false;await repo.save(id,0,lease,p=>({...p,displayName:'原子保存'}));
    await assert.rejects(repo.save(id,0,lease,p=>p),/LOCAL_REVISION_CONFLICT/);await assert.rejects(repo.acquire(id,'other'),/LOCAL_WRITER_BUSY/);
    const archive=await repo.exportArchive(id);assert.equal(archive.profile.originalSystem.trainerId,original.system.trainerId);
    assert.equal((await repo.recoveryPoints(id)).automatic.length,1);await repo.release(id,lease);
    const bundle=empty();bundle.meta=e.db.snapshot('meta',null).records;
    const target=openDesktopStorage(directory());
    try{
      const invalid=structuredClone(bundle);invalid.meta['profile:'+id].revision++;
      await assert.rejects(api.ensureNativeStorage(bridgeFor(target),{capture:async()=>invalid}),/LOCAL_DIRECTORY_MISMATCH/);
      assert.equal(target.status().initialized,false);
      await api.ensureNativeStorage(bridgeFor(target),{capture:async()=>bundle});
      assert.deepEqual(target.snapshot('meta',null).records,bundle.meta);
    }finally{target.close();}
    e.db.close();
    const reopened=openDesktopStorage(e.dir);try{const next=createProfileRepository({store:createNativeStore('meta',bridgeFor(reopened)),codec});assert.equal((await next.read(id)).displayName,'原子保存');assert.deepEqual((await next.read(id)).originalSystem,original.system);}finally{reopened.close();}
  }catch(error){try{e.db.close();}catch{}throw error;}
});

test('actual legacy save API and device settings use SQLite without changing browser IDB',async()=>{
  const e=setup(),previous=globalThis.pokerogueDesktop;globalThis.pokerogueDesktop=e.bridge;
  try{
    const old=await captureDesktopLegacy(globalThis.indexedDB,{getItem:()=>null});
    await api.writeLocalSave('data','{"n":1}');await api.writeLocalSave('data','{"n":2}','{"n":1}');
    await assert.rejects(api.writeLocalSave('data','{"n":3}','{"n":1}'));
    assert.equal(await api.readLocalSave('data:backup'),'{"n":1}');
    await api.mutateLocalSaves(['data','coop-grants'],()=>({data:'{"n":4}','coop-grants':'{"n":4}'}));
    assert.deepEqual(await api.readLocalSaveSnapshot(['data','coop-grants']),{data:'{"n":4}','coop-grants':'{"n":4}'});
    await api.deleteLocalSave('data');assert.equal(await api.readLocalSave('data'),null);assert.equal(await api.readLocalSave('data:backup'),'{"n":4}');
    deviceStorage().setItem('settings','{"音量":3}');assert.equal(deviceStorage().getItem('settings'),'{"音量":3}');deviceStorage().removeItem('settings');assert.equal(deviceStorage().hasOwnProperty('settings'),false);
    assert.throws(()=>deviceStorage().setItem('unknown','x'),/INVALID_PREFERENCE_KEY/);
    assert.deepEqual(await captureDesktopLegacy(globalThis.indexedDB,{getItem:()=>null}),old);
  }finally{globalThis.pokerogueDesktop=previous;e.db.close();}
});
