import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,isBuiltin} from 'node:module';
import {resolve} from 'node:path';
import {build} from 'vite';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {createPlayStorage} from '../src/coop/play-storage.mjs';

let api;
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
  globalThis.document=dom.window.document; globalThis.indexedDB=new IDBFactory();
  const assigned=[],modes=[];
  globalThis.location={origin:dom.window.location.origin,search:'',assign:url=>assigned.push(url)};
  globalThis.localStorage=dom.window.localStorage;globalThis.sessionStorage=dom.window.sessionStorage;
  const scene={gameData:{unchanged:true},events:{once(){}},fadeOutBgm(){},ui:{fadeIn(){},clearText(){},
    setMode:async (...args)=>{modes.push(args);}}};
  const p=new api.HomePhase(scene);p.start();
  t.after(()=>{p.dispose();dom.window.close();});
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
