import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadHostIdentity, serveHostIdentity } from '../server/host-identity.mjs';
import { attachFormalCoopServer, FormalRoomStore } from '../server/formal-coop-service.mjs';
import { createOriginalCoopAdapter } from '../server/original-coop-adapter.mjs';

export const APP_PORT = 18734;
export const HOST_PORT = 18735;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg',
  '.m4a':'audio/mp4','.ogg':'audio/ogg','.wav':'audio/wav','.ttf':'font/ttf','.woff2':'font/woff2','.ico':'image/x-icon'};
export function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
  });
}
export function closeHttp(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) { resolve(); return; }
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections?.();server.closeAllConnections?.();
  });
}

// Local resources and the original UI only. No room or filesystem API here.
export async function startAssetServer(root, port = APP_PORT) {
  const directory = await realpath(root);
  const server = http.createServer(async (request, response) => {
    if (request.headers.host !== `127.0.0.1:${server.address().port}`) { response.writeHead(403); response.end(); return; }
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    try {
      const url = new URL(request.url, 'http://localhost');
      const candidate = resolve(directory, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!candidate.startsWith(directory + sep)) throw Error('INVALID_PATH');
      const path = await realpath(candidate);
      if (!path.startsWith(directory + sep) || !(await stat(path)).isFile()) throw Error('INVALID_PATH');
      response.setHeader('Content-Type',types[extname(path)] ?? 'application/octet-stream');
      response.setHeader('X-Content-Type-Options','nosniff');
      response.setHeader('Cache-Control','no-cache');
      response.setHeader('Cross-Origin-Resource-Policy','same-origin');
      if (request.method === 'HEAD') response.end();
      else { const stream=createReadStream(path);stream.on('error',()=>response.destroy());stream.pipe(response); }
    } catch { response.writeHead(404);response.end('Not found'); }
  });
  server.on('upgrade',(_request,socket)=>socket.destroy());
  await listen(server,port,'127.0.0.1');
  return {origin:`http://127.0.0.1:${server.address().port}`,close:()=>closeHttp(server)};
}

// The LAN listener exposes formal identity/WS only, never the local asset tree.
export async function startLanHost({directory,port=HOST_PORT,bind='0.0.0.0',adapterFactory=createOriginalCoopAdapter}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === APP_PORT) throw Error('INVALID_HOST_PORT');
  if (!['0.0.0.0','127.0.0.1'].includes(bind)) throw Error('INVALID_HOST_BIND');
  const identity = await loadHostIdentity(directory);
  const adapter = adapterFactory({fixture:{profileLobby:true,sharedPreparation:true,
    identities:[{trainerId:0,secretId:0},{trainerId:0,secretId:0}]},seedFactory:()=>randomUUID()});
  const server=http.createServer((request,response)=>{
    if (serveHostIdentity(request,response,identity)) return;
    response.writeHead(404);response.end('Not found');
  });
  let service;
  try {
    service=await attachFormalCoopServer(server,{adapter,store:new FormalRoomStore(directory)});
    server.on('upgrade',(request,socket)=>{if(new URL(request.url,'http://localhost').pathname!=='/coop/v1/ws')socket.destroy();});
    await listen(server,port,bind);
  } catch(error) {await service?.close();await adapter.closeAll();await closeHttp(server);throw error;}
  const addresses=bind==='127.0.0.1'?[]:Object.values(networkInterfaces()).flat().filter(row=>row&&!row.internal&&row.family==='IPv4')
    .map(row=>`http://${row.address}:${port}`);
  let closing;
  return {state:{running:true,hostId:identity.hostId,port,endpoint:`http://127.0.0.1:${port}`,addresses},
    close:()=>closing??=(async()=>{await service.close();await adapter.closeAll();await closeHttp(server);})()};
}

export function createHostController(options) {
  let host=null,chain=Promise.resolve();
  const serial=task=>{const result=chain.then(task);chain=result.catch(()=>{});return result;};
  const state=()=>host?{...host.state,addresses:[...host.state.addresses]}:{running:false};
  return {
    state,
    start:({port=HOST_PORT}={})=>serial(async()=>{
      if(host){if(host.state.port!==port)throw Error('HOST_ALREADY_RUNNING');return state();}
      host=await startLanHost({...options,port});return state();
    }),
    stop:()=>serial(async()=>{if(host){await host.close();host=null;}return state();})
  };
}
