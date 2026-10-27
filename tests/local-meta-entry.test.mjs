import test,{before,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {createRequire,isBuiltin} from 'node:module';
import {resolve,join} from 'node:path';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {WebSocket} from 'ws';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {createAppNavigation,appRoute,closeAppScene,bindAppNavigationControls,isAppDocument} from '../src/app-navigation.mjs';
import {normalizeEndpoint,hostScope,identifyHost,rememberHost,readHosts} from '../src/coop/host-connection.mjs';
import {createPlayStorage} from '../src/coop/play-storage.mjs';
import {loadHostIdentity,serveHostIdentity,clientOriginAllowed} from '../server/host-identity.mjs';
import {attachFormalCoopServer} from '../server/formal-coop-service.mjs';
import {initTouchControls} from '../src/touch-controls.js';
const hostA='11111111-1111-4111-8111-111111111111',hostB='22222222-2222-4222-8222-222222222222';
const base='http://127.0.0.1:8034/';let api,dom;
before(async()=>{
 await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[
  {find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
  {find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')}]},ssr:{noExternal:true},
  build:{ssr:resolve('tests/fixtures/local-meta-ui-entry.mjs'),outDir:resolve('build/local-meta-04/ui'),emptyOutDir:true,minify:false,
   rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
 api=createRequire(import.meta.url)('../build/local-meta-04/ui/entry.cjs');api.describeOriginalCatalogs();
});
beforeEach(()=>{
 dom?.window.close();dom=new JSDOM('<body><button data-desktop-key="ACTION">确认</button></body>',{url:base});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,
  localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,indexedDB:new IDBFactory()});
});
test('local routes retain the document origin and refuse unrelated or remote documents',()=>{
 assert.equal(appRoute('/?solo=1',base).origin,new URL(base).origin);
 assert.equal(appRoute('/coop-play.html?fresh=1',base).pathname,'/coop-play.html');
 for(const url of ['https://example.com/','/save-tools.html','javascript:alert(1)'])assert.throws(()=>appRoute(url,base));
});
test('mode transition waits for queued saves, serializes double confirmation and starts one new scene',async()=>{
 const events=[];let finish;
 const navigate=createAppNavigation({base,close:()=>new Promise(r=>finish=r),replace:url=>events.push(url.pathname),start:async()=>events.push('scene')});
 const first=navigate({},'/?solo=1'),second=navigate({},'/coop-play.html');assert.equal(first,second);assert.deepEqual(events,[]);
 finish();await first;assert.deepEqual(events,['/','scene']);
});
test('failed profile close keeps the current scene and a later explicit retry can succeed',async()=>{
 let fail=true,starts=0;
 const navigate=createAppNavigation({base,close:async()=>{if(fail)throw Error('disk');},replace(){},start:async()=>starts++});
 await assert.rejects(navigate({},'/?solo=1'),/disk/);assert.equal(starts,0);fail=false;
 await navigate({},'/?solo=1');assert.equal(starts,1);
});
test('host endpoint accepts only clean HTTP origins and preserves browser mixed-content protection',()=>{
 assert.equal(normalizeEndpoint('http://192.168.1.8:8020/',base),'http://192.168.1.8:8020');
 for(const endpoint of ['ws://host','http://user:pass@host','http://host/a','http://host/?token=x','file:///tmp'])assert.throws(()=>normalizeEndpoint(endpoint,base));
 assert.throws(()=>normalizeEndpoint('http://host','https://local.test/'),/HTTPS_REQUIRED/);
});

test('unconfirmed save cannot silently discard a live profile during navigation',async()=>{
 const calls=[],scene={prepareAppLeave:async()=>false,gameData:{invalidateProfile:()=>calls.push('discard'),closeProfile:async()=>calls.push('close')}};
 await assert.rejects(closeAppScene(scene),/APP_SAVE_UNCONFIRMED/);assert.deepEqual(calls,[]);
 await closeAppScene(scene,true);assert.deepEqual(calls,['discard']);
});

test('new tutorial preferences contain real tutorial IDs and preserve stored completion',()=>{
 const read=()=>api.GameData.prototype.getTutorialFlags.call({});
 const expected=['INTRO','ACCESS_MENU','MENU','STARTER_SELECT','SELECT_ITEM','EGG_GACHA'].sort();
 assert.deepEqual(Object.keys(read()).sort(),expected);assert.ok(Object.values(read()).every(value=>value===false));
 localStorage.setItem('tutorials','{"INTRO":true}');assert.equal(read().INTRO,true);assert.equal(read().ACCESS_MENU,false);
});

test('bottom controls use guarded in-app navigation and report failures without loading another document',async()=>{
 document.body.innerHTML='<nav><button data-app-route="/">返回大厅</button></nav>';
 const calls=[],errors=[],release=bindAppNavigationControls(document,async value=>{calls.push(value);throw Error('disk');},e=>errors.push(e.message));
 let leaked=0;window.addEventListener('keydown',()=>leaked++);
 document.querySelector('button').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(leaked,0);
 document.querySelector('button').click();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls,['/']);assert.deepEqual(errors,['disk']);assert.equal(location.href,base);
 release();document.querySelector('button').click();await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,1);
 for(const page of ['/save-tools.html','/coop.html','/other.html','https://other.test/'])assert.equal(isAppDocument(page,base),false);
 for(const page of ['/','/index.html','/coop-play.html'])assert.equal(isAppDocument(page,base),true);
});

test('sound speed follows the active scene and is not wrapped again on mode changes',()=>{
 const fades=[],originalOut=api.SoundFade.fadeOut,originalIn=api.SoundFade.fadeIn;
 api.SoundFade.fadeOut=(_scene,_sound,duration)=>fades.push(duration);
 api.SoundFade.fadeIn=(_scene,_sound,duration)=>fades.push(duration);
 const scene=gameSpeed=>({gameSpeed,time:{addEvent(){}},tweens:{add(){},chain(){},addCounter(){}}});
 try {
  const first=scene(2),second=scene(5);api.initGameSpeed.call(first);const wrapper=api.SoundFade.fadeOut;
  api.initGameSpeed.call(second);assert.equal(api.SoundFade.fadeOut,wrapper);
  api.SoundFade.fadeOut(second,{},1000);api.SoundFade.fadeIn(first,{},1000);assert.deepEqual(fades,[200,500]);
 }finally{api.SoundFade.fadeOut=originalOut;api.SoundFade.fadeIn=originalIn;}
});
test('host discovery never treats a remote 404 or a different host identity as a legacy server',async()=>{
 await assert.rejects(identifyHost('http://remote.test',{base,fetcher:async()=>({status:404,ok:false})}),/HOST_UNAVAILABLE/);
 const legacy=await identifyHost(new URL(base).origin,{base,fetcher:async()=>({status:404})});assert.equal(legacy.legacy,true);
 await assert.rejects(identifyHost('http://remote.test',{base,expectedHostId:hostA,fetcher:async()=>({ok:true,json:async()=>({format:'pokerogue-local-host',version:1,hostId:hostB})})}),/HOST_ID_CHANGED/);
});
test('host namespace follows stable host identity across address changes, isolates other hosts and profiles, and leaves old outbox intact',async()=>{
 const storage=createPlayStorage(),origin=new URL(base).origin,a=hostScope(origin,hostA,'profile-a'),b=hostScope(origin,hostB,'profile-a');
 const message={type:'submitAction',roomId:'ABC123',runId:'run-a',actionId:'old-action',expectedRevision:4,action:{kind:'fight'}};
 await storage.saveAction(a,0,message);await storage.saveAction(origin,0,{...message,actionId:'legacy'});
 rememberHost({hostId:hostA,endpoint:'http://127.0.0.1:9001'});rememberHost({hostId:hostA,endpoint:'http://127.0.0.1:9002'});
 assert.equal(readHosts().hosts.length,1);assert.equal(readHosts().hosts[0].endpoint,'http://127.0.0.1:9002');
 assert.deepEqual(await storage.pendingActions(a,'ABC123',0),[message]);assert.deepEqual(await storage.pendingActions(b,'ABC123',0),[]);
 assert.deepEqual(await storage.pendingActions(hostScope(origin,hostA,'profile-b'),'ABC123',0),[]);
 assert.equal((await storage.pendingActions(origin,'ABC123',0))[0].actionId,'legacy');
});
test('host identity survives reopening its directory and corrupt identity fails closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'local-meta-host-')),first=await loadHostIdentity(dir);
 assert.deepEqual(await loadHostIdentity(dir),first);await writeFile(join(dir,'host-id.json'),'{}');
 await assert.rejects(loadHostIdentity(dir),/INVALID_HOST_ID/);
});
test('browser origin policy permits own service and local clients, rejects arbitrary sites and malformed origin',()=>{
 assert.equal(clientOriginAllowed('http://127.0.0.1:8034','192.168.1.8:8020'),true);
 assert.equal(clientOriginAllowed('http://192.168.1.8:8020','192.168.1.8:8020'),true);
 assert.equal(clientOriginAllowed('https://evil.test','192.168.1.8:8020'),false);
 assert.equal(clientOriginAllowed('null','192.168.1.8:8020'),false);
 assert.equal(clientOriginAllowed('http://friend:8034','host:8020',['http://friend:8034']),true);
});
function uiPhase(t){
 const scene={gameData:{localProfileName:'小智'},events:{once(){}},fadeOutBgm(){},ui:{setMode:async()=>{}},getPlayerField:()=>[]};
 const p=new api.CoopPlayPhase(scene);p.createOverlay();t.after(()=>p.stopSession());return {p,scene};
}

