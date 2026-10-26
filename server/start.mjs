import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { attachCoopServer } from './coop-service.mjs';
import { attachFormalCoopServer, FormalRoomStore } from './formal-coop-service.mjs';
import { createOriginalCoopAdapter } from './original-coop-adapter.mjs';
import {loadHostIdentity,serveHostIdentity} from './host-identity.mjs';

const root = resolve(process.env.COOP_DIST ?? 'dist');
const formalDirectory=process.env.COOP_FORMAL_DATA ?? 'server/data/formal-rooms';
const hostIdentity=await loadHostIdentity(formalDirectory);
const allowedOrigins=(process.env.COOP_CLIENT_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  if(serveHostIdentity(request,response,hostIdentity,allowedOrigins))return;
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep) || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(403); response.end(); return; }
    const file = await stat(path);
    if (!file.isFile()) throw new Error('Not a file');
    const etag = 'W/"' + file.size.toString(16) + '-' + Math.floor(file.mtimeMs).toString(16) + '"';
    response.setHeader('ETag', etag);
    const immutable = /[\\/]assets[\\/][^\\/]+-[a-f0-9]{8,}\.(?:js|css)$/.test(path);
    response.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (request.headers['if-none-match'] === etag) { response.writeHead(304); response.end(); return; }
    response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'HEAD') response.end(); else createReadStream(path).pipe(response);
  } catch { response.writeHead(404); response.end('Not found'); }
});
const service = await attachCoopServer(server, { directory: process.env.COOP_DATA ?? 'server/data/rooms' });
const profileAdapter = process.env.COOP_PROFILE_LOBBY === '1'
  ? createOriginalCoopAdapter({ fixture: { profileLobby: true, sharedPreparation: true, identities: [{ trainerId: 0, secretId: 0 }, { trainerId: 0, secretId: 0 }] },
    // Optional reproducible acceptance seed, server-only. Normal rooms remain random.
    seedFactory: () => process.env.COOP_ROOM_SEED ?? randomUUID() })
  : null;
const formalService = await attachFormalCoopServer(server, { adapter: profileAdapter,
  store: new FormalRoomStore(formalDirectory),allowedOrigins });
server.listen(Number(process.env.PORT ?? 8020), process.env.COOP_BIND??'127.0.0.1', () => console.log('Early co-op: http://localhost:' + server.address().port + '/'));
async function stop() { await formalService.close(); await service.close(); await profileAdapter?.closeAll(); server.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
