import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,isBuiltin} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {build} from 'vite';
import {IDBFactory} from 'fake-indexeddb';
import {createMetaStore} from '../src/local-meta/idb-store.mjs';
import {createMetaCodec,digest,json} from '../src/local-meta/codec.mjs';
import {createProfileRepository,legacyBackupSource} from '../src/local-meta/repository.mjs';

let api,original,codec;
before(async () => {
  globalThis.indexedDB = new IDBFactory();
  await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[
    {find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
    {find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')}
  ]},ssr:{noExternal:true},build:{ssr:resolve('tests/fixtures/local-meta-original-entry.mjs'),
    outDir:resolve('build/local-meta-02/original'),emptyOutDir:true,minify:false,
    rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
  api = createRequire(import.meta.url)('../build/local-meta-02/original/entry.cjs');
  // The opt-in production adapter must also load before any scene exists.
  await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[
    {find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
    {find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')}
  ]},ssr:{noExternal:true},esbuild:{keepNames:true},build:{ssr:resolve('src/local-meta/original-save-codec.ts'),
    outDir:resolve('build/local-meta-02/standalone-codec'),emptyOutDir:true,minify:'esbuild',
    rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'codec.cjs'}}}});
  const standalone = createRequire(import.meta.url)('../build/local-meta-02/standalone-codec/codec.cjs');
  await new Promise(setImmediate);
  original = await api.originalFixture();
  codec = createMetaCodec(standalone.originalSaveCodec);
});
const prefs = () => ({settings:'{"音量":2}',tutorials:'{"1":true}',prLang:'zh-Hans'});
function source(system=original.system) {
  return {format:'legacy-records',records:{data:JSON.stringify(system),
    sessionData:JSON.stringify(original.session),sessionData1:JSON.stringify({...original.session,waveIndex:2}),
    sessionData2:JSON.stringify({...original.session,waveIndex:3}),
    'data:backup':JSON.stringify(system),'coop-experiment-data':'{"doNotMerge":999}',
    'coop-experiment-grants':'{"ids":["old"]}','coop-seats':'{"entries":[]}'},preferences:prefs()};
}
let environments=0;
function setup(factory = new IDBFactory()) {
  const store = createMetaStore({indexedDB:factory});
  let clock=1000, sequence=0, fault=null;const namespace=++environments;
  const port={read:keys=>store.read(keys),transact:(keys,mutate)=>store.transact(keys,r=>{
    const update=mutate(r); if(fault?.(keys,update)) throw new Error('INJECTED_WRITE_FAILURE'); return update;
  })};
  const options={store:port,codec,now:()=>clock,uuid:()=>`env-${namespace}-id-${++sequence}`};
  return {store,port,repo:createProfileRepository(options),reopen:()=>createProfileRepository({...options,store:createMetaStore({indexedDB:factory})}),
    time:t=>{clock=t;},fault:f=>{fault=f;}};
}
async function migrated(env=setup()) {
  const plan = await env.repo.previewLegacy(source(),{sourceId:'old-browser',displayName:'小智'});
  await env.repo.install(plan);return {...env,plan,pid:plan.profile.profileId};
}