test('room code accepts sixth character across lobby refresh, keeps focus, and isolates game keys',t=>{
 const {p}=uiPhase(t);p.renderLobbyControls();
 let input=document.querySelector('#coop-room-code');input.focus();input.value='ABC12';
 input.dispatchEvent(new window.Event('input',{bubbles:true}));input.setSelectionRange(5,5);
 p.renderLobbyControls();input=document.querySelector('#coop-room-code');
 assert.equal(input.value,'ABC12');assert.equal(document.activeElement,input);assert.equal(input.selectionStart,5);
 input.value+='3';input.dispatchEvent(new window.Event('input',{bubbles:true}));
 assert.equal(input.value,'ABC123');assert.equal(document.querySelector('#coop-room-code-count').textContent,'6/6');
 let leaked=0;window.addEventListener('keydown',()=>leaked++);
 input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'c',bubbles:true}));assert.equal(leaked,0);
 input.value='  ａｂｃ１２３\n';input.dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal(input.value,'ABC123');
});

test('solo start fades the current scene BGM rather than a stale shared menu sound',async()=>{
 let choose,slot,starts=0,ends=0,fades=0;const party=[];
 const pokemon={tryPopulateMoveset(){},setVisible(){},loadAssets:async()=>{}};
 const scene={playBgm(){},ui:{clearText(){},setMode(mode,callback){if(mode===api.Mode.STARTER_SELECT)choose=callback;else if(mode===api.Mode.SAVE_SLOT)slot=arguments[2];}},
  gameData:{getSpeciesDexAttrProps:()=>({formIndex:0,abilityIndex:0}),dexData:{1:{ivs:[1,2,3,4,5,6]}},gameStats:{classicSessionsPlayed:0}},
  getParty:()=>party,gameMode:{getStartingLevel:()=>5,isClassic:true},addPlayerPokemon:()=>pokemon,
  sound:{get(){throw Error('stale shared menu lookup');}},fadeOutBgm(duration,destroy){assert.equal(duration,500);assert.equal(destroy,true);fades++;},
  time:{delayedCall(){}},newBattle(){starts++;},shiftPhase(){ends++;}};
 const phase=new api.SelectStarterPhase(scene);phase.start();
 choose([{species:{speciesId:1,forms:[],malePercent:50},dexAttr:1n,nature:0}]);slot(0);
 await new Promise(r=>setTimeout(r,0));
 assert.equal(fades,1);assert.equal(starts,1);assert.equal(ends,1);assert.deepEqual(party,[pokemon]);
});

