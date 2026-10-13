import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, open, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ENGINE_VERSION, RULES_HASH, canonical, stateHash, clone, createRun, validateAction, requiredSeats, resolveRound, replaceFainted, prepare, nextWave } from '../src/coop/engine.mjs';

export class RoomStore {
  constructor(directory) { this.directory = resolve(directory); }
  async load() {
    await mkdir(this.directory, { recursive: true });
    const rooms = [];
    for (const name of await readdir(this.directory)) if (/^[A-Z0-9]{6}\.json$/.test(name)) {
      const room = JSON.parse(await readFile(resolve(this.directory, name), 'utf8'));
      if (room.version !== ENGINE_VERSION || room.rulesHash !== RULES_HASH) throw new Error(`房间 ${name} 版本不匹配，请保留存档并使用匹配版本恢复`);
      rooms.push(room);
    }
    return rooms;
  }
  async save(room) {
    await mkdir(this.directory, { recursive: true });
    const path = resolve(this.directory, `${room.code}.json`), temporary = `${path}.tmp`;
    const file = await open(temporary, 'w', 0o600);
    try { await file.writeFile(JSON.stringify(room)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  }
}
const secret = () => randomBytes(32).toString('base64url');
const match = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function ensure(condition, reason) { if (!condition) throw new Error(reason); }
function textName(value) { ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= 24, '昵称长度为 1–24'); return value.trim(); }
export async function attachCoopServer(httpServer, { directory = 'server/data/rooms', store = new RoomStore(directory), heartbeatMs = 15000 } = {}) {
  const rooms = new Map((await store.load()).map(room => [room.code, room]));
  const connections = new Map(), queues = new Map(), storageFaults = new Set();
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  const connected = room => [0, 1].map(seat => connections.get(`${room.code}:${seat}`)?.readyState === WebSocket.OPEN);
  const send = (socket, value) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  function snapshot(room, seat) {
    const online = connected(room);
    const grants = room.state?.grants.filter(grant => grant.seat === seat && !room.grantAcks.includes(grant.id)) ?? [];
    return { type: 'snapshot', code: room.code, seat, version: ENGINE_VERSION, rulesHash: RULES_HASH,
      state: room.state, hash: room.state ? stateHash(room.state) : null, barrier: room.barrier || storageFaults.has(room.code),
      acked: storageFaults.has(room.code) ? [false, false] : room.acked, online,
      paused: !!room.state && (!online.every(Boolean) || storageFaults.has(room.code)), storageError: storageFaults.has(room.code), saved: room.saved,
      lobby: room.seats.map(entry => entry ? { name: entry.name, ready: !!entry.team } : null),
      submitted: [0, 1].map(index => room.inputs[index] !== undefined), grants };
  }
  function broadcast(room) { for (let seat = 0; seat < 2; seat++) { const socket = connections.get(`${room.code}:${seat}`); if (socket) send(socket, snapshot(room, seat)); } }
  async function persist(room) {
    try { await store.save(room); storageFaults.delete(room.code); }
    catch (error) {
      storageFaults.add(room.code);
      if (rooms.has(room.code)) broadcast(rooms.get(room.code));
      throw error;
    }
  }
  async function commit(room) { await persist(room); rooms.set(room.code, room); broadcast(room); }
  function serialized(code, task) {
    const promise = (queues.get(code) ?? Promise.resolve()).then(task);
    const tail = promise.catch(() => {}); queues.set(code, tail);
    tail.finally(() => { if (queues.get(code) === tail) queues.delete(code); });
    return promise;
  }
  function bind(socket, room, seat) {
    const key = `${room.code}:${seat}`, existing = connections.get(key);
    if (existing && existing !== socket) { existing.close(4001, '席位已在新连接恢复'); }
    socket.roomCode = room.code; socket.seat = seat; connections.set(key, socket);
    send(socket, { type: 'joined', code: room.code, seat, token: room.seats[seat].token }); broadcast(room);
  }
  const barrier = room => { room.barrier = true; room.acked = [false, false]; room.inputs = {}; };
  async function command(socket, message) {
    ensure(message.version === ENGINE_VERSION && message.rulesHash === RULES_HASH, '客户端规则版本不一致，请更新后重连');
    if (message.type === 'create') {
      ensure(!socket.roomCode, '已加入房间'); ensure(rooms.size < 500, '服务器房间数量已达上限');
      let code; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
      const room = { code, version: ENGINE_VERSION, rulesHash: RULES_HASH, seats: [{ token: secret(), name: textName(message.name), team: null }, null], state: null,
        barrier: false, acked: [false, false], inputs: {}, grantAcks: [], receipts: {}, saved: false };
      await persist(room); rooms.set(code, room); bind(socket, room, 0); return;
    }
    const code = socket.roomCode ?? message.code;
    ensure(typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code) && rooms.has(code), '房间不存在');
    return serialized(code, async () => {
      const room = clone(rooms.get(code));
      if (message.type === 'join') {
        ensure(!socket.roomCode, '已加入房间');
        let seat = room.seats.findIndex(entry => entry && match(entry.token, message.token));
        if (seat < 0) {
          ensure(!message.token && !room.state && !room.seats[1], '房间已满，恢复原席位需要本机凭据');
          seat = 1; room.seats[seat] = { token: secret(), name: textName(message.name), team: null };
        }
        // Connection-specific confirmation cannot survive a disconnect/restart.
        if (storageFaults.has(code)) room.acked = [false, false];
        room.acked[seat] = false;
        if (room.state) room.barrier = true;
        else if (room.seats.every(entry => entry?.team) && [...connected(room).filter((_, index) => index !== seat), true].every(Boolean)) {
          room.state = createRun(randomUUID(), randomBytes(4).readUInt32LE(), room.seats.map(entry => entry.team), room.seats.map(entry => entry.name)); barrier(room);
        }
        await persist(room); rooms.set(code, room); bind(socket, room, seat); return;
      }
      ensure(socket.roomCode === code && connections.get(`${code}:${socket.seat}`) === socket, '连接已被替换');
      const seat = socket.seat;
      if (storageFaults.has(code)) {
        ensure(message.type === 'snapshot', '服务器存档写入失败，已暂停；修复存储后请重新获取完整状态');
        room.acked = [false, false]; room.barrier = !!room.state;
        await commit(room); return;
      }
      if (message.type === 'snapshot') { send(socket, snapshot(room, seat)); return; }
      if (message.type === 'grantAck') {
        ensure(Array.isArray(message.ids) && message.ids.length <= 100, '奖励确认无效');
        for (const id of message.ids) {
          ensure(room.state?.grants.some(grant => grant.id === id && grant.seat === seat), '奖励不属于本玩家');
          if (!room.grantAcks.includes(id)) room.grantAcks.push(id);
        }
        await persist(room); rooms.set(code, room); return;
      }
      if (message.type === 'ack') {
        // An older ACK may already be queued when both confirmations advance a ready wave.
        // It confirms no part of the new revision and must not produce a false desync alarm.
        if (room.state && Number.isInteger(message.revision) && message.revision > 0 && message.revision < room.state.revision) return;
        if (!room.state || message.revision !== room.state.revision || message.hash !== stateHash(room.state)) {
          if (room.state) { room.barrier = true; room.acked = [false, false]; await commit(room); }
          throw new Error('状态校验失败，战斗保持暂停');
        }
        ensure(!room.state.grants.some(grant => grant.seat === seat && !room.grantAcks.includes(grant.id)), '本地收藏尚未保存');
        if (room.acked[seat]) return;
        room.acked[seat] = true;
        if (room.acked.every(Boolean) && connected(room).every(Boolean)) {
          room.barrier = false;
          if (room.state.phase === 'prep' && room.state.players.every(player => player.ready) && !room.saved) { room.state = nextWave(room.state); barrier(room); }
        }
        await commit(room); return;
      }
      ensure(typeof message.id === 'string' && message.id.length <= 80 && message.id.length > 0, '缺少指令编号');
      const key = `${seat}:${message.id}`, fingerprint = canonical(message);
      if (room.receipts[key]) {
        ensure(room.receipts[key].fingerprint === fingerprint, '同一编号不能用于不同指令'); send(socket, room.receipts[key].reply); send(socket, snapshot(room, seat)); return;
      }
      if (message.type === 'team') {
        ensure(!room.state, '冒险已开始'); ensure(Array.isArray(message.team) && message.team.length === 3, '每人需要 3 只精灵');
        // Use the same validation path as run initialization, including IV/nature/species constraints.
        createRun('validate', 1, [message.team, message.team]);
        room.seats[seat].team = message.team;
        if (room.seats.every(entry => entry?.team) && connected(room).every(Boolean)) {
          room.state = createRun(randomUUID(), randomBytes(4).readUInt32LE(), room.seats.map(entry => entry.team), room.seats.map(entry => entry.name)); barrier(room);
        }
      } else {
        ensure(room.state && message.revision === room.state.revision, '指令版本过期，请按最新状态重新选择');
        ensure(connected(room).every(Boolean), '玩家断线，冒险暂停');
        ensure(!room.barrier && room.acked.every(Boolean), '等待双方状态确认');
        if (message.type === 'action') {
          ensure(!room.saved, '已保存退出，请双方恢复');
          if (room.state.phase === 'input') validateAction(room.state, seat, message.action);
          else {
            ensure(room.state.phase === 'replace' && requiredSeats(room.state).includes(seat), '当前不需要替换');
            ensure(room.state.players[seat].party.some(mon => mon.id === message.action?.mon && mon.hp > 0), '替换无效');
          }
          ensure(room.inputs[seat] === undefined, '本回合已经提交'); room.inputs[seat] = message.action;
          if (requiredSeats(room.state).every(index => room.inputs[index] !== undefined)) {
            room.state = room.state.phase === 'input' ? resolveRound(room.state, room.inputs) : replaceFainted(room.state, Object.fromEntries(Object.entries(room.inputs).map(([index, action]) => [index, action.mon])));
            barrier(room);
          }
        } else if (message.type === 'prepare') {
          ensure(!room.saved, '已保存退出'); room.state = prepare(room.state, seat, message.action);
          // Every personal mutation also receives a confirmation barrier, making stale clicks harmless.
          barrier(room);
        } else if (message.type === 'save') {
          ensure(room.state.phase === 'prep', '仅战后整备可以保存退出'); room.saved = true;
          room.state.players.forEach(player => { player.ready = false; }); room.state.revision++; barrier(room);
        } else if (message.type === 'resume') {
          ensure(room.saved && room.state.phase === 'prep', '没有待恢复的整备存档'); room.saved = false;
        } else throw new Error('不支持的消息');
      }
      const reply = { type: 'receipt', id: message.id, revision: room.state?.revision ?? 0 };
      room.receipts[key] = { fingerprint, reply };
      const keys = Object.keys(room.receipts); if (keys.length > 512) delete room.receipts[keys[0]];
      await commit(room); send(socket, reply);
    });
  }
  const onUpgrade = (request, socket, head) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/coop/ws') return;
    // Prevent unrelated websites from creating authenticated local room connections.
    try { if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) { socket.destroy(); return; } }
    catch { socket.destroy(); return; }
    wsServer.handleUpgrade(request, socket, head, client => wsServer.emit('connection', client, request));
  };
  httpServer.on('upgrade', onUpgrade);
  wsServer.on('connection', socket => {
    // ws emits errors for malformed frames; isolate the connection instead of crashing Node.
    socket.on('error', () => socket.terminate());
    socket.alive = true; socket.on('pong', () => { socket.alive = true; });
    let chain = Promise.resolve(), queued = 0;
    socket.on('message', data => {
      if (++queued > 64) { socket.close(4008, '消息过于频繁'); return; }
      chain = chain.then(async () => {
        try { await command(socket, JSON.parse(data.toString())); }
        catch (error) { send(socket, { type: 'error', message: error.message }); }
        finally { queued--; }
      });
    });
    socket.on('close', () => {
      if (!socket.roomCode || connections.get(`${socket.roomCode}:${socket.seat}`) !== socket) return;
      connections.delete(`${socket.roomCode}:${socket.seat}`);
      serialized(socket.roomCode, async () => {
        const room = clone(rooms.get(socket.roomCode));
        if (room.state) { room.barrier = true; room.acked = [false, false]; }
        await commit(room);
      }).catch(error => console.error('Room pause persistence failed:', error));
    });
  });
  const heartbeat = setInterval(() => wsServer.clients.forEach(socket => {
    if (!socket.alive) return socket.terminate(); socket.alive = false; socket.ping();
  }), heartbeatMs); heartbeat.unref();
  return { rooms, async close() {
    clearInterval(heartbeat); httpServer.off('upgrade', onUpgrade);
    for (const socket of wsServer.clients) socket.terminate();
    await new Promise(resolve => wsServer.close(resolve)); await Promise.all([...queues.values()]);
  } };
}