test('real original serializer and three sessions migrate without changing any original field or old store',async()=>{
  const before=await api.captureLegacySource({getItem:()=>null});
  const e=await migrated(), p=await e.repo.read(e.pid);
  assert.deepEqual(p.originalSystem,original.system);
  assert.equal(p.soloRuns.length,3);assert.deepEqual(p.soloRuns.map(r=>r.originalSession.waveIndex),[1,2,3]);
  assert.ok(p.soloRuns.every(r=>r.ownership==='unconfirmed'));
  assert.equal(p.isolated['coop-experiment-data'],'{"doNotMerge":999}');assert.deepEqual(p.grantLedger,[]);
  assert.deepEqual(p.preferences,prefs());assert.equal((await e.repo.list()).activeProfileId,null);
  assert.deepEqual(await api.captureLegacySource({getItem:()=>null}),before);
  assert.deepEqual(await e.reopen().read(e.pid),p);
});
test('migration preview is read-only, retry and a fresh preview of identical source never duplicate profiles',async()=>{
  const e=setup(), plan=await e.repo.previewLegacy(source(),{sourceId:'old-browser'});
  assert.deepEqual((await e.repo.list()).profiles,[]);
  await e.repo.install(plan);assert.equal((await e.repo.install(plan)).repeated,true);
  const second=await e.repo.previewLegacy(source(),{sourceId:'old-browser'});
  assert.equal((await e.repo.install(second)).profileId,plan.profile.profileId);
  assert.equal((await e.repo.list()).profiles.length,1);
});
test('changed source lineage and edited preview reject without replacing an installed profile',async()=>{
  const e=await migrated(), before=await e.repo.read(e.pid);
  const changed=source();changed.preferences.prLang='en';
  const plan=await e.repo.previewLegacy(changed,{sourceId:'old-browser'});
  await assert.rejects(e.repo.install(plan),/SOURCE_ALREADY_MIGRATED/);
  const edited=json(e.plan);edited.profile.originalSystem.trainerId=13;
  await assert.rejects(e.repo.install(edited),/PLAN_CHANGED/);
  assert.deepEqual(await e.repo.read(e.pid),before);
});
test('failure during stage, verification, or publication leaves no published half-profile; exact retry recovers',async()=>{
  for(const boundary of ['stage','publish']) {
    const e=setup(),plan=await e.repo.previewLegacy(source(),{sourceId:'old-browser'});
    e.fault(keys=>boundary==='stage'?keys.length===1:keys.includes('index'));
    await assert.rejects(e.repo.install(plan),/INJECTED_WRITE_FAILURE/);
    assert.deepEqual((await e.repo.list()).profiles,[]);
    e.fault(null);
    const afterReload=await e.reopen().previewLegacy(source(),{sourceId:'old-browser'});
    if(boundary==='publish')assert.equal(afterReload.planDigest,plan.planDigest);
    await e.reopen().install(afterReload);
    assert.deepEqual((await e.repo.read(afterReload.profile.profileId)).originalSystem,original.system);
  }
  const e=setup(),plan=await e.repo.previewLegacy(source(),{sourceId:'old-browser'});
  const brokenPort={transact:e.port.transact,read:async keys=>{
    const r=await e.port.read(keys);if(keys[0].startsWith('stage:'))r[keys[0]].profile.displayName='corrupted-stage';return r;
  }};
  const repo=createProfileRepository({store:brokenPort,codec,now:()=>1000,uuid:()=> 'unused'});
  await assert.rejects(repo.install(plan),/PLAN_CHANGED/);assert.deepEqual((await e.repo.list()).profiles,[]);
});
test('two reopened tabs cannot acquire the same writer, and stale revision/token cannot commit or release new ownership',async()=>{
  const e=await migrated(),other=e.reopen(),a=await e.repo.acquire(e.pid,'tab-a',1000);
  await assert.rejects(other.acquire(e.pid,'tab-b'),/WRITER_BUSY/);
  e.time(2001);const b=await other.acquire(e.pid,'tab-b');
  await assert.rejects(e.repo.save(e.pid,0,a,p=>p),/WRITER_LOST/);
  await e.repo.release(e.pid,a);await assert.rejects(e.repo.acquire(e.pid,'tab-c'),/WRITER_BUSY/);
  const p=await other.save(e.pid,0,b,p=>({...p,displayName:'新名字'}));assert.equal(p.revision,1);
  await assert.rejects(other.save(e.pid,0,b,p=>p),/REVISION_CONFLICT/);
  const renewed=await other.renew(e.pid,b);assert.equal(renewed.token,b.token);
});
test('save transaction rolls collection, ledger, index and backup back together on storage failure',async()=>{
  const e=await migrated(),lease=await e.repo.acquire(e.pid,'writer'),before=await e.repo.read(e.pid);
  e.fault(keys=>keys.includes('index'));
  await assert.rejects(e.repo.save(e.pid,0,lease,p=>{p.originalSystem.voucherCounts['0']=7;
    p.grantLedger.push({id:'receipt1',sourceRunId:'run1',ownerProfileId:e.pid,kind:'voucher',payloadHash:'a'.repeat(64),revision:0});return p;}),/INJECTED/);
  assert.deepEqual(await e.repo.read(e.pid),before);assert.equal((await e.repo.recoveryPoints(e.pid)).automatic.length,0);
  assert.equal((await e.repo.list()).profiles[0].revision,0);
});
test('five automatic snapshots rotate while original migration checkpoint stays protected; recovery is a coherent package',async()=>{
  const e=await migrated(),lease=await e.repo.acquire(e.pid,'writer');
  for(let rev=0;rev<7;rev++) await e.repo.save(e.pid,rev,lease,p=>({...p,displayName:`玩家${rev}`}));
  const h=await e.repo.recoveryPoints(e.pid);assert.equal(h.automatic.length,5);assert.equal(h.origin.displayName,'小智');
  const restored=await e.repo.restore(e.pid,'origin',7,lease);assert.equal(restored.revision,8);assert.equal(restored.displayName,'小智');
  assert.equal((await e.repo.recoveryPoints(e.pid)).recovery.revision,7);
});
test('corrupt primary fails closed, remains untouched on read, and explicit recovery uses valid history',async()=>{
  const e=await migrated();await e.store.transact([`profile:${e.pid}`],()=>({changes:{[`profile:${e.pid}`]:{broken:true}}}));
  await assert.rejects(e.repo.read(e.pid));
  const lease=await e.repo.acquire(e.pid,'recovery');
  const restored=await e.repo.restore(e.pid,'origin',0,lease);assert.deepEqual(restored.originalSystem,original.system);assert.equal(restored.revision,1);
});
test('exports have verified checksums, exclude live locks, and import preserves other profiles',async()=>{
  const e=await migrated(),lease=await e.repo.acquire(e.pid,'writer'),a=await e.repo.exportArchive(e.pid);
  assert.equal(JSON.stringify(a).includes(lease.token),false);
  const other=setup();await other.repo.create({...original.system,trainerId:99},{displayName:'另一个'});
  await other.repo.importArchive(a);assert.equal((await other.repo.list()).profiles.length,2);
  assert.deepEqual((await other.repo.read(e.pid)).originalSystem,original.system);
  const bad=json(a);bad.profile.displayName='篡改';await assert.rejects(other.repo.importArchive(bad),/ARCHIVE_CORRUPT/);
  const future=json(a);future.schemaVersion=2;await assert.rejects(other.repo.previewArchive(future),/VERSION_MISMATCH/);
});
test('explicit archive restore requires lease and CAS; no resource-max merge and identity cannot change',async()=>{
  const e=await migrated(),a=await e.repo.exportArchive(e.pid),lease=await e.repo.acquire(e.pid,'writer');
  await e.repo.save(e.pid,0,lease,p=>{p.originalSystem.voucherCounts['0']=10;return p;});
  await assert.rejects(e.repo.importArchive(a),/INVALID_LOCAL_PROFILE|WRITER_LOST/);
  const restored=await e.repo.importArchive(a,{expectedRevision:1,lease});assert.equal(restored.revision,2);
  assert.deepEqual(restored.originalSystem.voucherCounts,original.system.voucherCounts);
  await assert.rejects(e.repo.save(e.pid,2,lease,p=>({...p,profileId:'stolen'})),/IDENTITY_CHANGED|INVALID_LOCAL_PROFILE/);
});
test('switching active profile cannot abandon a live writer and distinct profiles remain isolated',async()=>{
  const e=await migrated(),p2=await e.repo.create({...original.system,trainerId:77});
  await e.repo.setActive(e.pid);const lease=await e.repo.acquire(e.pid,'writer');
  await assert.rejects(e.repo.setActive(p2.profileId),/WRITER_BUSY/);
  await e.repo.release(e.pid,lease);await e.repo.setActive(p2.profileId);
  assert.equal((await e.repo.list()).activeProfileId,p2.profileId);
  assert.equal((await e.repo.read(e.pid)).originalSystem.trainerId,12);
});
test('original .prsv uses the original short-key converter and revivers; JSON backup v1 preserves declared scope',async()=>{
  const key=readFileSync('src/system/game-data.ts','utf8').match(/const saveKey = '([^']+)'/)[1];
  const shortened=api.GameData.prototype.convertSystemDataStr(JSON.stringify(original.system),true);
  const text=api.AES.encrypt(shortened,key).toString();
  assert.deepEqual(api.prsvSystemSource(text).records.data,JSON.stringify(codec.original.system(original.system)));
  const sessionText=api.AES.encrypt(JSON.stringify(original.session),key).toString();
  assert.deepEqual(api.previewPrsvSession(sessionText),{ownership:'unconfirmed',originalSession:original.session});
  assert.throws(()=>api.prsvSystemSource('broken'));
  assert.throws(()=>api.originalSaveCodec.decodePrsv(text,'unknown'),/INVALID_LEGACY_TYPE/);
  const b=legacyBackupSource({format:'pokerogue-early-backup',version:1,createdAt:'2026-10-25T00:00:00Z',records:source().records,settings:prefs().settings});
  const e=setup(),plan=await e.repo.previewLegacy(b,{sourceId:'file-import'});assert.equal(plan.profile.soloRuns.length,3);
});
test('large dex attributes and nonempty original eggs survive unchanged; deferred hatches cannot release at a pause',async()=>{
  const e=await migrated(),lease=await e.repo.acquire(e.pid,'writer');
  const raw=json(original.system),large=api.largeOriginalDexAttribute();
  assert.ok(BigInt(large.value)>2n**31n);raw.dexData[large.speciesId].caughtAttr=large.value;
  raw.eggs=[{id:123,gachaType:0,hatchWaves:0,timestamp:55}];
  codec.original.system(raw);
  const p=await e.repo.save(e.pid,0,lease,p=>({...p,originalSystem:raw,deferredHatches:[{sourceRunId:'coop1',eggId:123,eggTimestamp:55,state:'waiting-terminal',terminal:null}]}));
  const archive=await e.repo.exportArchive(e.pid);assert.deepEqual((await e.repo.previewArchive(archive)).profile,p);
  await assert.rejects(e.repo.save(e.pid,1,lease,p=>{p.deferredHatches[0].state='released';p.deferredHatches[0].terminal={result:'paused',receiptId:'r1'};return p;}));
  assert.deepEqual((await e.repo.read(e.pid)).originalSystem.eggs,raw.eggs);
});
test('malformed schemas, unknown catalogue ids, wrong egg inventory, accessors and asynchronous mutations reject',async()=>{
  const e=await migrated(),lease=await e.repo.acquire(e.pid,'writer'),base=await e.repo.read(e.pid);
  for(const edit of [p=>{p.schemaVersion=2;},p=>{p.originalSystem.trainerId=-1;},p=>{p.originalSystem.eggs=null;},
    p=>{p.originalSystem.dexData['999999']=p.originalSystem.dexData['1'];},p=>{p.originalSystem.dexData['1'].ivs[0]=32;},
    p=>{p.soloRuns[0].originalSession.party[0].species=999999;},p=>{p.extra=true;}]) {
    const bad=json(base);edit(bad);assert.throws(()=>codec.profile(bad));
  }
  assert.throws(()=>json({get exploit(){throw Error('GETTER_EXECUTED');}}),/INVALID_JSON/);
  await assert.rejects(e.repo.save(e.pid,0,lease,async p=>p),/ASYNC_LOCAL_TRANSACTION/);
  await assert.rejects(e.repo.previewLegacy({format:'legacy-records',records:{sessionData:JSON.stringify(original.session)},preferences:prefs()},{sourceId:'orphan'}),/ORPHAN_SOLO/);
  assert.deepEqual(await e.repo.read(e.pid),base);
});
test('store refuses unwatched and async writes and an aborted IDB transaction leaves the prior snapshot intact',async()=>{
  const e=setup();await e.store.transact(['a','b'],()=>({changes:{a:{revision:1},b:{revision:1}}}));
  await assert.rejects(e.store.transact(['a'],()=>({changes:{b:{revision:2}}})),/UNREAD_LOCAL_WRITE/);
  await assert.rejects(e.store.transact(['a'],async()=>({changes:{a:{revision:2}}})),/ASYNC_LOCAL_TRANSACTION/);
  await assert.rejects(e.store.transact(['a','b'],()=>{throw new Error('DISK_FULL');}),/DISK_FULL/);
  assert.deepEqual(await e.store.read(['a','b']),{a:{revision:1},b:{revision:1}});
});

