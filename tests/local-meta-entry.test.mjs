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
import {createAppNavigation,appRoute} from '../src/app-navigation.mjs';
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
 scene.gameData.closeProfile=async()=>events.push('close');scene.navigateApp=async()=>events.push('navigate');
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
 const service=await attachFormalCoopServer(server,{adapter,store});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const endpoint=`http://127.0.0.1:${server.address().port}`,sockets=[];
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
