import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import http from 'node:http';
import {WebSocket} from 'ws';
import {startAssetServer,createHostController,startLanHost,listen,closeHttp} from '../desktop/runtime.mjs';
import {startDesktopHost} from '../src/desktop-host.mjs';
import {createPlayerHostAdapter,createOriginalCoopAdapter} from '../server/original-coop-adapter.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));

test('all player-host entry points use profile lobby and shared preparation without fixed test parties',async()=>{
 const requests=[];let closed=0;
 assert.throws(()=>createOriginalCoopAdapter(),/ADAPTER_CONFIGURATION_REQUIRED/);
 const adapter=createPlayerHostAdapter({seedFactory:()=> 'host-config-test',hostFactory:async()=>({
  request:async type=>{requests.push(type);assert.equal(type,'catalogs');return {species:[]};},close:async()=>{closed++;}})});
 try{const context=await adapter.createInitialContext({runId:'host-config-run'});
  assert.equal(context.profileLobby,true);assert.equal(context.checkpoint,null);assert.equal(context.provisioning.sharedPreparation,true);
  assert.equal(context.provisioning.seed,'host-config-test');assert.ok(context.lobby.players.every(p=>p.profile===null&&!p.ready));
  assert.deepEqual(requests,['catalogs']);
 }finally{await adapter.closeAll();}assert.equal(closed,1);
});
const factory=()=>({rulesVersion:'desktop-test',contentHash:'desktop-test',
  createInitialContext:()=>({step:0}),validateCheckpoint:()=>true,captureCheckpoint:copy,restoreCheckpoint:copy,
  describeDecision:c=>({id:`step-${c.step}`,requiredSeats:[0,1]}),validateAction:()=>true,
  advanceToDecision:c=>({context:{step:c.step+1},events:[],grants:[]}),
  projectSnapshot:c=>({shared:copy(c),personal:{}}),closeAll:async()=>{}});
async function temporary(){await mkdir('build/desktop/tests',{recursive:true});return mkdtemp(resolve('build/desktop/tests/run-'));}
async function freePort(){const server=http.createServer();const address=await listen(server,0,'127.0.0.1');await closeHttp(server);return address.port;}
async function client(endpoint){
  const socket=new WebSocket(endpoint.replace('http:','ws:')+'/coop/v1/ws',{origin:'http://127.0.0.1:18734'});
  const messages=[];socket.on('message',data=>messages.push(JSON.parse(data)));
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  return {socket,send:value=>socket.send(JSON.stringify(value)),wait:async type=>{
    for(let i=0;i<300;i++){const found=messages.find(m=>m.type===type);if(found)return found;await new Promise(r=>setTimeout(r,10));}
    throw Error('WS_WAIT_TIMEOUT '+type);
  }};
}
test('local resources reject alternate Host, writes and symlink escape; no room API',async()=>{
  const root=await temporary();await writeFile(join(root,'index.html'),'local-assets');
  await writeFile(join(root,'save-tools.html'),'obsolete restore tool');
  await writeFile(join(root,'sprite.png'),'sprite');const server=await startAssetServer(root,0);
  try{
    assert.equal(await (await fetch(server.origin)).text(),'local-assets');
    assert.equal((await fetch(server.origin+'/sprite.png')).headers.get('content-type'),'image/png');
    assert.equal((await fetch(server.origin+'/coop/v1/host')).status,404);
    assert.equal((await fetch(server.origin+'/save-tools.html')).status,404);
    assert.equal((await fetch(server.origin,{method:'POST'})).status,405);
    const forbidden=await new Promise((resolve,reject)=>{
      const req=http.get(server.origin,{headers:{host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);
    });assert.equal(forbidden,403);
    const outside=await temporary();await writeFile(join(outside,'secret'),'private');
    await symlink(outside,join(root,'escape'),'junction');
    assert.equal((await fetch(server.origin+'/escape/secret')).status,404);
  }finally{await server.close();}
});
test('concurrent host startup is idempotent; stop preserves host identity and LAN serves no assets',async()=>{
  const directory=await temporary(),port=await freePort();
  const controller=createHostController({directory,bind:'127.0.0.1',adapterFactory:factory});
  try{
    const [a,b]=await Promise.all([controller.start({port}),controller.start({port})]);assert.equal(a.hostId,b.hostId);
    assert.equal((await fetch(a.endpoint+'/')).status,404);
    assert.equal((await fetch(a.endpoint+'/images/pokemon/1.png')).status,404);
    assert.equal((await (await fetch(a.endpoint+'/coop/v1/host')).json()).hostId,a.hostId);
    await assert.rejects(controller.start({port:port+1}),/HOST_ALREADY_RUNNING/);
    await controller.stop();assert.equal(controller.state().running,false);
    const resumed=await controller.start({port});assert.equal(resumed.hostId,a.hostId);
  }finally{await controller.stop();}
});
test('formal two-seat room survives stop/restart and resumes the original authenticated seat',async()=>{
  const directory=await temporary(),port=await freePort();const controller=createHostController({directory,bind:'127.0.0.1',adapterFactory:factory});
  const peers=[],hello={type:'hello',protocolVersion:1,checkpointVersion:1,rulesVersion:'desktop-test',contentHash:'desktop-test'};
  try{
    const state=await controller.start({port}),a=await client(state.endpoint);peers.push(a);a.send(hello);await a.wait('welcome');
    a.send({type:'createRoom',name:'A'});const first=await a.wait('snapshot');
    const room=JSON.parse(await readFile(join(directory,first.roomId+'.json'),'utf8'));
    const b=await client(state.endpoint);peers.push(b);b.send(hello);await b.wait('welcome');
    b.send({type:'joinRoom',roomId:first.roomId,name:'B'});assert.equal((await b.wait('snapshot')).seat,1);
    await controller.stop();await controller.start({port});
    const recovered=await client(state.endpoint);peers.push(recovered);recovered.send(hello);await recovered.wait('welcome');
    recovered.send({type:'resumeSeat',roomId:first.roomId,resumeToken:room.seats[0].token});
    const restored=await recovered.wait('snapshot');assert.equal(restored.seat,0);assert.equal(restored.runId,first.runId);
    assert.deepEqual(restored.shared,first.shared);
  }finally{for(const p of peers)p.socket.terminate();await controller.stop();}
});
test('port conflict cleans up resources and permits subsequent startup',async()=>{
  const directory=await temporary(),blocker=http.createServer();const address=await listen(blocker,0,'127.0.0.1');
  try{await assert.rejects(startLanHost({directory,port:address.port,bind:'127.0.0.1',adapterFactory:factory}),{code:'EADDRINUSE'});}
  finally{await closeHttp(blocker);}
  const host=await startLanHost({directory,port:address.port,bind:'127.0.0.1',adapterFactory:factory});await host.close();
});
test('invalid ports never choose a replacement origin or start a service',async()=>{
  for(const port of [0,80,18734,65536,1.5,'18735'])await assert.rejects(startLanHost({directory:'unused',port}),/INVALID_HOST_PORT/);
});
test('desktop bridge reports native failure and leaves browser fallback explicit',async()=>{
  await assert.rejects(startDesktopHost(18735),/DESKTOP_HOST_UNAVAILABLE/);
  globalThis.pokerogueDesktop={version:1,startHost:async()=>({ok:false,code:'EADDRINUSE'})};
  try{await assert.rejects(startDesktopHost(18735),/EADDRINUSE/);}finally{delete globalThis.pokerogueDesktop;}
});