test('desktop entry waits for explicit host choice and invokes the bounded native host port',async t=>{
 const calls=[];
 globalThis.pokerogueDesktop={version:1,startHost:async port=>{
  calls.push(port);return {ok:true,value:{hostId:hostA,port,endpoint:'http://127.0.0.1:'+port,addresses:['http://192.168.1.8:'+port]}};
 }};t.after(()=>delete globalThis.pokerogueDesktop);
 const {p,scene}=uiPhase(t);scene.gameData.loadSystem=async()=>true;
 p.connect=async endpoint=>calls.push(endpoint);
 await p.loadProfileAndConnect();assert.deepEqual(calls,[]);
 assert.ok(document.querySelector('input[aria-label="本机房主端口"]'));
 const button=[...p.controls.querySelectorAll('button')].find(b=>b.textContent==='启动本机房主');
 assert.ok(button);button.click();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls,[18735,'http://127.0.0.1:18735']);assert.equal(p.hostId,hostA);
});

test('late native host startup cannot reconnect a retired cooperative scene',async t=>{
 let finish,connections=0;
 globalThis.pokerogueDesktop={version:1,startHost:()=>new Promise(resolve=>{finish=resolve;})};
 t.after(()=>delete globalThis.pokerogueDesktop);
 const {p}=uiPhase(t);p.connect=async()=>connections++;
 p.renderLobbyControls();[...p.controls.querySelectorAll('button')].find(b=>b.textContent==='启动本机房主').click();
 await new Promise(r=>setTimeout(r,0));p.stopSession();
 finish({ok:true,value:{hostId:hostA,port:18735,endpoint:'http://127.0.0.1:18735',addresses:[]}});
 await new Promise(r=>setTimeout(r,0));assert.equal(connections,0);
});

