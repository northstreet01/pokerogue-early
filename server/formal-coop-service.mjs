import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, open, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PROTOCOL_VERSION, CHECKPOINT_VERSION, ContractError, requireContract as check, validateMessage, assertVersions, requireAdapter, SERVER_METHODS, canonical, copy } from '../src/battle-core/coop-contract.mjs';

export const hashProjection = value => createHash('sha256').update(canonical(value)).digest('hex');
const tokenMatches = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class FormalRoomStore {
  constructor(directory = 'server/data/formal-rooms') { this.directory = resolve(directory); }
  async load() {
    await mkdir(this.directory, { recursive: true });
    const rooms = [];
    for (const name of await readdir(this.directory)) if (/^[A-F0-9]{6}\.json$/.test(name)) rooms.push(JSON.parse(await readFile(resolve(this.directory, name), 'utf8')));
    return rooms;
  }
  async save(room) {
    check(/^[A-F0-9]{6}$/.test(room.roomId), 'INVALID_ROOM');
    await mkdir(this.directory, { recursive: true });
    const path = resolve(this.directory, `${room.roomId}.json`), temporary = `${path}.tmp`;
    const file = await open(temporary, 'w', 0o600);
    try { await file.writeFile(canonical(room)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  }
}

// No default original-game adapter: a production connection must fail closed.
export async function attachFormalCoopServer(httpServer, { adapter = null, store = new FormalRoomStore(), heartbeatMs = 15000 } = {}) {
  const versions = { protocolVersion: PROTOCOL_VERSION, checkpointVersion: CHECKPOINT_VERSION, rulesVersion: adapter?.rulesVersion ?? 'early-unavailable', contentHash: adapter?.contentHash ?? 'unavailable' };
  const rooms = new Map(), connections = new Map(), queues = new Map(), confirmations = new Map(), faults = new Map();
  // Load without rewriting incompatible saves. Compatibility is checked on resume.
  for (const room of await store.load()) {
    check(room && /^[A-F0-9]{6}$/.test(room.roomId) && !rooms.has(room.roomId), 'INVALID_ROOM');
    rooms.set(room.roomId, room);
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  const key = (roomId, seat) => `${roomId}:${seat}`;
  const current = socket => connections.get(key(socket.roomId, socket.seat)) === socket && socket.readyState === WebSocket.OPEN;
  const online = room => [0, 1].map(seat => connections.get(key(room.roomId, seat))?.readyState === WebSocket.OPEN);
  const acked = room => [0, 1].map(seat => {
    const socket = connections.get(key(room.roomId, seat)), ack = confirmations.get(key(room.roomId, seat));
    return !!socket && socket.readyState === WebSocket.OPEN && ack === `${socket.epoch}:${room.revision}:${room.decisionId}`;
  });
  const pendingGrants = (room, seat) => room.grants.filter(g => g.seat === seat && !room.grantAcks.includes(g.id));
  const hasScopedEvents = events => Array.isArray(events)
    && events.some(event => event && typeof event === 'object' && Object.hasOwn(event, 'scope'));
  const eventVisibleTo = (event, seat) => !event || typeof event !== 'object' || !Object.hasOwn(event, 'scope')
    || event.scope === 'shared' || event.scope === seat;
  const blocked = room => faults.has(room.roomId) || !online(room).every(Boolean) || !acked(room).every(Boolean) || room.grants.some(g => !room.grantAcks.includes(g.id));
  const invalidate = room => [0, 1].forEach(seat => confirmations.delete(key(room.roomId, seat)));
  const send = (socket, message) => { validateMessage(message, 'server'); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  function status(room) {
    const message = { type: 'syncStatus', roomId: room.roomId, runId: room.runId, revision: room.revision, online: online(room), acked: acked(room), submitted: [0, 1].map(seat => Object.hasOwn(room.inputs, seat)), blocked: blocked(room), reason: faults.get(room.roomId) ?? (!online(room).every(Boolean) ? 'DISCONNECTED' : blocked(room) ? 'WAITING_ACK' : 'READY') };
    for (const seat of [0, 1]) { const socket = connections.get(key(room.roomId, seat)); if (socket) send(socket, message); }
  }
  function serial(roomId, task) {
    const work = (queues.get(roomId) ?? Promise.resolve()).then(task);
    const tail = work.catch(() => {}); queues.set(roomId, tail);
    tail.finally(() => { if (queues.get(roomId) === tail) queues.delete(roomId); });
    return work;
  }
  async function commitTransition(room) {
    try { await store.save(copy(room)); }
    catch {
      faults.set(room.roomId, 'STORAGE_FAILED'); invalidate(room);
      if (rooms.has(room.roomId)) status(rooms.get(room.roomId));
      throw new ContractError('STORAGE_FAILED');
    }
    rooms.set(room.roomId, room);
  }
  async function context(room) {
    assertVersions(room.versions, versions); requireAdapter(adapter, SERVER_METHODS);
    check(Number.isSafeInteger(room.revision) && room.revision >= 0 && typeof room.runId === 'string' && room.runId.length > 0 && Array.isArray(room.seats) && room.seats.length === 2 && room.seats[0] && room.seats.every(s => s === null || typeof s.token === 'string' && typeof s.name === 'string') && room.inputs && room.receipts && Array.isArray(room.grants) && Array.isArray(room.grantAcks) && Array.isArray(room.events), 'INVALID_CHECKPOINT');
    check(!Object.hasOwn(room.checkpoint, 'runId') || room.checkpoint.runId === room.runId, 'RUN_MISMATCH');
    await adapter.validateCheckpoint(copy(room.checkpoint));
    const ctx = await adapter.restoreCheckpoint(copy(room.checkpoint));
    check((await decision(ctx)).id === room.decisionId, 'INVALID_CHECKPOINT');
    // Pending inputs are durable coordinator state in the same atomic room file.
    // Validate them again against the restored decision before acknowledging it.
    const required = (await decision(ctx)).requiredSeats;
    check(room.inputs && !Array.isArray(room.inputs), 'INVALID_CHECKPOINT');
    for (const [seat, action] of Object.entries(room.inputs)) {
      check(['0','1'].includes(seat) && required.includes(Number(seat)), 'INVALID_CHECKPOINT');
      const before = canonical(await adapter.captureCheckpoint(ctx));
      await adapter.validateAction(ctx, Number(seat), copy(action));
      check(before === canonical(await adapter.captureCheckpoint(ctx)), 'VALIDATOR_MUTATED_STATE');
    }
    return ctx;
  }
  async function decision(ctx) {
    const result = await adapter.describeDecision(ctx);
    check(result && typeof result.id === 'string' && result.id.length > 0 && result.id.length <= 128 && Array.isArray(result.requiredSeats) && result.requiredSeats.every(seat => seat === 0 || seat === 1) && new Set(result.requiredSeats).size === result.requiredSeats.length, 'INVALID_DECISION');
    check(result.collection === undefined || ['all','incremental','auto'].includes(result.collection), 'INVALID_DECISION');
    check(result.collection!=='auto'||result.requiredSeats.length===0,'INVALID_DECISION');
    return result;
  }
  async function projection(ctx, seat) {
    const view = copy(await adapter.projectSnapshot(ctx, seat));
    check(view && Object.keys(view).length === 2 && view.shared && typeof view.shared === 'object' && !Array.isArray(view.shared) && view.personal && typeof view.personal === 'object' && !Array.isArray(view.personal), 'INVALID_PROJECTION');
    return view;
  }
  async function snapshot(room, socket) {
    const ctx = await context(room), view = await projection(ctx, socket.seat);
    send(socket, { type: 'snapshot', ...versions, roomId: room.roomId, runId: room.runId, revision: room.revision, decisionId: room.decisionId, connectionEpoch: socket.epoch, seat: socket.seat, ...view, sharedHash: hashProjection(view.shared), personalHash: hashProjection(view.personal), events: copy(hasScopedEvents(room.events) ? room.events.filter(event => eventVisibleTo(event, socket.seat)) : room.events), grants: pendingGrants(room, socket.seat) });
  }
  async function publish(room) {
    for (const seat of [0, 1]) { const socket = connections.get(key(room.roomId, seat)); if (socket && current(socket)) await snapshot(room, socket); }
    status(room);
  }
  function bind(socket, room, seat) {
    const old = connections.get(key(room.roomId, seat));
    socket.roomId = room.roomId; socket.seat = seat; socket.epoch = randomUUID();
    connections.set(key(room.roomId, seat), socket); invalidate(room);
    if (old && old !== socket) old.close(4001, 'Connection replaced');
    send(socket, { type: 'welcome', ...versions, roomId: room.roomId, seat, connectionEpoch: socket.epoch, resumeToken: room.seats[seat].token });
  }
  async function advance(room) {
    if (blocked(room)) return;
    const ctx = await context(room), nextDecision = await decision(ctx);
    if (nextDecision.collection!=='auto'&&(!nextDecision.requiredSeats.length || (nextDecision.collection === 'incremental'
      ? !Object.keys(room.inputs).length : !nextDecision.requiredSeats.every(seat => Object.hasOwn(room.inputs, seat))))) return;
    try {
      // Each accepted input is already durable. Runner only mutates a restored
      // candidate; failures never replace the committed context or consume its RNG.
      const result = await adapter.advanceToDecision(ctx, copy(room.inputs));
      const next = copy(room), checkpoint = copy(await adapter.captureCheckpoint(result.context));
      check(!Object.hasOwn(checkpoint, 'runId') || checkpoint.runId === room.runId, 'RUN_MISMATCH');
      await adapter.validateCheckpoint(copy(checkpoint));
      const restored = await adapter.restoreCheckpoint(copy(checkpoint)), description = await decision(restored);
      check(description.id !== room.decisionId, 'DECISION_ID_REUSED');
      next.checkpoint = checkpoint; next.decisionId = description.id; next.revision++;
      next.inputs = {}; next.events = copy(result.events); check(Array.isArray(next.events), 'INVALID_EVENTS');
      if (hasScopedEvents(next.events)) next.events = next.events.map((event, index) => {
        check(event && typeof event === 'object' && !Array.isArray(event), 'INVALID_EVENTS');
        if (Object.hasOwn(event, 'scope'))
          check(event.scope === 'shared' || event.scope === 0 || event.scope === 1, 'INVALID_EVENT_SCOPE');
        return { ...event, eventId: `${room.roomId}:${next.revision}:${index}`, revision: next.revision, eventIndex: index };
      });
      for (const grant of copy(result.grants)) {
        check(grant && typeof grant.id === 'string' && grant.id.length > 0 && grant.id.length <= 128 && [0, 1].includes(grant.seat) && grant.payload && typeof grant.payload === 'object' && !Array.isArray(grant.payload) && Object.keys(grant).length === 3 && !next.grants.some(g => g.id === grant.id), 'INVALID_GRANT');
        next.grants.push(grant);
      }
      // Validate both projections before publishing or committing an adapter result.
      const views = await Promise.all([projection(restored, 0), projection(restored, 1)]);
      check(canonical(views[0].shared) === canonical(views[1].shared), 'INVALID_SHARED_PROJECTION');
      await commitTransition(next); invalidate(next); await publish(next);
    } catch (error) {
      faults.set(room.roomId, error.code === 'STORAGE_FAILED' ? 'STORAGE_FAILED' : 'RUNNER_FAILED'); invalidate(room); status(rooms.get(room.roomId));
      throw error instanceof ContractError ? error : new ContractError('RUNNER_FAILED');
    }
  }
  async function command(socket, message) {
    validateMessage(message);
    if (message.type === 'hello') {
      check(!socket.hello && !socket.roomId, 'ALREADY_AUTHENTICATED'); assertVersions(message, versions); socket.hello = true;
      send(socket, { type: 'welcome', ...versions, roomId: null, seat: null, connectionEpoch: null, resumeToken: null }); return;
    }
    check(socket.hello, 'HELLO_REQUIRED'); requireAdapter(adapter, SERVER_METHODS);
    if (message.type === 'createRoom') {
      check(!socket.roomId, 'ALREADY_AUTHENTICATED'); check(rooms.size < 500, 'ROOM_LIMIT');
      let roomId; do { roomId = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(roomId));
      const runId = randomUUID(), ctx = await adapter.createInitialContext({ runId });
      const checkpoint = copy(await adapter.captureCheckpoint(ctx)); await adapter.validateCheckpoint(copy(checkpoint));
      const restored = await adapter.restoreCheckpoint(copy(checkpoint));
      const views = await Promise.all([projection(restored, 0), projection(restored, 1)]);
      check(canonical(views[0].shared) === canonical(views[1].shared), 'INVALID_SHARED_PROJECTION');
      const room = { roomId, runId, versions, revision: 0, decisionId: (await decision(restored)).id, checkpoint, seats: [{ name: message.name.trim(), token: randomBytes(32).toString('base64url') }, null], inputs: {}, receipts: {}, grants: [], grantAcks: [], events: [] };
      await commitTransition(room); bind(socket, room, 0); await publish(room); return;
    }
    check(rooms.has(message.roomId), 'ROOM_NOT_FOUND');
    return serial(message.roomId, async () => {
      const room = copy(rooms.get(message.roomId));
      assertVersions(room.versions, versions);
      if (message.type === 'joinRoom' || message.type === 'resumeSeat') {
        check(!socket.roomId, 'ALREADY_AUTHENTICATED'); await context(room);
        let seat;
        if (message.type === 'joinRoom') { check(!room.seats[1], 'ROOM_FULL'); seat = 1; room.seats[1] = { name: message.name.trim(), token: randomBytes(32).toString('base64url') }; }
        else { seat = room.seats.findIndex(entry => entry && tokenMatches(entry.token, message.resumeToken)); check(seat >= 0, 'INVALID_CREDENTIAL'); }
        await commitTransition(room); bind(socket, room, seat); await publish(room); return;
      }
      check(socket.roomId === room.roomId && current(socket), 'CONNECTION_REPLACED'); check(message.runId === room.runId, 'RUN_MISMATCH');
      const seat = socket.seat;
      if (message.type === 'requestSnapshot') {
        if (faults.has(room.roomId)) { await context(room); await commitTransition(room); faults.delete(room.roomId); invalidate(room); }
        // A resync request withdraws previous confirmations even at the same revision.
        invalidate(room);
        // Both confirmations were withdrawn: both clients need a fresh snapshot
        // to drive their model consumer, otherwise the peer can wait forever.
        await publish(room); return;
      }
      check(!faults.has(room.roomId), faults.get(room.roomId));
      if (message.type === 'grantAck') {
        check(message.connectionEpoch === socket.epoch, 'CONNECTION_REPLACED');
        for (const id of message.grantIds) { check(room.grants.some(g => g.id === id && g.seat === seat), 'GRANT_NOT_OWNED'); if (!room.grantAcks.includes(id)) room.grantAcks.push(id); }
        await commitTransition(room); status(room); return;
      }
      if (message.type === 'stateAck') {
        check(message.connectionEpoch === socket.epoch, 'CONNECTION_REPLACED');
        if (message.revision < room.revision) { status(room); return; }
        const projection = await adapter.projectSnapshot(await context(room), seat);
        if (message.revision !== room.revision || message.decisionId !== room.decisionId || message.sharedHash !== hashProjection(projection.shared) || message.personalHash !== hashProjection(projection.personal)) {
          invalidate(room); status(room); throw new ContractError('MODEL_MISMATCH');
        }
        check(!pendingGrants(room, seat).length, 'GRANTS_PENDING');
        confirmations.set(key(room.roomId, seat), `${socket.epoch}:${room.revision}:${room.decisionId}`); status(room); await advance(room); return;
      }
      check(message.type === 'submitAction');
      const receiptKey = `${seat}:${message.actionId}`, fingerprint = canonical(message);
      if (Object.hasOwn(room.receipts, receiptKey)) {
        check(room.receipts[receiptKey].fingerprint === fingerprint, 'ACTION_ID_CONFLICT'); send(socket, room.receipts[receiptKey].reply); return;
      }
      let rejection;
      try {
        check(message.expectedRevision === room.revision && message.decisionId === room.decisionId, 'STALE_DECISION'); check(!blocked(room), 'SYNC_BLOCKED');
        check(!Object.hasOwn(room.inputs, seat), 'ALREADY_SUBMITTED');
        const ctx = await context(room); check((await decision(ctx)).requiredSeats.includes(seat), 'SEAT_NOT_REQUIRED');
        const before = canonical(await adapter.captureCheckpoint(ctx));
        await adapter.validateAction(ctx, seat, copy(message.action));
        check(before === canonical(await adapter.captureCheckpoint(ctx)), 'VALIDATOR_MUTATED_STATE');
      } catch (error) { rejection = error instanceof ContractError ? error.code : 'INVALID_ACTION'; }
      const reply = { type: 'actionReceipt', roomId: room.roomId, runId: room.runId, revision: room.revision, decisionId: room.decisionId, actionId: message.actionId, accepted: !rejection, code: rejection ?? 'ACCEPTED' };
      // Keep receipts for the whole run: evicting them can execute a reused ID.
      room.receipts[receiptKey] = { fingerprint, reply };
      if (!rejection) room.inputs[seat] = copy(message.action);
      await commitTransition(room); send(socket, reply); status(room);
      if (!rejection) await advance(room);
    });
  }
  const upgrade = (request, socket, head) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/coop/v1/ws') return;
    try { if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) { socket.destroy(); return; } } catch { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client));
  };
  httpServer.on('upgrade', upgrade);
  wss.on('connection', socket => {
    socket.on('error', () => socket.terminate()); socket.alive = true; socket.on('pong', () => { socket.alive = true; });
    let chain = Promise.resolve(), queued = 0;
    socket.on('message', data => {
      if (++queued > 64) { socket.close(4008, 'Too many messages'); return; }
      chain = chain.then(async () => {
        try { await command(socket, JSON.parse(data.toString())); }
        catch (error) { send(socket, { type: 'error', code: error instanceof ContractError ? error.code : error instanceof SyntaxError ? 'INVALID_MESSAGE' : 'ADAPTER_FAILED' }); }
        finally { queued--; }
      });
    });
    socket.on('close', () => {
      if (connections.get(key(socket.roomId, socket.seat)) !== socket) return;
      connections.delete(key(socket.roomId, socket.seat));
      const room = rooms.get(socket.roomId); if (room) { invalidate(room); status(room); }
    });
  });
  const timer = setInterval(() => { for (const socket of wss.clients) { if (!socket.alive) socket.terminate(); else { socket.alive = false; socket.ping(); } } }, heartbeatMs); timer.unref();
  return { rooms, versions, async close() { clearInterval(timer); httpServer.off('upgrade', upgrade); for (const socket of wss.clients) socket.terminate(); await new Promise(resolve => wss.close(resolve)); await Promise.all([...queues.values()]); } };
}
