import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {createRequire,isBuiltin} from 'node:module';
import {resolve,join} from 'node:path';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {IDBFactory} from 'fake-indexeddb';
import {createMetaStore} from '../src/local-meta/idb-store.mjs';
import {createMetaCodec} from '../src/local-meta/codec.mjs';
import {createProfileRepository} from '../src/local-meta/repository.mjs';
import {openGameProfileIO} from '../src/local-meta/game-io.mjs';
import {createSnapshotConsumer,digestProjection} from '../src/battle-core/coop-client.mjs';
import {createPlayerHostAdapter} from '../server/original-coop-adapter.mjs';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {openDesktopStorage,STORAGE_SCOPES,bundleDigest} from '../desktop/storage.mjs';
import {createNativeStore} from '../src/platform/native-storage.mjs';
import {formalFixture} from './helpers/formal-ws.mjs';
import {FormalRoomStore} from '../server/formal-coop-service.mjs';
let api,codec;
before(async()=>{
  globalThis.indexedDB=new IDBFactory();
  await buildCoopRuntime();
  await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[
    {find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
    {find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')}]},ssr:{noExternal:true},
    build:{ssr:resolve('tests/fixtures/coop-play-ui-entry.mjs'),outDir:resolve('build/code-review/permanent-test'),emptyOutDir:true,minify:false,
      rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
  api=createRequire(import.meta.url)('../build/code-review/permanent-test/entry.cjs');api.describeOriginalCatalogs();
  await new Promise(setImmediate);codec=createMetaCodec(api.originalSaveCodec);
});
function original(seat=0){
  const runtime=api.createOriginalRuntime('permanent-data',{trainerId:seat+1,secretId:seat+10});
  runtime.scene.game={config:{gameVersion:'1.0.0'}};
  const data=api.withOriginalRules(runtime.context,()=>new api.GameData(runtime.scene,{readOnly:true}));
  data.trainerId=seat+1;data.secretId=seat+10;data.gender=1;runtime.scene.gameData=data;
  return {runtime,data,system:JSON.parse(data.captureSystemData())};
}
async function writer(seat=0,store=createMetaStore({indexedDB:new IDBFactory()})){
  const base=original(seat),repo=createProfileRepository({store,codec});
  const profile=await repo.create(base.system),profileId=profile.profileId;
  const io=await openGameProfileIO(repo,profileId,{mode:'coop'});base.data.bindProfileIO(io);
  const binding={hostId:'test-host',runId:'test-run',roomId:'ABCDEF',seat,profileId,token:'private',isCurrent:()=>true};
  return {...base,repo,io,profileId,binding};
}
const grant=(id,facts,seat=0)=>({id,seat,payload:{version:1,facts}});
const caught=(pokemon,kind='capture-pending')=>({kind,factVersion:1,owner:0,pokemonId:pokemon.id,
  speciesId:pokemon.species.speciesId,dexAttr:pokemon.getDexAttr().toString(),pokemon:api.capturePokemonState(pokemon)});
test('original collection methods replay recursive captures, IVs and evolution without importing room unlocks or consuming eggs',async()=>{
  const e=await writer();
  try{
    const p=api.constructOriginalPokemon(e.runtime,2,16);p.ivs=[31,31,31,31,31,31];
    const batch=grant('capture-1',[caught(p),{kind:'dex-ivs',owner:0,speciesId:2,ivs:p.ivs}]);
    const reference=original();
    reference.runtime.scene.ui={showText:(_t,_d,cb)=>cb?.(),achvBar:{showAchv(){}}};reference.runtime.scene.playSoundWithoutBgm=()=>{};
    await reference.data.setPokemonCaught(p);reference.data.updateSpeciesDexIvs(2,p.ivs);
    await e.data.applyCoopResults([batch],e.binding);
    let stored=await e.repo.read(e.profileId);
    const expected=JSON.parse(reference.data.captureSystemData());
    for(const key of ['dexData','gameStats','voucherCounts','eggs'])assert.deepEqual(stored.originalSystem[key],expected[key]);
    assert.ok(stored.originalSystem.achvUnlocks.PERFECT_IVS);
    assert.equal(stored.originalSystem.dexData['4'].caughtAttr,e.system.dexData['4'].caughtAttr);
    const once=structuredClone(stored);await e.data.applyCoopResults([batch],e.binding);assert.deepEqual(await e.repo.read(e.profileId),once);
    const evo=api.constructOriginalPokemon(e.runtime,3,32);
    await e.data.applyCoopResults([grant('evolution-1',[caught(evo,'evolution-pending')])],e.binding);
    stored=await e.repo.read(e.profileId);assert.equal(stored.originalSystem.gameStats.pokemonCaught,once.originalSystem.gameStats.pokemonCaught);
    assert.notEqual(stored.originalSystem.dexData['3'].caughtAttr,0);
    assert.equal(e.data.dexData[3].caughtAttr,BigInt(stored.originalSystem.dexData['3'].caughtAttr));
    const withEgg=structuredClone(e.system);withEgg.eggs=[{id:123,gachaType:0,hatchWaves:0,timestamp:55}];
    const staged=await e.data.reduceCoopResults(withEgg,[grant('egg-preserved',[caught(p)])]);
    assert.deepEqual(staged.system.eggs,withEgg.eggs);
  }finally{await e.data.closeProfile();}
});
test('starting-team preferences persist only when legal in the personal collection',async()=>{
  const e=await writer();
  try{
    const fact={kind:'session-start',starters:[{speciesId:1,dexAttr:'149',moveset:[33,45]},
      {speciesId:25,dexAttr:'149',moveset:[84,39]}]};
    await e.data.applyCoopResults([grant('preferences',[fact])],e.binding);
    const system=(await e.repo.read(e.profileId)).originalSystem;
    assert.deepEqual(system.starterMoveData[1],[33,45]);assert.equal(system.starterMoveData[25],undefined);
    assert.equal(system.dexData[25].caughtAttr,0);
  }finally{await e.data.closeProfile();}
});
test('first and repeat boss/victory vouchers use original award rules exactly once',async()=>{
  const e=await writer();
  try{
    const boss=Object.values(api.vouchers).find(v=>v.id!=='CLASSIC_VICTORY');assert.ok(boss);
    const fact={kind:'voucher-pending',owner:0,id:boss.id,voucherType:boss.voucherType,repeat:true};
    await e.data.applyCoopResults([grant('boss-first',[fact])],e.binding);
    assert.equal(e.data.voucherCounts[boss.voucherType],e.system.voucherCounts[boss.voucherType]+1);
    await e.data.applyCoopResults([grant('boss-repeat',[fact])],e.binding);
    assert.equal(e.data.voucherCounts[0],e.system.voucherCounts[0]+(boss.voucherType===0?1:0)+1);
    const completion={kind:'completion-pending',owner:0,achievementId:'CLASSIC_VICTORY',sessionsWon:1,unlockCandidates:[0,1]};
    const voucher={kind:'voucher-pending',owner:0,id:'CLASSIC_VICTORY',voucherType:3};
    const before=[...Object.values(e.data.voucherCounts)];
    await e.data.applyCoopResults([grant('victory-first',[completion,voucher])],e.binding);
    assert.equal(e.data.voucherCounts[3],before[3]+1);assert.equal(e.data.voucherCounts[2],before[2]);
    await e.data.applyCoopResults([grant('victory-repeat',[completion,voucher])],e.binding);
    assert.equal(e.data.voucherCounts[3],before[3]+1);assert.equal(e.data.voucherCounts[2],before[2]+1);
    assert.equal(e.data.gameStats.sessionsWon,2);assert.equal(e.data.unlocks[0],true);
    await assert.rejects(e.data.applyCoopResults([grant('unchecked',[{kind:'achievement-approved',id:'_10M_MONEY'}])],e.binding),/INVALID_COOP_ACHIEVEMENT/);
    // Clear the failed queue by a valid idempotent retry before orderly close.
    await e.data.applyCoopResults([grant('victory-repeat',[completion,voucher])],e.binding);
  }finally{await e.data.closeProfile();}
});
test('real Worker grants new encounter facts to both seats and never backfills restored old pending facts',async()=>{
  const adapter=createPlayerHostAdapter({seedFactory:()=> 'permanent-worker'});
  try{
    const players=[original(0),original(1)],catalogs=players.map(p=>api.captureRoomCatalog(p.data));
    const union=api.mergeRoomCatalogs(catalogs);
    let context=await adapter.createInitialContext({runId:'test-run'});
    const action=(seat,ids,ready=false)=>({kind:ready?'profile-ready':'profile-draft',ready,
      profile:api.captureProfileDraft(api.roomSelectionData(players[seat].data,union),ids.map(id=>({species:api.getPokemonSpecies(id),dexAttr:149n,
        nature:players[seat].data.getNaturesForAttr(players[seat].data.dexData[id].natureAttr)[0],pokerus:false})),catalogs[seat])});
    for(const seat of [0,1])context=(await adapter.advanceToDecision(context,{[seat]:action(seat,[])})).context;
    for(const seat of [0,1])context=(await adapter.advanceToDecision(context,{[seat]:action(seat,[seat?4:1])})).context;
    for(const seat of [0,1]){
      const result=await adapter.advanceToDecision(context,{[seat]:action(seat,[seat?4:1],true)});context=result.context;
      if(seat===1){
        assert.equal(result.grants.length,2);
        for(const grant of result.grants){
          assert.ok(grant.payload.facts.some(f=>f.kind==='seen'&&f.pokemon));
          assert.ok(grant.payload.facts.some(f=>f.kind==='session-start'));
        }
      }
    }
    // Synthetic master-ball inventory makes success deterministic; capture,
    // ownership, IV and achievement facts still execute the original phases.
    for(let turn=0;turn<12&&!context.checkpoint.decision.options[1].some(o=>o.kind==='ball');turn++){
      const options=context.checkpoint.decision.options;
      context=(await adapter.advanceToDecision(context,{0:options[0].find(o=>o.kind==='fight'),1:options[1].find(o=>o.kind==='fight')})).context;
      assert.equal(context.checkpoint.decision.kind,'wait-actions');
    }
    const battle=structuredClone(context.checkpoint);
    const ball={...battle.decision.options[1].find(o=>o.kind==='ball'),pokeballType:4};
    assert.equal(ball.kind,'ball');battle.players[1].pokeballCounts[4]=1;battle.decision.options[1].push(ball);
    context.checkpoint=battle;
    const result=await adapter.advanceToDecision(context,{0:battle.decision.options[0].find(o=>o.kind==='fight'),1:ball});
    assert.ok(result.grants.find(g=>g.seat===1)?.payload.facts.some(f=>f.kind==='capture-pending'&&f.owner===1));
    assert.equal(result.grants.find(g=>g.seat===0)?.payload.facts.some(f=>f.kind==='capture-pending')??false,false);
    assert.ok(result.grants.find(g=>g.seat===1)?.payload.facts.some(f=>f.kind==='dex-ivs'&&f.owner===1));
    context=result.context;
    const recipient=await writer(1);
    try{
      for(const g of result.grants.filter(g=>g.seat===1))await recipient.data.applyCoopResults([g],recipient.binding);
      assert.ok(recipient.data.gameStats.pokemonCaught>0);
    }finally{await recipient.data.closeProfile();}
    const saved=await adapter.captureCheckpoint(context);await adapter.closeAll();
    const restored=await adapter.restoreCheckpoint(saved);assert.deepEqual(await adapter.captureCheckpoint(restored),saved);
    const legacy=structuredClone(saved);delete legacy.provisioning.permanentResults;delete legacy.provisioning.eggLifecycle;
    await adapter.closeAll();const old=await adapter.restoreCheckpoint(legacy);
    assert.equal(old.provisioning.permanentResults,undefined);
  }finally{await adapter.closeAll();}
});
test('a queued pre-result System save cannot erase a committed grant; expired scenes cannot commit',async()=>{
  const e=await writer();e.data.readonlyView=false;
  try{
    const reward=grant('generation-1',[{kind:'statistics',owner:0,values:{battles:1}}]);
    const first=e.data.applyCoopResults([reward],e.binding);
    const stale=e.data.saveSystem();await first;assert.equal(await stale,false);
    assert.equal((await e.repo.read(e.profileId)).originalSystem.gameStats.battles,1);
    await e.data.applyCoopResults([reward],e.binding);
    assert.equal(await e.data.saveSystem(),true);
    const before=await e.repo.read(e.profileId);
    await assert.rejects(e.data.applyCoopResults([grant('expired',[{kind:'statistics',values:{battles:10}}])],{...e.binding,isCurrent:()=>false}),/COOP_BINDING_EXPIRED/);
    assert.deepEqual(await e.repo.read(e.profileId),before);
    await e.data.applyCoopResults([reward],e.binding);
  }finally{await e.data.closeProfile();}
});
test('two actual sockets persist original results before sending, then replay an unacknowledged grant after host restart',async()=>{
  const root=resolve('build/code-review/permanent-host');mkdirSync(root,{recursive:true});
  const store=new FormalRoomStore(mkdtempSync(join(root,'run-')));
  const players=[await writer(0),await writer(1)],adapters=[];
  const start=async()=>{const adapter=createPlayerHostAdapter({seedFactory:()=> 'permanent-ws'});adapters.push(adapter);return formalFixture(adapter,store);};
  let env=await start();
  try{
    let pair=[await env.client(),await env.client()];
    pair[0].send({type:'createRoom',name:'A'});const welcome=await pair[0].wait(m=>m.type==='welcome');
    pair[1].send({type:'joinRoom',roomId:welcome.roomId,name:'B'});const peer=await pair[1].wait(m=>m.type==='welcome');
    const tokens=[welcome.resumeToken,peer.resumeToken];
    let snapshots=await Promise.all(pair.map(c=>c.wait(m=>m.type==='snapshot')));
    let drop=false;
    const consumers=()=>pair.map((client,seat)=>{
      const model=api.createOriginalClientModel(api);
      return createSnapshotConsumer({versions:env.versions,isCurrent:()=>true,send:m=>{if(!(drop&&seat===1))client.send(m);},adapter:{
        applySnapshot:m=>model.applySnapshot(m),captureAppliedState:()=>model.captureAppliedState(),
        applyGrantsTransaction:g=>players[seat].data.applyCoopResults(g,{...players[seat].binding,roomId:welcome.roomId,runId:snapshots[seat].runId,token:tokens[seat]})}});
    });
    let consume=consumers();
    const sync=async()=>{await Promise.all(snapshots.map((s,i)=>consume[i](s)));if(!drop)await pair[0].wait(m=>m.type==='syncStatus'&&!m.blocked&&m.revision===snapshots[0].revision);};
    await sync();
    const catalogs=players.map(p=>api.captureRoomCatalog(p.data)),union=api.mergeRoomCatalogs(catalogs);let sequence=0;
    for(const [seat,ids,ready] of [[0,[],false],[1,[],false],[0,[1],false],[1,[4],false],[0,[1],true],[1,[4],true]]){
      const p=players[seat].data,view=api.roomSelectionData(p,union);
      const profile=api.captureProfileDraft(view,ids.map(id=>({species:api.getPokemonSpecies(id),dexAttr:149n,nature:view.getNaturesForAttr(view.dexData[id].natureAttr)[0],pokerus:false})),catalogs[seat]);
      const snapshot=snapshots[seat],revision=snapshot.revision;
      pair[seat].send({type:'submitAction',roomId:snapshot.roomId,runId:snapshot.runId,decisionId:snapshot.decisionId,expectedRevision:revision,
        actionId:`profile-${sequence++}`,action:{kind:ready?'profile-ready':'profile-draft',profile,ready}});
      snapshots=await Promise.all(pair.map(c=>c.wait(m=>m.type==='snapshot'&&m.revision>revision)));
      if(ready&&seat===1){
        const disk=(await store.load())[0];assert.equal(disk.grants.length,2);assert.equal(disk.grantAcks.length,0);drop=true;
      }
      await sync();
    }
    const stored=await players[1].repo.read(players[1].profileId);assert.ok(stored.originalSystem.gameStats.pokemonSeen>0);
    assert.equal(stored.originalSystem.gameStats.classicSessionsPlayed,1);
    await env.close();env=await start();pair=[await env.client(),await env.client()];
    for(const seat of [0,1]){pair[seat].send({type:'resumeSeat',roomId:welcome.roomId,resumeToken:tokens[seat]});}
    snapshots=await Promise.all(pair.map(c=>c.wait(m=>m.type==='snapshot')));
    assert.equal(snapshots[1].grants.length,1);drop=false;consume=consumers();await sync();
    assert.deepEqual(await players[1].repo.read(players[1].profileId),stored);
    const final=(await store.load())[0];assert.equal(final.grantAcks.length,2);
  }finally{await env.close();for(const adapter of adapters)await adapter.closeAll();for(const p of players)await p.data.closeProfile();}
});
test('SQLite failure emits no ACK; lost ACK and reopen replay do not duplicate permanent results',async()=>{
  const root=resolve('build/code-review/permanent-sqlite');mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'run-'));let failing=false;
  let db=openDesktopStorage(dir,{beforeCommit:op=>{if(failing&&op==='commit')throw Error('INJECTED_DISK_FAILURE');}});
  const empty=Object.fromEntries(STORAGE_SCOPES.map(scope=>[scope,{}]));db.initialize(empty,bundleDigest(empty));
  const wrap=fn=>{try{return {ok:true,value:fn()};}catch(e){return {ok:false,code:e.message};}};
  const bridge={storageVersion:1,storageStatus:()=>wrap(()=>db.status()),storageSnapshot:r=>wrap(()=>db.snapshot(r.scope,r.keys)),storageCommit:r=>wrap(()=>db.commit(r))};
  const e=await writer(0,createNativeStore('meta',bridge));
  const projection={shared:{a:1},personal:{a:2}},acks=[];
  const versions={protocolVersion:1,checkpointVersion:1,rulesVersion:'early-vs02',contentHash:'vs02-original-coop'};
  const message={...versions,type:'snapshot',roomId:'ABCDEF',runId:'test-run',seat:0,connectionEpoch:'epoch-1',revision:1,decisionId:'decision-1',
    ...projection,sharedHash:await digestProjection(projection.shared),personalHash:await digestProjection(projection.personal),events:[],
    grants:[grant('stats-1',[{kind:'statistics',owner:0,values:{battles:1}}])]};
  const consumer=createSnapshotConsumer({versions,isCurrent:()=>true,send:m=>acks.push(m),adapter:{applySnapshot(){},captureAppliedState:()=>projection,
    applyGrantsTransaction:g=>e.data.applyCoopResults(g,e.binding)}});
  try{
    failing=true;await assert.rejects(consumer(message),/INJECTED_DISK_FAILURE/);
    assert.equal(acks.some(a=>a.type==='grantAck'||a.type==='stateAck'),false);
    assert.equal((await e.repo.read(e.profileId)).grantLedger.length,0);
    failing=false;await consumer(message);assert.equal(e.data.gameStats.battles,1);
    const saved=await e.repo.read(e.profileId);await e.data.closeProfile();db.close();db=openDesktopStorage(dir);
    const io=await openGameProfileIO(e.repo,e.profileId,{mode:'coop'});
    await io.applyCoopGrants(message.grants,e.binding,()=>{throw Error('DOUBLE_APPLY');});await io.close();
    assert.deepEqual(await e.repo.read(e.profileId),saved);
  }finally{e.io.invalidate();db.close();}
});


test('profile gacha commits original voucher offers and batch guarantees before exposing eggs',async()=>{
  for(const [choice,cost,count,type] of [[0,1,1,0],[1,10,10,0],[2,1,5,1],[3,1,10,2],[4,1,25,3]]){
    const e=await writer();e.data.readonlyView=false;
    try{
      const system=structuredClone(e.system);for(const k of [0,1,2,3])system.voucherCounts[k]=50;
      await e.io.writeSystem(system);await e.data.loadSystem({readOnly:true});
      const eggs=await e.data.purchaseEggs(choice,choice%3),p=await e.repo.read(e.profileId);
      assert.equal(eggs.length,count);assert.equal(p.originalSystem.eggs.length,count);
      assert.equal(p.originalSystem.voucherCounts[type],50-cost);
      assert.equal(p.originalSystem.gameStats.eggsPulled,count);
      if(count>=25)assert.ok(eggs.some(egg=>egg.tier>=2));else if(count>=10)assert.ok(eggs.some(egg=>egg.tier>=1));
      assert.equal(p.grantLedger.filter(g=>g.id.startsWith('egg:')).length,1);
      const before=structuredClone(p);await assert.rejects(e.data.purchaseEggs(99,0),/INVALID_GACHA_SELECTION/);
      assert.deepEqual(await e.repo.read(e.profileId),before);
    }finally{await e.data.closeProfile();}
  }
});

test('disk failure leaves gacha inventory and vouchers untouched, retry uses the exact staged draw',async()=>{
  const store=createMetaStore({indexedDB:new IDBFactory()}),fault={enabled:false};
  const wrapped={read:store.read,transact:(keys,apply)=>{if(fault.enabled)throw Error('disk');return store.transact(keys,apply);}};
  const e=await writer(0,wrapped);e.data.readonlyView=false;
  try{
    const system=structuredClone(e.system);system.voucherCounts[0]=10;
    await e.io.writeSystem(system);await e.data.loadSystem({readOnly:true});
    const before=await e.repo.read(e.profileId);fault.enabled=true;
    await assert.rejects(e.data.purchaseEggs(1,0),/disk/);
    const staged=JSON.parse(JSON.stringify(e.data.pendingEggOperation.eggs));
    assert.deepEqual(await e.repo.read(e.profileId),before);assert.equal(e.data.eggs.length,0);assert.equal(e.data.voucherCounts[0],10);
    fault.enabled=false;const retry=await e.data.purchaseEggs(1,0);
    assert.deepEqual(JSON.parse(JSON.stringify(retry)),staged);
    assert.equal((await e.repo.read(e.profileId)).originalSystem.voucherCounts[0],0);
  }finally{fault.enabled=false;await e.data.closeProfile();}
});

test('egg progress reserves at zero, terminal releases, original hatch rewards persist before repeatable playback',async()=>{
  const e=await writer();e.data.readonlyView=false;
  try{
    const egg={id:12345,gachaType:0,hatchWaves:1,timestamp:1700000000000};
    const system=structuredClone(e.system);system.eggs=[egg];await e.io.writeSystem(system);await e.data.loadSystem({readOnly:true});
    await e.data.applyCoopResults([{id:'egg-start',seat:0,payload:{version:2,facts:[{kind:'session-start',eggs:[egg],starters:[]}]}}],e.binding);
    const progress={id:'progress',seat:0,payload:{version:2,facts:[{kind:'egg-progress',owner:0,before:[egg],after:[{...egg,hatchWaves:0}]}]}};
    await e.data.applyCoopResults([progress],e.binding);
    let p=await e.repo.read(e.profileId);assert.equal(p.originalSystem.eggs[0].hatchWaves,0);assert.equal(p.deferredHatches[0].state,'waiting-terminal');
    assert.equal(await api.withOriginalRules(e.runtime.context,()=>e.data.prepareDeferredHatch()),null);
    const once=structuredClone(p);await e.data.applyCoopResults([progress],e.binding);assert.deepEqual(await e.repo.read(e.profileId),once);
    const full={...egg,hatchWaves:0};
    await e.data.applyCoopResults([{id:'stay-full',seat:0,payload:{version:2,facts:[{kind:'egg-progress',owner:0,before:[full],after:[full]}]}}],e.binding);
    await e.data.applyCoopResults([{id:'terminal',seat:0,payload:{version:2,facts:[{kind:'egg-terminal',owner:0,result:'defeat'}]}}],e.binding);
    p=await e.repo.read(e.profileId);assert.equal(p.deferredHatches[0].state,'released');
    const result=await api.withOriginalRules(e.runtime.context,()=>e.data.prepareDeferredHatch());assert.ok(result);p=await e.repo.read(e.profileId);
    assert.equal(p.schemaVersion,2);assert.equal(p.originalSystem.eggs.length,0);assert.equal(p.deferredHatches.length,0);
    assert.equal(p.originalSystem.gameStats.pokemonHatched,1);assert.equal(p.hatchResults.length,1);
    assert.deepEqual(await api.withOriginalRules(e.runtime.context,()=>e.data.prepareDeferredHatch()),result);assert.equal((await e.repo.read(e.profileId)).originalSystem.gameStats.pokemonHatched,1);
    await e.data.closeProfile();
    const io=await openGameProfileIO(e.repo,e.profileId,{mode:'home'}),restored=original();restored.data.bindProfileIO(io);
    try{await restored.data.loadSystem({readOnly:true});assert.deepEqual(await api.withOriginalRules(restored.runtime.context,()=>restored.data.prepareDeferredHatch()),result);
      await restored.data.acknowledgeHatch(result.id);await restored.data.acknowledgeHatch(result.id);
      assert.equal((await e.repo.read(e.profileId)).hatchResults.length,0);
    }finally{await restored.data.closeProfile();}
  }finally{await e.data.closeProfile();}
});


test('real Host/Worker egg phase defers both owners and survives formal disk failure plus missing grant ACK',async()=>{
  const players=[await writer(0),await writer(1)];
  const adapter=createPlayerHostAdapter({seedFactory:()=> 'egg-worker-recovery'});
  let env;
  try{
    for(const [seat,p] of players.entries()){
      const system=structuredClone(p.system);system.eggs=[{id:12345+seat,gachaType:seat,hatchWaves:1,timestamp:1700000000000}];
      await p.io.writeSystem(system);await p.data.loadSystem({readOnly:true});
    }
    const catalogs=players.map(p=>api.captureRoomCatalog(p.data)),union=api.mergeRoomCatalogs(catalogs);
    let context=await adapter.createInitialContext({runId:'egg-run'}),startGrants=[];
    for(const [seat,ids,ready] of [[0,[],false],[1,[],false],[0,[1],false],[1,[4],false],[0,[1],true],[1,[4],true]]){
      const p=players[seat].data,view=api.roomSelectionData(p,union);
      const profile=api.captureProfileDraft(view,ids.map(id=>({species:api.getPokemonSpecies(id),dexAttr:149n,nature:view.getNaturesForAttr(view.dexData[id].natureAttr)[0],pokerus:false})),catalogs[seat]);
      const result=await adapter.advanceToDecision(context,{[seat]:{kind:ready?'profile-ready':'profile-draft',profile,ready}});
      context=result.context;startGrants.push(...result.grants);
    }
    // Explicit synthetic post-victory phase boundary; phase execution itself,
    // private egg projections and host durable grants use production rules.
    const c=api.originalDecisionStateCodec.restore(context.checkpoint);
    c.continuation={phaseQueue:[{kind:'original-phase',phaseId:0,phase:new api.EggLapsePhase({}),remaining:'start'}],
      phaseQueuePrepend:[],nextCommandPhaseQueue:[],currentPhase:null,standbyPhase:null,phaseQueuePrependSpliceIndex:-1};
    c.decision={id:'egg-boundary',kind:'continuing',requiredSeats:[],reason:'effects'};
    context.checkpoint=api.originalDecisionStateCodec.capture(c);
    const initial=structuredClone(context),wrapped={...adapter,createInitialContext:({runId})=>({...structuredClone(initial),runId})};
    const store={data:new Map(),fail:true,async load(){return [...this.data.values()].map(v=>structuredClone(v));},async save(room){if(this.fail&&room.revision===1)throw Error('disk');this.data.set(room.roomId,structuredClone(room));}};
    env=await formalFixture(wrapped,store);let pair=[await env.client(),await env.client()];
    pair[0].send({type:'createRoom',name:'A'});let a=await pair[0].wait(m=>m.type==='welcome');
    pair[1].send({type:'joinRoom',roomId:a.roomId,name:'B'});let b=await pair[1].wait(m=>m.type==='welcome');
    const identities=[a,b];let snapshots=await Promise.all(pair.map(p=>p.wait(m=>m.type==='snapshot')));
    for(const [seat,p] of players.entries())await p.data.applyCoopResults(startGrants.filter(g=>g.seat===seat),{...p.binding,runId:snapshots[seat].runId,roomId:a.roomId,token:identities[seat].resumeToken});
    // Use the real snapshot consumer to compute the projection digest.
    let drop=true;
    const consume=()=>pair.map((client,seat)=>{const model=api.createOriginalClientModel(api);return createSnapshotConsumer({versions:env.versions,isCurrent:()=>true,
      send:m=>{if(!(drop&&seat===1&&m.type==='grantAck'))client.send(m);},adapter:{applySnapshot:s=>model.applySnapshot(s),captureAppliedState:()=>model.captureAppliedState(),
        applyGrantsTransaction:g=>players[seat].data.applyCoopResults(g,{...players[seat].binding,runId:snapshots[seat].runId,roomId:a.roomId,token:identities[seat].resumeToken})}});});
    let consumers=consume();await Promise.all(snapshots.map((s,i)=>consumers[i](s)));
    await pair[1].wait(m=>m.type==='error'&&m.code==='STORAGE_FAILED');
    assert.equal(store.data.get(a.roomId).revision,0);assert.equal(store.data.get(a.roomId).checkpoint.nativeCheckpoint.eggState.players[0][0].hatchWaves,1);
    await env.close();await adapter.closeAll();store.fail=false;env=await formalFixture(wrapped,store);
    pair=[await env.client(),await env.client()];pair.forEach((p,seat)=>p.send({type:'resumeSeat',roomId:a.roomId,resumeToken:identities[seat].resumeToken}));
    snapshots=await Promise.all(pair.map(p=>p.wait(m=>m.type==='snapshot')));consumers=consume();
    await Promise.all(snapshots.map((s,i)=>consumers[i](s)));
    snapshots=await Promise.all(pair.map(p=>p.wait(m=>m.type==='snapshot'&&m.revision===1)));
    assert.ok(snapshots.every(s=>s.grants.some(g=>g.payload.facts.some(f=>f.kind==='egg-progress'))));
    await Promise.all(snapshots.map((s,i)=>consumers[i](s)));
    const saved=await players[1].repo.read(players[1].profileId);assert.equal(saved.originalSystem.eggs[0].hatchWaves,0);assert.equal(saved.deferredHatches[0].state,'waiting-terminal');
    drop=false;await consumers[1](snapshots[1]);assert.deepEqual(await players[1].repo.read(players[1].profileId),saved);
    assert.ok(!JSON.stringify(snapshots[0]).includes('12346'),'peer egg IDs remain private');
  }finally{await env?.close();await adapter.closeAll();for(const p of players)await p.data.closeProfile();}
});


test('original shared reward voucher is applied only to its claimant through durable personal results',async()=>{
  const {createOriginalRuleHost}=await import('../server/original-rule-host.mjs');
  const host=await createOriginalRuleHost({seed:'egg-voucher-reward',identity:{trainerId:1,secretId:2},deferEggs:true}),e=await writer();
  try{
    const opened=await host.request('native-open-to-input',{parties:[[1,7,909],[4,7,906]],eggState:{players:[[],[]]}});
    const c=api.originalDecisionStateCodec.restore(opened.checkpoint);
    for(const entry of c.roster.entries)if(entry.owner===null){entry.pokemon.hp=0;entry.pokemon.status=new api.Status(api.StatusEffect.FAINT);}
    c.continuation={phaseQueue:[{kind:'original-phase',phaseId:0,phase:new api.SelectModifierPhase({}),remaining:'start'}],
      phaseQueuePrepend:[],nextCommandPhaseQueue:[],currentPhase:null,standbyPhase:null,phaseQueuePrependSpliceIndex:-1};
    c.decision={id:'voucher-boundary',kind:'continuing',requiredSeats:[],reason:'effects'};
    const checkpoint=(await host.request('native-preparation-shared',api.originalDecisionStateCodec.capture(c))).checkpoint;
    const type=api.captureModifierTypeState(api.modifierTypes.VOUCHER().withIdFromFunc(api.modifierTypes.VOUCHER));
    for(const row of checkpoint.decision.players)row.rewards[0].type=structuredClone(type);
    const optionId=checkpoint.decision.players[0].rewards[0].id;
    const result=await host.request('native-prepare-action',{checkpoint,seat:0,action:{kind:'preparation',operation:'reward',optionId,pokemonId:null,moveIndex:null,fusionId:null}});
    const fact=result.intents.find(f=>f.kind==='voucher-item');assert.equal(fact?.owner,0);assert.equal(fact.catalogId,'VOUCHER');
    assert.ok(result.checkpoint.decision.shared.rewardClaims.some(c=>c.optionId===optionId&&c.seat===0));
    const g={id:'voucher-item-claim',seat:0,payload:{version:2,facts:[fact]}};
    await e.data.applyCoopResults([g],e.binding);await e.data.applyCoopResults([g],e.binding);
    assert.equal((await e.repo.read(e.profileId)).originalSystem.voucherCounts[0],e.system.voucherCounts[0]+1);
  }finally{await host.close();await e.data.closeProfile();}
});


test('SQLite hatch failure retains the egg and fixed staged result; reopen keeps rewards and interrupted presentation once',async()=>{
  const root=resolve('build/code-review/egg-sqlite');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));let failing=false;
  let db=openDesktopStorage(dir,{beforeCommit:op=>{if(failing&&op==='commit')throw Error('INJECTED_EGG_DISK_FAILURE');}});
  const empty=Object.fromEntries(STORAGE_SCOPES.map(scope=>[scope,{}]));db.initialize(empty,bundleDigest(empty));
  const wrap=fn=>{try{return {ok:true,value:fn()};}catch(e){return {ok:false,code:e.message};}};
  const bridge={storageVersion:1,storageStatus:()=>wrap(()=>db.status()),storageSnapshot:r=>wrap(()=>db.snapshot(r.scope,r.keys)),storageCommit:r=>wrap(()=>db.commit(r))};
  const e=await writer(0,createNativeStore('meta',bridge));
  try{
    const egg={id:12346,gachaType:2,hatchWaves:1,timestamp:1700000000001},system=structuredClone(e.system);system.eggs=[egg];
    await e.io.writeSystem(system);await e.data.loadSystem({readOnly:true});
    await e.data.applyCoopResults([{id:'sql-start',seat:0,payload:{version:2,facts:[{kind:'session-start',starters:[],eggs:[egg]}]}}],e.binding);
    await assert.rejects(openGameProfileIO(e.repo,e.profileId,{mode:'solo'}),/LOCAL_EGGS_RESERVED/);
    await assert.rejects(e.io.writeSystem({...system,eggs:[]}),/LOCAL_EGGS_RESERVED/);
    await e.data.applyCoopResults([{id:'sql-end',seat:0,payload:{version:2,facts:[{kind:'egg-progress',owner:0,before:[egg],after:[{...egg,hatchWaves:0}]},{kind:'egg-terminal',owner:0,result:'victory'}]}}],e.binding);
    const before=await e.repo.read(e.profileId);failing=true;
    await assert.rejects(api.withOriginalRules(e.runtime.context,()=>e.data.prepareDeferredHatch()),/INJECTED_EGG_DISK_FAILURE/);
    assert.deepEqual(await e.repo.read(e.profileId),before);const staged=structuredClone(e.data.pendingEggOperation.result);
    failing=false;const result=await api.withOriginalRules(e.runtime.context,()=>e.data.prepareDeferredHatch());assert.deepEqual(result,staged);
    const committed=await e.repo.read(e.profileId);assert.equal(committed.originalSystem.gameStats.pokemonHatched,1);
    await e.data.closeProfile();db.close();db=openDesktopStorage(dir);
    const io=await openGameProfileIO(e.repo,e.profileId,{mode:'home'});assert.deepEqual(io.profile.hatchResults,[staged]);
    await io.acknowledgeHatch(staged.id);await io.close();assert.equal((await e.repo.read(e.profileId)).originalSystem.gameStats.pokemonHatched,1);
  }finally{failing=false;e.io.invalidate();db.close();}
});
