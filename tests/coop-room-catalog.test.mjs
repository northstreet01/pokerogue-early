import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {createRequire,isBuiltin} from 'node:module';
import {resolve} from 'node:path';
import {createPlayerHostAdapter} from '../server/original-coop-adapter.mjs';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
let api;
before(async()=>{
  await buildCoopRuntime();
  await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[{find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
    {find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')}]},ssr:{noExternal:true},
    build:{ssr:resolve('tests/fixtures/coop-play-ui-entry.mjs'),outDir:resolve('build/code-review/shared-catalog-test'),emptyOutDir:true,minify:false,
      rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
  api=createRequire(import.meta.url)('../build/code-review/shared-catalog-test/entry.cjs');api.describeOriginalCatalogs();
});
function data(seat){const runtime=api.createOriginalRuntime('catalog-data',{trainerId:seat+1,secretId:seat+10});
  const d=api.withOriginalRules(runtime.context,()=>new api.GameData(runtime.scene,{readOnly:true}));d.trainerId=seat+1;d.secretId=seat+10;
  for(const key of Object.keys(d.dexData))if(Number(key)!==[1,4][seat])d.dexData[key]={...d.dexData[key],caughtAttr:0n};return d;}
function profile(d,catalog,union,ids=[]){const view=api.roomSelectionData(d,union);
  const starters=ids.map(id=>({species:api.getPokemonSpecies(id),dexAttr:149n,nature:view.getNaturesForAttr(view.dexData[id].natureAttr)[0],pokerus:false}));
  return api.captureProfileDraft(view,starters,catalog);}
test('room union exposes peer starters without changing original collection or stacking discounts',async()=>{
  const a=data(0),b=data(1),before=a.captureSystemData.bind({...a,scene:{game:{config:{gameVersion:'1.0.0'}}}})();
  const ca=api.captureRoomCatalog(a),cb=api.captureRoomCatalog(b),union=api.mergeRoomCatalogs([ca,cb]);
  assert.deepEqual(union.map(r=>r.speciesId),[1,4]);
  const view=api.roomSelectionData(a,union);assert.equal(view.dexData[4].caughtAttr,149n);assert.equal(a.dexData[4].caughtAttr,0n);
  assert.equal(await view.saveSystem(),false);assert.notEqual(view.starterMoveData,a.starterMoveData);
  const borrowed=profile(a,ca,union,[4]);assert.equal(api.validateRoomSelection(borrowed,[ca,cb]),true);
  assert.equal(JSON.parse(before).dexData['4'].caughtAttr,0);
  const discounted=structuredClone(ca);discounted[0].caughtCount=25;
  const merged=api.mergeRoomCatalogs([ca,discounted]);assert.equal(merged[0].caughtCount,25);
  assert.throws(()=>api.validateRoomSelection({...borrowed,costs:[{...borrowed.costs[0],caughtCount:9999}]},[ca,cb]),/ROOM_COST_MISMATCH/);
});
test('real Worker accepts borrowed species, serializes collisions, releases cancellations and restores room catalogs',async()=>{
  const adapter=createPlayerHostAdapter({seedFactory:()=> 'room-catalog-test'});
  try{
    const a=data(0),b=data(1),ca=api.captureRoomCatalog(a),cb=api.captureRoomCatalog(b),union=api.mergeRoomCatalogs([ca,cb]);
    let c=await adapter.createInitialContext({runId:'catalog-run'});
    const submit=async(seat,p)=>{const action={kind:'profile-draft',profile:p,ready:false};await adapter.validateAction(c,seat,action);
      c=(await adapter.advanceToDecision(c,{[seat]:action})).context;};
    await assert.rejects(submit(0,profile(a,ca,ca,[1])),/ROOM_CATALOG_NOT_READY/);
    await submit(0,profile(a,ca,ca));await submit(1,profile(b,cb,union));
    const projected=await adapter.projectSnapshot(c,0);assert.deepEqual(projected.shared.catalogReady,[true,true]);
    assert.deepEqual(projected.personal.roomCatalog.map(r=>r.speciesId),[1,4]);
    await submit(0,profile(a,ca,union,[4]));
    const before=await adapter.captureCheckpoint(c);
    await assert.rejects(submit(1,profile(b,cb,union,[4])),/ROOM_SPECIES_OCCUPIED/);
    assert.deepEqual(await adapter.captureCheckpoint(c),before);
    await submit(0,profile(a,ca,union,[]));await submit(1,profile(b,cb,union,[4]));
    const saved=await adapter.captureCheckpoint(c);await adapter.closeAll();
    c=await adapter.restoreCheckpoint(saved);assert.deepEqual((await adapter.projectSnapshot(c,0)).personal.roomCatalog,union);
    await assert.rejects(submit(1,profile(b,[],union,[4])),/ROOM_CATALOG_CHANGED/);
    await submit(0,profile(a,ca,union,[1]));
    for(const seat of [0,1]){
      const action={kind:'profile-ready',profile:profile(seat?b:a,seat?cb:ca,union,[seat?4:1]),ready:true};
      await adapter.validateAction(c,seat,action);c=(await adapter.advanceToDecision(c,{[seat]:action})).context;
    }
    assert.equal((await adapter.projectSnapshot(c,0)).personal.decision.kind,'wait-actions');
    assert.equal((await adapter.projectSnapshot(c,1)).personal.party.length,1);
  }finally{await adapter.closeAll();}
});