test('quota failure after the first actual IDB put aborts all profile/index/history writes',async()=>{
  const factory=new IDBFactory(), e=await migrated(setup(factory)),before=await e.repo.read(e.pid);
  const lease=await e.repo.acquire(e.pid,'writer');let puts=0;
  const injected={open(...args){const request=factory.open(...args);request.addEventListener('success',()=>{
    const db=request.result,transaction=db.transaction.bind(db);
    db.transaction=(...args)=>{const tx=transaction(...args),objectStore=tx.objectStore.bind(tx);
      tx.objectStore=(...args)=>{const s=objectStore(...args),put=s.put.bind(s);
        s.put=(...args)=>{if(++puts===2)throw new DOMException('synthetic quota','QuotaExceededError');return put(...args);};return s;};return tx;};
  });return request;}};
  const repo=createProfileRepository({store:createMetaStore({indexedDB:injected}),codec,now:()=>1000});
  await assert.rejects(repo.save(e.pid,0,lease,p=>({...p,displayName:'不应落盘'})),/synthetic quota/);
  assert.ok(puts>=2);assert.deepEqual(await e.reopen().read(e.pid),before);
  assert.equal((await e.repo.recoveryPoints(e.pid)).automatic.length,0);
});
test('same-revision concurrent saves have exactly one winner and independent profile writers coexist',async()=>{
  const e=await migrated(),lease=await e.repo.acquire(e.pid,'writer'),p2=await e.repo.create({...original.system,trainerId:101});
  const lease2=await e.repo.acquire(p2.profileId,'writer2');
  const results=await Promise.allSettled([e.repo.save(e.pid,0,lease,p=>({...p,displayName:'A'})),
    e.reopen().save(e.pid,0,lease,p=>({...p,displayName:'B'})),e.repo.save(p2.profileId,0,lease2,p=>({...p,displayName:'C'}))]);
  assert.equal(results.slice(0,2).filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results[2].status,'fulfilled');assert.equal((await e.repo.read(p2.profileId)).displayName,'C');
});
test('normal writes cannot remove ledger receipts; a whole archive rollback restores receipt and resource together',async()=>{
  const e=await migrated(),lease=await e.repo.acquire(e.pid,'writer'),old=await e.repo.exportArchive(e.pid);
  await e.repo.save(e.pid,0,lease,p=>{p.originalSystem.voucherCounts['0']=2;p.grantLedger=[{
    id:'run1:voucher:0',sourceRunId:'run1',ownerProfileId:e.pid,kind:'voucher',payloadHash:'b'.repeat(64),revision:0}];return p;});
  await assert.rejects(e.repo.save(e.pid,1,lease,p=>({...p,grantLedger:[]})),/LEDGER_REMOVAL/);
  const p=await e.repo.importArchive(old,{expectedRevision:1,lease});assert.deepEqual(p.grantLedger,[]);
  assert.deepEqual(p.originalSystem.voucherCounts,original.system.voucherCounts);
});
test('corrupt directory and future primary never silently create a fresh profile or activate a bad target',async()=>{
  const e=await migrated(),before=await e.repo.list();
  await e.store.transact([`profile:${e.pid}`],r=>({changes:{[`profile:${e.pid}`]:{...r[`profile:${e.pid}`],schemaVersion:99}}}));
  await assert.rejects(e.repo.setActive(e.pid),/VERSION_MISMATCH/);
  assert.deepEqual(await e.repo.list(),before);
  await e.store.transact(['index'],()=>({changes:{index:{broken:true}}}));
  await assert.rejects(e.repo.list());await assert.rejects(e.repo.create(original.system));
  assert.deepEqual((await e.store.read(['index'])).index,{broken:true});
});
test('archive publication failure and release by a stale owner cannot erase the last good backup',async()=>{
  const e=await migrated(),lease=await e.repo.acquire(e.pid,'writer'),archive=await e.repo.exportArchive(e.pid);
  await e.repo.save(e.pid,0,lease,p=>({...p,displayName:'current'}));
  const before=await e.repo.read(e.pid),history=await e.repo.recoveryPoints(e.pid);
  e.fault(keys=>keys.includes('index'));
  await assert.rejects(e.repo.importArchive(archive,{expectedRevision:1,lease}),/INJECTED/);
  e.fault(null);assert.deepEqual(await e.repo.read(e.pid),before);assert.deepEqual(await e.repo.recoveryPoints(e.pid),history);
});
test('legacy live lease blocks source capture; absent egg inventory is unknown, not converted into empty eggs',async()=>{
  await api.mutateLocalSaves(['coop-profile-lease'],()=>({'coop-profile-lease':JSON.stringify({owner:'old-page',expires:Date.now()+30000})}));
  try {await assert.rejects(api.captureLegacySource({getItem:()=>null}),/LEGACY_WRITER_BUSY/);}
  finally {await api.mutateLocalSaves(['coop-profile-lease'],()=>({'coop-profile-lease':null}));}
  const e=setup(),s=source();delete s.records.data;
  await assert.rejects(e.repo.previewLegacy(s,{sourceId:'orphan'}),/ORPHAN/);
  const raw=json(original.system);delete raw.eggs;
  assert.throws(()=>codec.original.system(raw));assert.deepEqual((await e.repo.list()).profiles,[]);
});
test('malformed lease records are not treated as expired and cannot be silently removed by an invalid release',async()=>{
  const e=await migrated();
  await e.store.transact([`lease:${e.pid}`],()=>({changes:{[`lease:${e.pid}`]:{expires:0}}}));
  await assert.rejects(e.repo.acquire(e.pid,'writer'));
  await assert.rejects(e.repo.release(e.pid,null),/WRITER_LOST/);
  assert.deepEqual((await e.store.read([`lease:${e.pid}`]))[`lease:${e.pid}`],{expires:0});
});
