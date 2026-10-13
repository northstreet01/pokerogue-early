import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { attachCoopServer } from './coop-service.mjs';

const root = resolve(process.env.COOP_DIST ?? 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep) || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(403); response.end(); return; }
    if (!(await stat(path)).isFile()) throw new Error('Not a file');
    response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'no-cache');
    if (request.method === 'HEAD') response.end(); else createReadStream(path).pipe(response);
  } catch { response.writeHead(404); response.end('Not found'); }
});
const service = await attachCoopServer(server, { directory: process.env.COOP_DATA ?? 'server/data/rooms' });
server.listen(Number(process.env.PORT ?? 8020), '0.0.0.0', () => console.log('Early co-op: http://localhost:' + server.address().port + '/coop.html'));
async function stop() { await service.close(); server.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