test('native port conflict is shown without claiming connection or changing the existing endpoint',async t=>{
 globalThis.pokerogueDesktop={version:1,startHost:async()=>({ok:false,code:'EADDRINUSE'})};
 t.after(()=>delete globalThis.pokerogueDesktop);
 const {p}=uiPhase(t);let connected=false;p.connect=async()=>{connected=true;};const endpoint=p.endpoint;
 p.renderLobbyControls();[...p.controls.querySelectorAll('button')].find(b=>b.textContent==='启动本机房主').click();
 await new Promise(r=>setTimeout(r,0));assert.equal(connected,false);assert.equal(p.endpoint,endpoint);
 assert.match(p.status.textContent,/EADDRINUSE/);
});
test('separate waiting room exposes both seats and return, and does not allow preparation or automatic selection before peer arrives',async t=>{
 const {p}=uiPhase(t);p.roomId='ABC123';p.seat=0;p.runId='run';p.playerNames=['小智',null];p.online=[true,false];
 p.latest={revision:1,runId:'run',personal:{decision:{kind:'lobby'}},shared:{ready:[false,false]}};
 p.renderLobbyControls();assert.ok(document.querySelector('#coop-play-overlay.room-lobby'));
 assert.match(document.querySelector('.room-players').textContent,/小智（你）.*等待加入/);
 assert.ok(document.querySelector('#coop-exit-session'));assert.equal(document.querySelector('#coop-waiting-room')!==null,true);
 assert.equal([...p.controls.querySelectorAll('button')].some(b=>b.textContent==='提交准备'),false);
 p.online=[true,true];p.inputReady=true;let opened=0;p.openStarterSelect=async()=>opened++;
 p.renderLobbyControls();assert.equal(opened,0);const select=[...p.controls.querySelectorAll('button')].find(b=>b.textContent==='选择队伍');
 assert.ok(select);select.click();await new Promise(r=>setTimeout(r,0));assert.equal(opened,1);
});
test('a resumed seat with another run stops before model consumption or outbox replay',async t=>{
 const {p}=uiPhase(t);p.roomId='ABC123';p.seat=0;p.epoch='epoch';p.expectedRunId='known-run';
 p.consumer=()=>assert.fail('must not acknowledge another run');p.replayOutbox=()=>assert.fail('must not replay');
 await p.onMessage({type:'snapshot',connectionEpoch:'epoch',roomId:'ABC123',seat:0,runId:'different-run'});
 assert.match(p.status.textContent,/RUN_MISMATCH/);
});
test('failed identity discovery retries owned rooms, clears an older retry on reconnect, and leaves unjoined address entry manual',async t=>{
 for(const owned of [false,true]){
  const {p}=uiPhase(t);p.roomId=owned?'ABC123':null;p.hostId=hostA;
  p.identifyEndpoint=async(_endpoint,expected)=>{assert.equal(expected,hostA);throw Error('HOST_UNAVAILABLE');};
  const old=setTimeout(()=>assert.fail('obsolete retry must be cancelled'),10000);p.reconnectTimer=old;
  await p.connect('http://127.0.0.1:9000');assert.notEqual(p.reconnectTimer,old);
  assert.equal(!!p.reconnectTimer,owned);assert.equal(p.socket,null);p.stopSession();assert.equal(p.reconnectTimer,null);
 }
});
test('return uses the same app navigation and closes the cooperative writer before switching',async t=>{
 const {p,scene}=uiPhase(t),events=[];
 scene.prepareAppLeave=()=>p.pauseForNavigation();
 scene.gameData.closeProfile=async()=>events.push('close');scene.navigateApp=async()=>{
   await closeAppScene(scene);events.push('navigate');
 };
 p.storage={pauseSession:async()=>{events.push('pause');return true;}};
 const first=p.leaveSession(),second=p.leaveSession();assert.equal(first,second);await first;
 assert.deepEqual(events,['pause','close','navigate']);assert.equal(document.querySelector('#coop-play-overlay'),null);
});
test('repeated original control binding removes old listeners, and a disposed scene cannot receive clicks',()=>{
 let old=0,current=0;const key=count=>({onDown:count,onUp(){}});
 initTouchControls({ACTION:key(()=>old++)});const release=initTouchControls({ACTION:key(()=>current++)});
 document.querySelector('button').click();assert.equal(old,0);assert.equal(current,1);release();
 document.querySelector('button').click();assert.equal(current,1);
});

