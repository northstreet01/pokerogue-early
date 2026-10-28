import http from 'node:http';
import { WebSocket } from 'ws';
import { attachFormalCoopServer } from '../../server/formal-coop-service.mjs';
import { copy, validateMessage } from '../../src/battle-core/coop-contract.mjs';

export async function formalFixture(adapter, store = { data: new Map(), async load() { return [...this.data.values()].map(copy); }, async save(room) { this.data.set(room.roomId, copy(room)); } }) {
  // This same-origin legacy fixture has no host identity endpoint. Return an
  // explicit 404 so the real host lookup can complete its compatibility path.
  const httpServer = http.createServer((_request,response)=>{response.writeHead(404);response.end('not found');}), service = await attachFormalCoopServer(httpServer, { adapter, store });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const clients = [];
  return { ...service, store, async client() {
    const socket = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}/coop/v1/ws`);
    const client = { socket, messages: [], waiters: [], send(message) { socket.send(JSON.stringify(message)); }, wait(predicate) {
      return new Promise((resolve, reject) => { const waiter = { predicate, resolve, timer: setTimeout(() => { client.waiters = client.waiters.filter(w => w !== waiter); reject(Error('Timed out: ' + predicate)); }, 4000) }; client.waiters.push(waiter); flush(); });
    } };
    function flush() { for (const waiter of [...client.waiters]) { const index = client.messages.findIndex(waiter.predicate); if (index < 0) continue; clearTimeout(waiter.timer); client.waiters.splice(client.waiters.indexOf(waiter), 1); waiter.resolve(client.messages.splice(index, 1)[0]); } }
    socket.on('message', raw => { const message = JSON.parse(raw); validateMessage(message, 'server'); client.messages.push(message); flush(); });
    clients.push(client); await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    client.send({ type: 'hello', ...service.versions }); await client.wait(m => m.type === 'welcome'); return client;
  }, async close() { for (const c of clients) c.socket.terminate(); await service.close(); await new Promise(resolve => httpServer.close(resolve)); } };
}
