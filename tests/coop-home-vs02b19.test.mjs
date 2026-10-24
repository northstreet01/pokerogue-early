import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,isBuiltin} from 'node:module';
import {resolve} from 'node:path';
import {build} from 'vite';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {createPlayStorage} from '../src/coop/play-storage.mjs';

let api;
const factory=new IDBFactory();
before(async()=>{
  await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[
    {find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
    {find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')}],},ssr:{noExternal:true},
    build:{ssr:resolve('tests/fixtures/coop-play-ui-entry.mjs'),outDir:resolve('build/coop-home-ui-test'),emptyOutDir:true,minify:false,
      rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
  api=createRequire(import.meta.url)('../build/coop-home-ui-test/entry.cjs');api.describeOriginalCatalogs();
});

test('root chooses the original home UI; direct solo and cooperative entry retain the original login paths',()=>{
  globalThis.location={origin:'http://localhost:8031'};
  assert.deepEqual(api.entryPhases({},false,false).map(p=>p.constructor),[api.HomePhase]);
  assert.deepEqual(api.entryPhases({},false,true).map(p=>p.constructor),[api.LoginPhase,api.TitlePhase]);
  assert.equal(api.entryPhases({},true,false).at(-1).constructor,api.CoopPlayPhase);
});

function home(t) {
  const dom = new JSDOM('<body></body>', {url:'http://localhost:8031/'});
  globalThis.document=dom.window.document; globalThis.indexedDB=factory;
  const assigned=[],modes=[];
  globalThis.location={origin:dom.window.location.origin,search:'',assign:url=>assigned.push(url)};
  globalThis.localStorage=dom.window.localStorage;globalThis.sessionStorage=dom.window.sessionStorage;
  const runtime=api.createOriginalRuntime('home-default',{trainerId:1,secretId:2});
  const scene={gameData:{unchanged:true},executeWithSeedOffset:(fn,offset,seed)=>api.withStarterRandomContext(runtime.context,()=>runtime.scene.executeWithSeedOffset(fn,offset,seed)),events:{once(){}},fadeOutBgm(){},ui:{fadeIn(){},clearText(){},
    setMode:async (...args)=>{modes.push(args);}}};
  const p=new api.HomePhase(scene);p.start();
  t.after(async()=>{p.dispose();dom.window.close();
    await new Promise((resolve,reject)=>{const q=factory.deleteDatabase('coop-play-v1');q.onsuccess=resolve;q.onerror=()=>reject(q.error);});
  });
  return {p,scene,assigned,modes};
}
async function settle(p) {await p.transitions;await new Promise(r=>setTimeout(r,10));await p.transitions;}

test('original Title callbacks route once, obsolete callbacks cannot navigate, return stays available',async t=>{
  const {p,assigned,modes}=home(t);await settle(p);
  const old=modes.at(-1)[1].options;
  await p.showHome();old[0].handler();assert.deepEqual(assigned,[]);
  const fresh=modes.at(-1)[1].options;fresh[1].handler();fresh[1].handler();
  assert.deepEqual(assigned,['/coop-play.html?fresh=1']);assert.equal(document.querySelector('#home-return'),null);
});

const keys=['data','sessionData','sessionData1','sessionData2','coop-profile-lease','coop-progression-v7','coop-progression-v6'];
async function rawRecords() {
  const db=await new Promise((resolve,reject)=>{const q=factory.open('pokerogue-early-local',1);
    q.onupgradeneeded=()=>q.result.createObjectStore('saves');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  const records=await new Promise((resolve,reject)=>{const out={},tx=db.transaction('saves');
    tx.objectStore('saves').openCursor().onsuccess=e=>{const c=e.target.result;if(c){out[c.key]=c.value;c.continue();}};
    tx.oncomplete=()=>resolve(out);tx.onabort=()=>reject(tx.error);});db.close();return records;
}
async function rawWrite(records={}) {
  const db=await new Promise(resolve=>{const q=factory.open('pokerogue-early-local',1);
    q.onupgradeneeded=()=>q.result.createObjectStore('saves');q.onsuccess=()=>resolve(q.result);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('saves','readwrite'),store=tx.objectStore('saves');store.clear();
    for(const [key,value] of Object.entries(records)) store.put(value,key);
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
}
function systemBytes(scene,{eggs=true}={}) {
  const gd=new api.GameData(scene,{readOnly:true});
  return JSON.stringify({trainerId:123,secretId:456,gender:2,dexData:gd.dexData,
    starterMoveData:{1:[33]},starterEggMoveData:{1:3},voucherCounts:{0:12,1:3,2:2,3:1},
    eggs:eggs?[new api.Egg(1,api.GachaType.SHINY,9,1700000000000)]:[],timestamp:1700000000000},
    (_key,value)=>typeof value==='bigint'?value.toString():value);
}
for (const modeName of ['STARTER_SELECT','EGG_LIST','EGG_GACHA'])
test(`personal ${modeName} uses original GameData/real IDB without writing any personal or solo resources`,async t=>{
  const {p,scene,modes,assigned}=home(t);await settle(p);
  const saved=Object.fromEntries(keys.map(key=>[key,{schema:1,value:key==='data'?systemBytes(scene):'{"preserved":true}',updatedAt:7}]));
  await rawWrite(saved);const before=await rawRecords(),live=scene.gameData;
  localStorage.setItem('settings','{"Player Gender":0}');localStorage.setItem('tutorials','{"kept":true}');
  const localBefore={...localStorage};
  await p.browse(api.Mode[modeName]);
  const call=modes.at(-1);assert.equal(call[0],api.Mode[modeName]);
  const options=call.at(-1);assert.equal(options.readOnly,true);
  assert.notEqual(scene.gameData,live);assert.ok(scene.gameData instanceof api.GameData);
  assert.equal(scene.gameData.trainerId,123);assert.equal(scene.gameData.secretId,456);
  assert.equal(scene.gameData.dexData[1].caughtAttr,149n);assert.equal(scene.gameData.starterEggMoveData[1],3);
  assert.ok(scene.gameData.eggs[0] instanceof api.Egg);assert.equal(scene.gameData.eggs[0].hatchWaves,9);
  assert.deepEqual(scene.gameData.voucherCounts,{0:12,1:3,2:2,3:1});
  assert.equal(await scene.gameData.saveSystem(),false);
  const oldReturn=options.onCancel;oldReturn();await settle(p);assert.equal(scene.gameData,live);
  const count=modes.length;oldReturn();await settle(p);assert.equal(modes.length,count);
  assert.deepEqual(await rawRecords(),before);assert.deepEqual({...localStorage},localBefore);
  assert.deepEqual(assigned,[]);
});

test('absent and corrupt personal data allow return/retry and preserve original record bytes',async t=>{
  const {p,scene,modes}=home(t);await settle(p);
  await rawWrite();await p.browse(api.Mode.EGG_LIST);
  assert.match(modes.at(-1)[1].options[0].label,/尚无个人资料/);assert.deepEqual(await rawRecords(),{});
  await rawWrite({data:{schema:1,value:'broken-json',updatedAt:17}});
  const before=await rawRecords(),live=scene.gameData;
  await p.browse(api.Mode.STARTER_SELECT);
  assert.match(modes.at(-1)[1].options[0].label,/读取失败/);assert.equal(scene.gameData,live);
  assert.deepEqual(await rawRecords(),before);
  await rawWrite({data:{schema:1,value:systemBytes(scene),updatedAt:18}});
  modes.at(-1)[1].options[0].handler();await settle(p);
  assert.equal(modes.at(-1)[0],api.Mode.STARTER_SELECT);
});

test('cancel during real IDB load cannot attach its data or cover a newer home screen',async t=>{
  const {p,scene,modes}=home(t);await settle(p);
  await rawWrite({data:{schema:1,value:systemBytes(scene),updatedAt:18}});
  const live=scene.gameData,browsing=p.browse(api.Mode.EGG_LIST);
  await p.transitions;document.querySelector('#home-return').click();
  await browsing;await settle(p);
  assert.equal(scene.gameData,live);assert.equal(modes.at(-1)[0],api.Mode.TITLE);
  assert.equal(modes.at(-1)[1].options[0].label,'单人冒险');
});

test('queued original UI transitions serialize and obsolete navigation stays inert after return',async t=>{
  const {p,scene,modes}=home(t);await settle(p);
  const old=modes.at(-1)[1].options;let finish;
  scene.ui.setMode=(...args)=>new Promise(resolve=>{modes.push(args);finish=resolve;});
  const pending=p.showPersonal();await new Promise(r=>setTimeout(r,0));
  const returning=p.showHome();old[0].handler();finish();await pending;
  await new Promise(r=>setTimeout(r,0));finish();await new Promise(r=>setTimeout(r,0));finish();await returning;
  assert.equal(modes.at(-1)[1].options[0].label,'单人冒险');
});

test('home Menu key uses its return path and never opens the solo save/gacha menu',async t=>{
  const {p,scene}=home(t);await settle(p);await p.showPersonal();
  scene.isButtonPressed=b=>b===api.Button.MENU;scene.getCurrentPhase=()=>p;
  scene.ui.getMode=()=>api.Mode.STARTER_SELECT;
  scene.ui.setOverlayMode=()=>assert.fail('home must not open the writable solo menu');
  api.BattleScene.prototype.checkInput.call(scene);await settle(p);
  assert.equal(p.originalData,undefined);
});

test('original solo Title keeps game/slot options and gains a root return',async t=>{
  const {scene,modes,p}=home(t);await settle(p);
  const before=await rawRecords();assert.equal(await api.updateUserInfo(),true);
  new api.TitlePhase(scene).showOptions();
  assert.equal(modes.at(-1)[0],api.Mode.TITLE);
  const options=modes.at(-1)[1].options;
  assert.ok(options.length>=3);assert.equal(options.at(-1).label,'返回初始界面');
  assert.deepEqual(scene.gameData,{unchanged:true});
  assert.deepEqual(await rawRecords(),before);
});

test('real original cooperative resume consumes the deliberate metadata route; fresh overrides even explicit recovery',async t=>{
  const {p:homePhase,scene}=home(t);await settle(homePhase);
  const store=createPlayStorage(),origin=location.origin,session={id:'previous',isCurrent:()=>true};
  await store.beginSession(origin,session);await store.saveSeat(origin,{roomId:'ABC123',seat:1,token:'kept-locally'},session);
  await store.pauseSession(origin,session);localStorage.setItem('coop-play-auto-resume-paused','1');
  const sent=[],p=new api.CoopPlayPhase(scene);p.send=m=>sent.push(m);p.setStatus=()=>{};
  location.search='?fresh=1&resumeRoom=ABC123&resumeSeat=1';await p.tryResume();
  assert.deepEqual(sent,[]);assert.equal(await store.loadSeat(origin),null);
  location.search='?resumeRoom=ABC123&resumeSeat=1';await p.tryResume();
  assert.deepEqual(sent,[{type:'resumeSeat',roomId:'ABC123',resumeToken:'kept-locally'}]);
  assert.equal(p.seat,1);assert.equal(localStorage.getItem('coop-play-auto-resume-paused'),null);
});

test('solo entry goes through original login and Title, without constructing a cooperative room',async t=>{
  const {p,assigned,modes,scene}=home(t);await settle(p);
  modes.at(-1)[1].options[0].handler();assert.deepEqual(assigned,['/?solo=1']);
  assert.deepEqual(scene.gameData,{unchanged:true});
});

test('real IDB conscious recovery lists own metadata only; paused seat and outbox stay paused until selection',async t=>{
  const {p,assigned,modes}=home(t);await settle(p);
  const store=createPlayStorage(),origin=location.origin,old={id:'old',isCurrent:()=>true};
  await store.beginSession(origin,old);
  await store.saveSeat(origin,{roomId:'ABC123',seat:0,token:'private-token',runId:'run'},old);
  await store.saveSeat('http://other',{roomId:'OTHER1',seat:1,token:'other-private'});
  const action={roomId:'ABC123',actionId:'action',expectedRevision:2};await store.saveAction(origin,0,action);
  await store.pauseSession(origin,old);
  assert.deepEqual(await store.listSeats(origin),[{roomId:'ABC123',seat:0}]);
  assert.equal(await store.loadSeat(origin),null);
  modes.at(-1)[1].options[2].handler();await settle(p);
  const options=modes.at(-1)[1].options;
  assert.ok(options[0].label.includes('ABC123'));options[0].handler();
  assert.deepEqual(assigned,['/coop-play.html?resumeRoom=ABC123&resumeSeat=0']);
  assert.equal(await store.loadSeat(origin),null);
  assert.equal(await store.resumeSession(origin,{id:'stale',isCurrent:()=>false},'ABC123',0),null);
  const session={id:'chosen',isCurrent:()=>true};
  assert.equal((await store.resumeSession(origin,session,'ABC123',0)).token,'private-token');
  assert.deepEqual(await store.pendingActions(origin,'ABC123',0),[action]);
  assert.deepEqual(await store.pendingActions(origin,'NEW123',0),[]);
});

function renderPort() {
  return {visible:false,text:'',setVisible(v){this.visible=v;return this;},setText(v){this.text=v;return this;},
    setFrame(v){this.frame=v;return this;},setScale(){return this;},setOrigin(){return this;},
    setPosition(){return this;},clearTint(){this.tint=null;},setTint(v){this.tint=v;},setInteractive(){},on(){},off(){}};
}
test('original readonly Starter opens, shows owned IVs, blocks add/start/move editing and tears down asset callback',async t=>{
  const {scene,p}=home(t);await settle(p);scene.ui.playSelect=()=>{};
  const gd=new api.GameData(scene,{readOnly:true});scene.gameData=gd;
  const h=new api.StarterSelectUiHandler(scene),species=api.getPokemonSpecies(1),ivCalls=[],icon=renderPort();
  Object.assign(h,{genSpecies:[[species]],starterSelectGenIconContainers:[{getAt:()=>icon}],
    startLabel:renderPort(),valueLimitLabel:renderPort(),starterSelectContainer:renderPort(),
    startCursorObj:renderPort(),pokemonSprite:renderPort(),statsContainer:{...renderPort(),updateIvs:ivs=>ivCalls.push(ivs)},
    starterGens:[],starterCursors:[],starterAttr:[],starterNatures:[],starterMovesets:[],
    setCursor(){},setGenMode(){},speciesStarterDexEntry:gd.dexData[1],genMode:false,statsMode:false});
  let submits=0,changes=0,cancels=0;
  assert.equal(h.show([()=>submits++,{readOnly:true,onChange:()=>changes++,onCancel:()=>cancels++}]),true);
  assert.equal(h.startLabel.visible,false);assert.equal(h.valueLimitLabel.visible,false);
  assert.equal(h.processInput(api.Button.ACTION),true);assert.equal(h.statsMode,true);
  assert.deepEqual(ivCalls[0],gd.dexData[1].ivs);
  assert.equal(h.processInput(api.Button.SUBMIT),false);assert.equal(h.tryStart(true),false);
  h.notifyStarterChange();assert.equal(changes,0);assert.equal(submits,0);assert.deepEqual(h.starterGens,[]);
  h.processInput(api.Button.CANCEL);h.processInput(api.Button.CANCEL);assert.equal(cancels,1);
  const cancelled={value:false};h.assetLoadCancelled=cancelled;h.clear();assert.equal(cancelled.value,true);
  assert.equal(h.processInput(api.Button.ACTION),false);assert.equal(h.tryStart(),false);
  gd.dexData[1].caughtAttr=0n;gd.dexData[1].seenAttr=0n;
  h.show([()=>submits++,{readOnly:true}]);assert.equal(icon.tint,0);h.clear();
});

test('original EggList handles empty and 99 owned eggs, navigation and return without any write',async t=>{
  const {scene,p}=home(t);await settle(p);scene.ui.bringToTop=()=>{};scene.ui.playSelect=()=>{};
  scene.gameData={eggs:[]};scene.add={sprite:()=>renderPort()};
  const icons=[];const h=new api.EggListUiHandler(scene);
  Object.assign(h,{eggListContainer:renderPort(),eggListIconContainer:{add:v=>icons.push(v),getAt:i=>icons[i],getAll:()=>icons,removeAll:()=>icons.splice(0)},
    iconAnimHandler:{addOrUpdate(){},removeAll(){}},cursorObj:renderPort(),eggSprite:renderPort(),
    eggNameText:renderPort(),eggDateText:renderPort(),eggHatchWavesText:renderPort(),eggGachaInfoText:renderPort(),cursor:-1});
  let returns=0;h.show([{onCancel:()=>returns++}]);
  assert.equal(h.eggSprite.visible,false);assert.match(h.eggNameText.text,/暂无/);
  for(const b of [api.Button.UP,api.Button.DOWN,api.Button.LEFT,api.Button.RIGHT])h.processInput(b);
  assert.equal(h.setCursor(0),false);h.processInput(api.Button.CANCEL);assert.equal(returns,1);h.clear();
  scene.gameData.eggs=Array.from({length:99},(_,i)=>new api.Egg(i+1,api.GachaType.SHINY,9,1700000000000));
  const before=JSON.stringify(scene.gameData.eggs);h.show([{onCancel:()=>returns++}]);
  assert.equal(icons.length,99);assert.equal(h.eggSprite.visible,true);
  for(let n=0;n<8;n++)h.processInput(api.Button.DOWN);
  for(let n=0;n<10;n++)h.processInput(api.Button.RIGHT);
  assert.equal(h.cursor,98);assert.equal(h.setCursor(99),false);assert.ok(h.eggNameText.text.includes('Egg'));
  h.processInput(api.Button.CANCEL);h.clear();assert.equal(h.processInput(api.Button.CANCEL),false);
  assert.equal(returns,2);assert.equal(JSON.stringify(scene.gameData.eggs),before);
});

test('original Gacha displays each existing voucher count while every spending path stays inert in readonly and after clear',async t=>{
  const {scene,p}=home(t);await settle(p);const messages=[];scene.ui.showText=t=>messages.push(t);scene.ui.bringToTop=()=>{};
  scene.gameData={voucherCounts:{0:12,1:3,2:2,3:1},eggs:[]};
  const h=new api.EggGachaUiHandler(scene),counts=Array.from({length:4},()=>renderPort());
  Object.assign(h,{voucherCountLabels:counts,eggGachaContainer:renderPort(),eggGachaOptionsContainer:renderPort(),
    gachaContainers:[],setGachaCursor(){}});
  let returns=0;h.show([{readOnly:true,onCancel:()=>returns++}]);
  assert.deepEqual(counts.map(c=>c.text),['12','3','2','1']);assert.equal(h.eggGachaOptionsContainer.visible,false);
  assert.match(messages[0],/仅供查看/);
  const before=JSON.stringify(scene.gameData);
  for(let n=0;n<6;n++){h.cursor=n;h.processInput(api.Button.ACTION);h.consumeVouchers(n%4,1);h.pull(25);}
  assert.equal(JSON.stringify(scene.gameData),before);h.processInput(api.Button.CANCEL);assert.equal(returns,1);
  h.clear();h.pull();h.consumeVouchers(0,1);assert.equal(h.processInput(api.Button.CANCEL),false);
  assert.equal(JSON.stringify(scene.gameData),before);assert.equal(returns,1);
  // The normal solo handler still spends its own existing vouchers after show.
  scene.enableTutorials=false;h.show([]);h.consumeVouchers(0,1);
  assert.equal(scene.gameData.voucherCounts[0],11);
});

test('legacy personal data keeps original defaults; structurally corrupt JSON is refused without replacement',async t=>{
  const {scene,p,modes}=home(t);await settle(p);
  const dex=new api.GameData(scene,{readOnly:true}).dexData;
  const legacy=JSON.stringify({trainerId:3,secretId:4,dexData:dex},(_k,v)=>typeof v==='bigint'?v.toString():v);
  await rawWrite({data:{schema:1,value:legacy,updatedAt:5}});
  await p.browse(api.Mode.EGG_GACHA);assert.deepEqual(scene.gameData.voucherCounts,{0:0,1:0,2:0,3:0});
  assert.deepEqual(scene.gameData.eggs,[]);await p.showHome();
  await rawWrite({data:{schema:1,value:'{}',updatedAt:6}});const before=await rawRecords();
  await p.browse(api.Mode.STARTER_SELECT);assert.match(modes.at(-1)[1].options[0].label,/读取失败/);
  assert.deepEqual(await rawRecords(),before);
});


test('returning home hides the battle backdrop, combatants and HUD while preserving menu and explicit solo navigation',async t=>{
 const {scene,p,modes,assigned}=home(t);const view=()=>({visible:true,setVisible(value){this.visible=value;}});
 scene.field=view();scene.fieldUI=view();scene.arenaBg=view();scene.uiContainer=view();
 await p.showHome();await settle(p);
 assert.equal(scene.field.visible,false);assert.equal(scene.fieldUI.visible,false);assert.equal(scene.arenaBg.visible,false);
 assert.equal(scene.uiContainer.visible,true);assert.equal(modes.at(-1)[0],api.Mode.TITLE);
 modes.at(-1)[1].options[0].handler();assert.deepEqual(assigned,['/?solo=1']);
});
