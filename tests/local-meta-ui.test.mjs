import test,{before,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {createRequire,isBuiltin} from 'node:module';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {openGameProfileIO} from '../src/local-meta/game-io.mjs';
import {createProfileRepository} from '../src/local-meta/repository.mjs';
import {createMetaStore} from '../src/local-meta/idb-store.mjs';
import {createMetaCodec} from '../src/local-meta/codec.mjs';
import {digest} from '../src/local-meta/codec.mjs';

let api,base,dom;const factory=new IDBFactory();
function globals(){
  dom=new JSDOM('<body></body>',{url:'http://localhost:8033/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,indexedDB:factory,
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    location:{origin:'http://localhost:8033',search:'',assign(){}}});
}
before(async()=>{
  globals();
  await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[
    {find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
    {find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')}
  ]},ssr:{noExternal:true},build:{ssr:resolve('tests/fixtures/local-meta-ui-entry.mjs'),
    outDir:resolve('build/local-meta-03/ui'),emptyOutDir:true,minify:false,
    rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
  api=createRequire(import.meta.url)('../build/local-meta-03/ui/entry.cjs');
  api.describeOriginalCatalogs();base=await api.originalFixture();
});
beforeEach(async()=>{
  dom?.window.close();globals();
  for(const name of ['pokerogue-local-meta','coop-play-v1'])await new Promise((resolve,reject)=>{
    const q=factory.deleteDatabase(name);q.onsuccess=resolve;q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('TEST_DB_STILL_OPEN'));
  });
  await api.mutateLocalSaves(['data','sessionData','sessionData1','sessionData2'],()=>({
    data:JSON.stringify(base.system),sessionData:null,sessionData1:null,sessionData2:null}));
});
async function until(predicate){for(let i=0;i<500;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI_WAIT_TIMEOUT');}
function home(t){
  const runtime=api.createOriginalRuntime('local-meta-ui',{trainerId:1,secretId:2}),modes=[],texts=[],assigned=[];
  const scene={game:{config:{gameVersion:'1.0.0'}},gameData:{untouched:true},events:{once(){}},fadeOutBgm(){},playBgm(){},
    executeWithSeedOffset:(fn,offset,seed)=>api.withOriginalRules(runtime.context,()=>runtime.scene.executeWithSeedOffset(fn,offset,seed)),
    ui:{fadeIn(){},clearText(){},showText(text){texts.push(text);},setMode:async(...args)=>{modes.push(args);}}};
  location.assign=url=>assigned.push(url);
  const p=new api.HomePhase(scene);p.start();t.after(()=>p.dispose());
  return {p,scene,modes,texts,assigned,last:()=>modes.at(-1),options:()=>modes.at(-1)?.[1]?.options};
}
async function writer(t,pid,options={}){
  const io=await openGameProfileIO(api.profileRepository(),pid,options);t.after(()=>{io.invalidate();});return io;
}
async function created(name='小智'){const r=api.profileRepository(),p=await r.create(base.system,{displayName:name});return {r,p};}
function game(io){
  const runtime=api.createOriginalRuntime('bound-solo',{trainerId:12,secretId:34}),scene=runtime.scene;
  scene.game={config:{gameVersion:'1.0.0'}};
  scene.trainer={texture:{key:'trainer_m'},setTexture(){}};
  const data=api.withOriginalRules(runtime.context,()=>new api.GameData(scene,{skipSettings:true}));
  scene.gameData=data;data.bindProfileIO(io);scene.sessionSlotId=0;scene.initializeRunResources();scene.sessionPlayTime=0;
  scene.party=[api.constructOriginalPokemon(runtime,1,5)];
  scene.currentBattle={waveIndex:1,battleType:0,enemyParty:[api.constructOriginalPokemon(runtime,4,5,true)]};
  return {runtime,scene,data};
}

test('home exposes profile management using original title; cancelled or obsolete name callbacks never create data',async t=>{
  const h=home(t);await until(()=>h.options()?.some(o=>o.label.includes('档案')));
  h.options().find(o=>o.label.includes('档案')).handler();await until(()=>h.options()?.some(o=>o.label==='创建新档案'));
  h.options().find(o=>o.label==='创建新档案').handler();await until(()=>h.last()?.[0]===api.Mode.PROFILE_FORM);
  const form=h.last()[1];form.onCancel();await until(()=>h.last()?.[0]===api.Mode.TITLE);
  form.onSubmit('迟到名字');await new Promise(r=>setTimeout(r,30));
  assert.deepEqual((await api.profileRepository().list()).profiles,[]);
});
test('new profile uses original initialization once, becomes active, and solo route carries its identity',async t=>{
  const h=home(t);await h.p.showProfiles();await h.p.transitions;
  h.options().find(o=>o.label==='创建新档案').handler();await until(()=>h.last()?.[0]===api.Mode.PROFILE_FORM);
  const form=h.last()[1];form.onSubmit('小霞');form.onSubmit('重复提交');
  await until(async()=> (await api.profileRepository().list()).profiles.length===1);
  await until(()=>h.options()?.[0]?.label==='单人冒险');
  const index=await api.profileRepository().list(),p=await api.profileRepository().read(index.activeProfileId);
  assert.equal(p.displayName,'小霞');assert.equal(BigInt(p.originalSystem.dexData[1].caughtAttr),149n);
  assert.equal(p.originalSystem.eggs.length,0);assert.equal(p.soloRuns.length,0);
  assert.deepEqual(h.scene.gameData,{untouched:true});assert.deepEqual(JSON.parse(await api.readLocalSave('data')),base.system);
  h.options()[0].handler();assert.equal(h.assigned[0],`/?solo=1&profile=${p.profileId}`);
});
test('three-slot migration preview/cancel is read-only and accepted slots require explicit ownership confirmation',async t=>{
  await api.mutateLocalSaves(['sessionData','sessionData1','sessionData2'],()=>({sessionData:JSON.stringify(base.session),
    sessionData1:JSON.stringify({...base.session,waveIndex:8}),sessionData2:JSON.stringify({...base.session,waveIndex:19})}));
  const old=await api.captureLegacySource(localStorage),h=home(t);await h.p.previewMigration();
  assert.equal(h.options().filter(o=>o.label.startsWith('旧槽位')).length,3);
  assert.equal((await api.profileRepository().list()).profiles.length,0);
  h.options().find(o=>o.label.startsWith('导入并使用')).handler();await until(()=>h.last()[0]===api.Mode.CONFIRM);
  h.last()[2]();await until(()=>h.last()[0]===api.Mode.TITLE);
  assert.equal((await api.profileRepository().list()).profiles.length,0);
  await h.p.previewMigration();h.options().find(o=>o.label.startsWith('导入并使用')).handler();await until(()=>h.last()[0]===api.Mode.CONFIRM);
  h.last()[1]();await until(async()=> (await api.profileRepository().list()).profiles.length===1);
  const index=await api.profileRepository().list(),pid=index.profiles[0].profileId;
  await assert.rejects(openGameProfileIO(api.profileRepository(),pid),/OWNERSHIP_REQUIRED/);
  await h.p.confirmSlots(pid);await h.p.transitions;h.last()[1]();
  await until(async()=> (await api.profileRepository().read(pid)).soloRuns.every(r=>r.ownership==='confirmed'));
  assert.deepEqual(await api.captureLegacySource(localStorage),old);
  const io=await writer(t,pid),g=game(io);assert.equal(await g.data.loadSystem(),true);
  assert.equal((await g.data.getSession(2)).waveIndex,19);
  assert.deepEqual((await api.captureLegacySource(localStorage)).records,old.records);
  assert.equal(JSON.parse(localStorage.getItem('settings')).PLAYER_GENDER,0);
});
test('real GameData writes collection and session together, reopens both and never writes old data or another profile',async t=>{
  const {r,p}=await created(),other=await r.create({...base.system,trainerId:77});
  const legacy=await api.readLocalSave('data'),io=await writer(t,p.profileId),g=game(io);
  await g.data.loadSystem();g.data.gameStats.battles=7;g.scene.currentBattle.waveIndex=12;
  assert.equal(await g.data.saveEncounter(g.scene),true);
  const saved=await r.read(p.profileId);assert.equal(saved.originalSystem.gameStats.battles,7);assert.equal(saved.soloRuns[0].originalSession.waveIndex,12);
  const readonly=await writer(t,p.profileId,{readOnly:true}),next=game(readonly);assert.equal(await next.data.loadSystem(),true);
  assert.equal(next.data.gameStats.battles,7);assert.equal((await next.data.getSession(0)).waveIndex,12);
  assert.equal(await api.readLocalSave('data'),legacy);assert.deepEqual((await r.read(other.profileId)).originalSystem,other.originalSystem);
});
test('write failure cannot commit half an encounter and an exact retry saves both original snapshots',async t=>{
  const {r,p}=await created(),store=createMetaStore({indexedDB:factory});let fail=false;
  const repo=createProfileRepository({codec:createMetaCodec(api.originalSaveCodec),store:{read:store.read,
    transact:(keys,fn)=>store.transact(keys,records=>{const result=fn(records);if(fail&&keys.includes('index'))throw Error('SYNTHETIC_DISK_FAILURE');return result;})}});
  const io=await openGameProfileIO(repo,p.profileId);t.after(()=>io.invalidate());const g=game(io);await g.data.loadSystem();
  fail=true;
  g.data.gameStats.battles=11;g.scene.currentBattle.waveIndex=9;
  assert.equal(await g.data.saveEncounter(g.scene),false);assert.deepEqual(await r.read(p.profileId),p);
  fail=false;assert.equal(await g.data.saveEncounter(g.scene),true);const saved=await r.read(p.profileId);
  assert.equal(saved.originalSystem.gameStats.battles,11);assert.equal(saved.soloRuns[0].originalSession.waveIndex,9);
});
test('terminal clear remains pending until the same transaction saves victory statistics',async t=>{
  const {r,p}=await created(),io=await writer(t,p.profileId),g=game(io);await g.data.loadSystem();await g.data.saveEncounter(g.scene);
  assert.deepEqual(await g.data.tryClearSession(g.scene,0),[true,true]);
  assert.equal((await r.read(p.profileId)).soloRuns.length,1);
  g.data.gameStats.sessionsWon=1;assert.equal(await g.data.saveSystem(),true);
  const saved=await r.read(p.profileId);assert.equal(saved.soloRuns.length,0);assert.equal(saved.originalSystem.gameStats.sessionsWon,1);
  assert.equal(await g.data.getSession(0),null);
});

test('terminal clear cannot be consumed by original system saves queued before the victory statistics',async t=>{
  const {r,p}=await created(),io=await writer(t,p.profileId),g=game(io);await g.data.loadSystem();await g.data.saveEncounter(g.scene);
  g.data.gameStats.battles=12;const first=g.data.saveSystem();
  g.data.gameStats.battles=13;const second=g.data.saveSystem();
  const clearing=g.data.tryClearSession(g.scene,0);await Promise.all([first,second,clearing]);
  assert.equal((await r.read(p.profileId)).soloRuns.length,1,'queued pre-terminal snapshots must not delete the adventure');
  g.data.gameStats.sessionsWon=1;assert.equal(await g.data.saveSystem(),true);
  const saved=await r.read(p.profileId);assert.equal(saved.soloRuns.length,0);assert.equal(saved.originalSystem.gameStats.sessionsWon,1);
});
test('stale callbacks after invalidation cannot write, and the lost page cannot overwrite another active profile',async t=>{
  const {r,p}=await created(),other=await r.create({...base.system,trainerId:99}),io=await writer(t,p.profileId),g=game(io);await g.data.loadSystem();
  io.invalidate();g.data.gameStats.battles=999;assert.equal(await g.data.saveSystem(),false);
  assert.deepEqual((await r.read(p.profileId)).originalSystem,p.originalSystem);assert.deepEqual((await r.read(other.profileId)).originalSystem,other.originalSystem);
});

test('return waits for GameData queued writes before releasing its profile and blocks late saves',async t=>{
  const {r,p}=await created(),io=await writer(t,p.profileId),g=game(io);await g.data.loadSystem();
  g.data.gameStats.battles=23;g.scene.currentBattle.waveIndex=4;
  const saving=g.data.saveEncounter(g.scene),closing=g.data.closeProfile();
  g.data.gameStats.battles=99;
  assert.equal(await g.data.saveSystem(),false);
  assert.equal(await saving,true);await closing;
  const saved=await r.read(p.profileId);assert.equal(saved.originalSystem.gameStats.battles,23);
  assert.equal(saved.soloRuns[0].originalSession.waveIndex,4);
  const next=await openGameProfileIO(r,p.profileId);await next.close();
});

for(const kind of ['system','session'])test(`legacy ${kind} verification already in flight is drained before a new scene can open`,async()=>{
  const g=game(null);await g.data.loadSystem();let verify;
  g.data.refreshUserInfo=()=>new Promise(resolve=>{verify=resolve;});
  g.data.gameStats.battles=41;g.scene.currentBattle.waveIndex=7;
  const saving=kind==='system'?g.data.saveSystem():g.data.saveSession(g.scene),closing=g.data.closeProfile();
  let closed=false;void closing.then(()=>closed=true);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(closed,false);verify(true);assert.equal(await saving,true);await closing;
  const saved=JSON.parse(await api.readLocalSave(kind==='system'?'data':'sessionData'));
  assert.equal(kind==='system'?saved.gameStats.battles:saved.waveIndex,kind==='system'?41:7);
  assert.equal(await g.data.saveSystem(),false);
});

test('terminal disk failure preserves slot and statistics until a successful retry; failed return stays recoverable',async t=>{
  const {r,p}=await created(),store=createMetaStore({indexedDB:factory});let fail=false;
  const repo=createProfileRepository({codec:createMetaCodec(api.originalSaveCodec),store:{read:store.read,
    transact:(keys,fn)=>store.transact(keys,records=>{const result=fn(records);if(fail&&keys.includes('index'))throw Error('SYNTHETIC_DISK_FAILURE');return result;})}});
  const io=await openGameProfileIO(repo,p.profileId);t.after(()=>io.invalidate());const g=game(io);await g.data.loadSystem();
  assert.equal(await g.data.saveEncounter(g.scene),true);const before=await r.read(p.profileId);
  await g.data.tryClearSession(g.scene,0);g.data.gameStats.sessionsWon=1;fail=true;
  assert.equal(await g.data.saveSystem(),false);assert.deepEqual(await r.read(p.profileId),before);
  await assert.rejects(g.data.closeProfile(),/SYNTHETIC_DISK_FAILURE/);
  fail=false;assert.equal(await g.data.saveSystem(),true);await g.data.closeProfile();
  const saved=await r.read(p.profileId);assert.equal(saved.soloRuns.length,0);assert.equal(saved.originalSystem.gameStats.sessionsWon,1);
});
test('selected profile binding is used by login preparation, prevents a second writer and leaves an escape on failure',async t=>{
  location.search='?profile=missing-profile';
  await assert.rejects(api.prepareProfileGameData({gameData:{}}),/LOCAL_PROFILE_CHANGED/);
  location.search='';
  const {r,p}=await created();await r.setActive(p.profileId);const h=home(t);
  const runtime=api.createOriginalRuntime('profile-login',{trainerId:12,secretId:34});
  h.scene.trainer={texture:{key:'trainer_m'},setTexture(){}};
  h.scene.gameData=api.withOriginalRules(runtime.context,()=>new api.GameData(h.scene,{skipSettings:true}));
  await api.prepareProfileGameData(h.scene);t.after(()=>h.scene.gameData.closeProfile());
  assert.equal(h.scene.gameData.localProfileId,p.profileId);assert.equal(await h.scene.gameData.loadSystem(),true);
  await h.scene.gameData.refreshUserInfo();assert.equal(api.loggedInUser.username,'小智');
  await assert.rejects(openGameProfileIO(r,p.profileId),/WRITER_BUSY/);
  assert.ok(document.getElementById('local-profile-return'));
});
test('read-only collection view reads active profile without acquiring its writer or changing counters',async t=>{
  const {r,p}=await created();await r.setActive(p.profileId);const io=await writer(t,p.profileId),before=await r.read(p.profileId),h=home(t);
  await h.p.showHome();await h.p.browse(api.Mode.STARTER_SELECT);
  assert.equal(h.last()[0],api.Mode.STARTER_SELECT);assert.equal(h.scene.gameData.localProfileId,p.profileId);
  assert.equal(h.scene.gameData.trainerId,base.system.trainerId);assert.equal(await h.scene.gameData.saveSystem(),false);
  assert.deepEqual(await r.read(p.profileId),before);await io.close();
});

test('coop capture, solo capture and home dex reopen the same personal System in both directions',async t=>{
  const {r,p}=await created();await r.setActive(p.profileId);
  const coop=game(await writer(t,p.profileId,{mode:'coop'}));await coop.data.loadSystem();
  coop.scene.ui={showText:(_text,_delay,callback)=>callback?.(),achvBar:{showAchv(){}}};coop.scene.playSoundWithoutBgm=()=>{};
  const pikachu=api.constructOriginalPokemon(coop.runtime,25,5);
  await coop.data.applyCoopResults([{id:'shared-dex-proof',seat:0,payload:{version:1,facts:[{kind:'capture-pending',owner:0,
    speciesId:25,dexAttr:pikachu.getDexAttr().toString(),pokemon:api.capturePokemonState(pikachu)}]}}],
    {hostId:'test-host',runId:'test-run',roomId:'ABCDEF',seat:0,profileId:p.profileId,token:'synthetic',isCurrent:()=>true});
  await coop.data.closeProfile();
  const solo=game(await writer(t,p.profileId));await solo.data.loadSystem();
  assert.ok(solo.data.dexData[25].caughtAttr);assert.ok(solo.data.dexData[25].caughtCount>0);
  solo.scene.ui={showText:(_text,_delay,callback)=>callback?.(),achvBar:{showAchv(){}}};solo.scene.playSoundWithoutBgm=()=>{};
  const eevee=api.constructOriginalPokemon(solo.runtime,133,5);
  await solo.data.setPokemonCaught(eevee);solo.data.updateSpeciesDexIvs(133,eevee.ivs);
  assert.equal(await solo.data.saveEncounter(solo.scene),true);await solo.data.closeProfile();
  const next=game(await writer(t,p.profileId,{mode:'coop'}));await next.data.loadSystem();
  assert.ok(next.data.dexData[25].caughtAttr);assert.ok(next.data.dexData[133].caughtAttr);
  const catalog=api.captureRoomCatalog(next.data);assert.ok(catalog.some(row=>row.speciesId===133));
  const selection={species:api.getPokemonSpecies(133),dexAttr:next.data.getSpeciesDefaultDexAttr(api.getPokemonSpecies(133)),
    nature:next.data.getSpeciesDefaultNature(api.getPokemonSpecies(133)),pokerus:false};
  assert.equal(api.captureProfileDraft(next.data,[selection],catalog).starters[0].speciesId,133);
  await next.data.closeProfile();
  const before=await r.read(p.profileId),h=home(t);await h.p.showHome();await h.p.browse(api.Mode.STARTER_SELECT);
  assert.ok(h.scene.gameData.dexData[25].caughtAttr);assert.ok(h.scene.gameData.dexData[133].caughtAttr);
  assert.equal(before.grantLedger.length,1);assert.equal(before.soloRuns.length,1);
  assert.deepEqual(await r.read(p.profileId),before);
});

test('home routes dex and original personal screens directly; profile slots use original view-only cards',async t=>{
  const {r,p}=await created();await r.setActive(p.profileId);const h=home(t);
  await h.p.showHome();assert.ok(h.options().some(o=>o.label==='宝可梦图鉴'));
  await h.p.showPersonal();assert.deepEqual(h.options().slice(0,4).map(o=>o.label),['我的未孵化蛋','我的蛋券','成就','游戏统计']);
  for(const mode of [api.Mode.ACHIEVEMENTS,api.Mode.GAME_STATS]){
    await h.p.browse(mode);assert.equal(h.last()[0],mode);assert.equal(typeof h.last()[1].onCancel,'function');
    h.last()[1].onCancel();await h.p.transitions;
  }
  await h.p.showProfile(p.profileId);assert.ok(h.options().some(o=>o.label==='冒险存档（3个槽位）'));
  const before=await r.read(p.profileId);await h.p.browseSaveSlots(p.profileId);
  assert.equal(h.last()[0],api.Mode.SAVE_SLOT);assert.equal(h.last()[1],api.SaveSlotUiMode.VIEW);
  assert.equal(h.scene.gameData.localProfileId,p.profileId);assert.equal(await h.scene.gameData.saveSystem(),false);
  h.last()[2](-1);await h.p.transitions;assert.deepEqual(await r.read(p.profileId),before);
});

test('original slot viewer cannot load or overwrite a slot and its cancel callback is consumed once',()=>{
  const events=[],handler=Object.assign(Object.create(api.SaveSlotSelectUiHandler.prototype),{
    scene:{ui:{playSelect(){},playError(){},setMode(){throw Error('MUST_NOT_START_ADVENTURE');}}},
    uiMode:api.SaveSlotUiMode.VIEW,cursor:0,sessionSlots:[{loaded:true,hasData:true}],saveSlotSelectCallback:slot=>events.push(slot)});
  assert.equal(handler.processInput(api.Button.ACTION),false);
  assert.deepEqual(events,[]);
  // Use the enum exported by the production battle scene, not synthetic writes.
  handler.processInput(api.Button.CANCEL);handler.processInput(api.Button.CANCEL);
  assert.deepEqual(events,[-1]);
});

test('original achievement IDs keep their meaning while all personal-page names and descriptions display in Chinese',async()=>{
  const previous=api.i18next.language;await api.i18next.changeLanguage('zh-Hans');
  try{
    let name='',description='';const text={setText(){}};
    const handler=Object.assign(Object.create(api.AchvsUiHandler.prototype),{scene:{gameData:{achvUnlocks:Object.fromEntries(Object.keys(api.achvs).map(id=>[id,1]))}},
      titleText:{setText:v=>{name=v;}},scoreText:text,unlockText:text,showText:v=>{description=v;}});
    for(const achv of Object.values(api.achvs)){
      handler.showAchv(achv);assert.match(name,/[\u4e00-\u9fff]/,achv.id);assert.match(description,/[\u4e00-\u9fff]/,achv.id);
      assert.equal(description.includes('{{'),false,achv.id);
    }
  }finally{await api.i18next.changeLanguage(previous);}
});
test('reserved cooperative eggs block solo entry but can still be viewed and imported without hatching',async t=>{
  const {r,p}=await created(),lease=await r.acquire(p.profileId,'test-owner');
  await r.save(p.profileId,0,lease,v=>({...v,originalSystem:{...v.originalSystem,eggs:[{id:123,gachaType:0,hatchWaves:0,timestamp:1}]},
    deferredHatches:[{sourceRunId:'coop1',eggId:123,eggTimestamp:1,state:'waiting-terminal',terminal:null}]}));await r.release(p.profileId,lease);
  await assert.rejects(openGameProfileIO(r,p.profileId),/EGGS_RESERVED/);
  const io=await writer(t,p.profileId,{mode:'coop'});assert.equal(io.profile.originalSystem.eggs.length,1);
  assert.equal(io.profile.deferredHatches[0].state,'waiting-terminal');
});
test('formal cooperative resume refuses credentials bound to another profile, and stores current profile on its seat',async t=>{
  const phase=new api.CoopPlayPhase({gameData:{localProfileId:'current'}});t.after(()=>phase.stopSession());
  location.search='?resumeRoom=ABCDEF&resumeSeat=0';const sent=[],statuses=[],writes=[];
  phase.send=value=>sent.push(value);phase.setStatus=(...value)=>statuses.push(value);
  phase.storage={resumeSession:async()=>({roomId:'ABCDEF',seat:0,token:'synthetic-seat',profileId:'other'}),saveSeat:async(...args)=>writes.push(args)};
  await phase.tryResume();assert.equal(sent.length,0);assert.match(statuses.at(-1)[0],/档案/);
  phase.roomId='ABCDEF';phase.seat=0;phase.token='synthetic-seat';await phase.persistSeat();assert.equal(writes[0][1].profileId,'current');
});
test('bad primary offers original backup recovery without creating a replacement profile',async t=>{
  const {r,p}=await created(),store=createMetaStore({indexedDB:factory});
  await store.transact([`profile:${p.profileId}`],()=>({changes:{[`profile:${p.profileId}`]:{broken:true}}}));
  const h=home(t);await h.p.showProfile(p.profileId);assert.ok(h.options().some(o=>o.label==='恢复备份'));
  await h.p.showBackups(p.profileId);h.options()[0].handler();await until(()=>h.last()[0]===api.Mode.CONFIRM);h.last()[1]();
  await until(async()=>{try{return (await r.read(p.profileId)).originalSystem.trainerId===12;}catch{return false;}});
  assert.equal((await r.list()).profiles.length,1);
});
test('whole-backup import uses original confirmation and late file callbacks cannot publish after return',async t=>{
  const {r,p}=await created(),archive=await r.exportArchive(p.profileId),h=home(t);
  let finish;const loading=h.p.importFile();const input=document.querySelector('input[type=file]');
  Object.defineProperty(input,'files',{value:[{name:'profile.json',size:100,text:()=>new Promise(resolve=>{finish=resolve;})}]});
  input.dispatchEvent(new window.Event('change'));await until(()=>typeof finish==='function');await h.p.showHome();finish(JSON.stringify(archive));await loading;
  assert.equal((await r.list()).profiles.length,1);assert.equal((await r.read(p.profileId)).revision,0);
});
test('original statistics reviver preserves separate mythical caught and hatched counters',async t=>{
  const {r,p}=await created(),lease=await r.acquire(p.profileId,'stats');
  await r.save(p.profileId,0,lease,v=>{v.originalSystem.gameStats.mythicalPokemonCaught=3;v.originalSystem.gameStats.mythicalPokemonHatched=7;return v;});await r.release(p.profileId,lease);
  const io=await writer(t,p.profileId),g=game(io);await g.data.loadSystem();
  assert.equal(g.data.gameStats.mythicalPokemonCaught,3);assert.equal(g.data.gameStats.mythicalPokemonHatched,7);
});