const adapter={rulesVersion:'transport-only',contentHash:'transport-only',createInitialContext:async()=>({decision:'lobby'}),
 validateAction(){},advanceToDecision(){throw Error('NO_GAME_RULES_IN_TRANSPORT_TEST');},captureCheckpoint:value=>structuredClone(value),validateCheckpoint(){},
 restoreCheckpoint:value=>structuredClone(value),projectSnapshot:()=>({shared:{},personal:{}}),describeDecision:()=>({id:'lobby',requiredSeats:[0,1]})};
async function host(t,identity,store){
 const server=http.createServer((request,response)=>{if(!serveHostIdentity(request,response,identity)){response.writeHead(404);response.end();}});
 const service=await attachFormalCoopServer(server,{adapter,store});let endpoint;
 try{
  for(let attempt=0;attempt<10;attempt++){
   await new Promise(r=>server.listen(0,'127.0.0.1',r));endpoint=`http://127.0.0.1:${server.address().port}`;
   try{await fetch(endpoint+'/coop/v1/host');break;}
   catch(error){await new Promise(r=>server.close(r));if(error.cause?.message!=='bad port'||attempt===9)throw error;}
  }
 }catch(error){await service.close();throw error;}
 const sockets=[];
 let closed=false;const close=async()=>{if(closed)return;closed=true;for(const socket of sockets)socket.terminate();await service.close();await new Promise(r=>server.close(r));};
 t.after(close);
 return {endpoint,close,async client(origin){
  const socket=new WebSocket(endpoint.replace('http:','ws:')+'/coop/v1/ws',{origin});sockets.push(socket);
  const messages=[],waiters=[];socket.on('message',raw=>{messages.push(JSON.parse(raw));flush();});
  function flush(){for(const waiter of [...waiters]){const index=messages.findIndex(waiter.fn);if(index>=0){clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(messages.splice(index,1)[0]);}}}
  const wait=fn=>new Promise((resolve,reject)=>{const waiter={fn,resolve,timer:setTimeout(()=>reject(Error('TRANSPORT_TIMEOUT')),4000)};waiters.push(waiter);flush();});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  socket.send(JSON.stringify({type:'hello',...service.versions}));await wait(m=>m.type==='welcome');
  return {send:value=>socket.send(JSON.stringify(value)),wait};
 }};
}
test('real HTTP discovery and two WebSocket clients work across local origins, presence waits for both, and service reopen retains the same run',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'local-meta-network-')),identity=await loadHostIdentity(dir),store={rooms:new Map(),async load(){return [...this.rooms.values()].map(v=>structuredClone(v));},async save(room){this.rooms.set(room.roomId,structuredClone(room));}};
 const one=await host(t,identity,store),found=await identifyHost(one.endpoint,{base});assert.equal(found.hostId,identity.hostId);
 const cors=await fetch(one.endpoint+'/coop/v1/host',{headers:{Origin:new URL(base).origin}});assert.equal(cors.headers.get('access-control-allow-origin'),new URL(base).origin);
 assert.equal((await fetch(one.endpoint+'/coop/v1/host',{headers:{Origin:'https://evil.test'}})).status,403);
 await assert.rejects(one.client('https://evil.test'));
 const a=await one.client(new URL(base).origin);a.send({type:'createRoom',name:'小智'});
 const welcome=await a.wait(m=>m.type==='welcome'),snapshot=await a.wait(m=>m.type==='snapshot');
 assert.deepEqual((await a.wait(m=>m.type==='roomPresence')).players,['小智',null]);
 const b=await one.client('http://localhost:8035');b.send({type:'joinRoom',roomId:welcome.roomId,name:'小霞'});
 assert.deepEqual((await b.wait(m=>m.type==='roomPresence')).players,['小智','小霞']);
 await one.close();
 const two=await host(t,await loadHostIdentity(dir),store),again=await identifyHost(two.endpoint,{base,expectedHostId:identity.hostId});
 assert.equal(again.hostId,found.hostId);const resumed=await two.client(new URL(base).origin);
 resumed.send({type:'resumeSeat',roomId:welcome.roomId,resumeToken:welcome.resumeToken});
 assert.equal((await resumed.wait(m=>m.type==='snapshot')).runId,snapshot.runId);
});
