import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, isBuiltin } from 'node:module';
import { resolve, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { WebSocket } from 'ws';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalCoopAdapter } from '../server/original-coop-adapter.mjs';
import { FormalRoomStore } from '../server/formal-coop-service.mjs';
import { formalFixture } from './helpers/formal-ws.mjs';
import { defaultTrainerRoute } from './helpers/native-default-trainer.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';

let api, profiles;
before(async () => {
  await buildCoopRuntime();
  await build({ configFile: false, publicDir: false, logLevel: 'error',
    resolve: { alias: [
      { find: /^phaser$/, replacement: resolve('server/headless-presentation.mjs') },
      { find: /^phaser3-rex-plugins\/.*$/, replacement: resolve('server/headless-rex.mjs') },
    ] }, ssr: { noExternal: true }, build: { ssr: resolve('tests/fixtures/coop-play-ui-entry.mjs'),
      outDir: resolve('build/coop-capture-ui-test'), emptyOutDir: true, minify: false,
      rollupOptions: { external: isBuiltin, output: { format: 'cjs', entryFileNames: 'entry.cjs' } } } });
  api = createRequire(import.meta.url)('../build/coop-capture-ui-test/entry.cjs');
  api.describeOriginalCatalogs();
  const route = await defaultTrainerRoute(); profiles = route.profiles; await route.h.close();
});
const until = async (predicate, description) => {
  for (let n = 0; n < 1500; n++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error(`WAIT_TIMEOUT: ${description}`);
};

// Original phase + original Command/Ball handlers + real IDB/WS/service/Worker.
// Rendering/asset ports are headless: this is not a browser visual acceptance.
async function openUiRoom(seat, t) {
  const directory = await mkdtemp(join(tmpdir(), 'vs02b15-ui-'));
  const adapter = createOriginalCoopAdapter({ fixture: { profileLobby: true,
    seed: 'learning-natural-2', identities: profiles.map(profile => profile.trainer) } });
  const server = await formalFixture(adapter, new FormalRoomStore(directory));
  const peer = await server.client();
  const address = new URL(peer.socket.url), origin = `http://${address.host}`;
  const globals = Object.fromEntries(['location', 'document', 'WebSocket', 'indexedDB', 'localStorage', 'sessionStorage']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const dom = new JSDOM('<body></body>', { url: origin });
  Object.assign(globalThis, { document: dom.window.document, WebSocket, indexedDB: new IDBFactory(),
    location: { origin, protocol: 'http:', host: address.host, search: '', assign() {} },
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage });
  const errors = [], modes = [];
  let peerLatest, peerChain = Promise.resolve();
  const peerModel = api.createOriginalClientModel({ restorePokemonState: api.restorePokemonState, capturePokemonState: api.capturePokemonState });
  const consumer = createSnapshotConsumer({ versions: server.versions, adapter: peerModel,
    isCurrent: () => true, send: message => peer.send(message) });
  peer.socket.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.type === 'snapshot') peerChain = peerChain.then(async () => {
      await consumer(message); peerLatest = message;
    }).catch(error => errors.push(error));
  });
  const ui = { mode: api.Mode.MESSAGE, playSelect() {}, playError() { errors.push(Error('UI_ERROR')); },
    async setMode(mode, ...args) {
      if (ball.active) ball.clear();
      this.mode = mode; modes.push([mode, ...args]);
      if (mode === api.Mode.BALL) ball.show(args);
    } };
  const scene = { ui, getCurrentPhase: () => phase, getStandbyPhase: () => phase,
    getPlayerField: () => [0, 1].map(index => index === phase.seat ? phase.model.applied?.personal.party[0]?.pokemon : null) };
  const phase = new api.CoopPlayPhase(scene);
  phase.model = api.createOriginalClientModel({ restorePokemonState: api.restorePokemonState, capturePokemonState: api.capturePokemonState });
  phase.lastProfile = profiles[seat]; phase.profileDirty = true;
  for (const key of ['status', 'budget', 'roomLine', 'reserveLine', 'controls']) phase[key] = document.createElement('div');
  const originalStatus = phase.setStatus.bind(phase);
  phase.setStatus = (text, error) => { originalStatus(text, error); if (error) errors.push(Error(text)); };
  phase.enterBattle = async () => {}; // Display only; verified real model apply/capture remains intact.
  const ball = Object.assign(Object.create(api.BallUiHandler.prototype), { scene, cursor: 0,
    countsText: { setText() {} }, pokeballSelectContainer: { setVisible() {} },
    pokeballSelectBg: {}, cursorObj: { setPositionRelative() {}, destroy() {} } });
  scene.add = { image: () => ({ setPositionRelative() {}, destroy() {} }) };
  ball.pokeballSelectContainer.add = () => {};
  const command = Object.assign(Object.create(api.CommandUiHandler.prototype), { scene, cursor: 1, cursor2: 1, fieldIndex: seat });
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    phase.stopSession(); await server.close(); await adapter.closeAll(); await peerChain;
    dom.window.close();
    for (const [name, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    await rm(directory, { recursive: true, force: true });
  };
  t.after(close);
  phase.connect(); await until(() => phase.versions, 'primary hello');
  if (seat === 0) {
    await phase.createRoom(); await until(() => phase.roomId, 'primary room');
    peer.send({ type: 'joinRoom', roomId: phase.roomId, name: 'synthetic-peer' });
  } else {
    peer.send({ type: 'createRoom', name: 'synthetic-peer' });
    await until(() => peerLatest, 'peer room'); await phase.joinRoom(peerLatest.roomId);
  }
  await until(() => phase.inputReady && peerLatest && phase.latest?.personal.decision.kind === 'lobby', 'lobby ACK');
  await phase.sendProfile(true, profiles[seat]);
  await until(() => !phase.actionId && phase.latest.shared.ready[seat] && phase.inputReady
    && peerLatest.revision === phase.latest.revision, 'primary profile');
  const submitPeer = action => peer.send({ type: 'submitAction', roomId: peerLatest.roomId, runId: peerLatest.runId,
    decisionId: peerLatest.decisionId, expectedRevision: peerLatest.revision, actionId: crypto.randomUUID(), action });
  submitPeer({ kind: 'profile-ready', profile: profiles[1 - seat], ready: true });
  await until(() => phase.inputReady && phase.latest?.personal.decision.kind === 'wait-actions'
    && peerLatest.personal.decision.kind === 'wait-actions', 'selected Worker battle');
  return { phase, command, ball, ui, peer, errors, modes, server, directory, adapter,
    peerSnapshot: () => peerLatest, submitPeer,
    close };
}

const attack = snapshot => {
  const options = snapshot.personal.decision.options.filter(option => option.kind === 'fight' && (option.target === null || option.target >= 2));
  const moves = snapshot.personal.party[0].pokemon.fields.moveset;
  return options.find(option => [52, 55, 22, 670].includes(moves[option.cursor]?.fields.moveId))
    ?? options.find(option => [33, 10].includes(moves[option.cursor]?.fields.moveId)) ?? options[0];
};
for (const seat of [0, 1]) test(`original Command/Ball seat ${seat} reaches real selected Worker capture and next input`, { timeout: 90000 }, async t => {
  const env = await openUiRoom(seat, t);
  try {
    const { phase, command, ball, ui } = env;
    // Original early forbids throwing while both wild enemies are active.
    // Reach a legal target by normal attacks, never changing field/HP/RNG.
    for (let n = 0; n < 8 && !phase.latest.personal.decision.options.some(option => option.kind === 'ball'); n++) {
      const revision = phase.latest.revision;
      await phase.sendAction(attack(phase.latest), 'normal setup attack');
      await until(() => phase.submitted || env.errors.length, 'setup attack receipt');
      env.submitPeer(attack(env.peerSnapshot()));
      await until(() => phase.latest.revision > revision && phase.inputReady || env.errors.length, 'normal legal capture boundary');
      assert.deepEqual(env.errors, []);
      assert.equal(phase.latest.personal.decision.kind, 'wait-actions');
    }
    const before = phase.latest;
    assert.ok(before.personal.decision.options.some(option => option.kind === 'ball'), JSON.stringify({
      shared: before.shared, resources: before.personal.resources,
      checkpoint: env.server.rooms.get(phase.roomId).checkpoint.nativeCheckpoint?.enemyModifiers,
    }));
    assert.equal(command.processInput(api.Button.ACTION), true);
    await until(() => ui.mode === api.Mode.BALL, 'original ball menu');
    assert.equal(ball.processInput(api.Button.ACTION), true);
    await until(() => phase.submitted || env.errors.length, 'capture receipt');
    assert.deepEqual(env.errors, []);
    const durable = (await env.server.store.load()).find(room => room.roomId === phase.roomId);
    assert.equal(durable.inputs[seat].kind, 'ball');
    const other = env.peerSnapshot();
    env.submitPeer(other.personal.decision.options.find(option => option.kind === 'fight' && (option.target === null || option.target >= 2)));
    await until(() => phase.latest.revision > before.revision && phase.inputReady || env.errors.length, 'capture result ACK');
    assert.deepEqual(env.errors, []);
    assert.equal(phase.latest.personal.resources.pokeballs[0], before.personal.resources.pokeballs[0] - 1);
    assert.ok(phase.latest.events.some(event => event.kind === 'phase-start' && event.phase === 'AttemptCapturePhase'));
    const outcome = phase.latest.events.find(event => event.kind === 'capture-result');
    assert.equal(outcome.seat, seat); assert.equal(outcome.scope, seat); assert.equal(outcome.outcome, 'failed');
    await until(() => env.peerSnapshot().revision === phase.latest.revision, 'peer final snapshot');
    assert.ok(env.peerSnapshot().events.every(event => event.kind !== 'capture-result'));
    assert.equal(phase.latest.personal.decision.kind, 'wait-actions');
    assert.equal(ui.mode, api.Mode.COMMAND);
    assert.match(phase.status.textContent, /捕获失败/);
    assert.deepEqual(await phase.storage.pendingActions(location.origin, phase.roomId, seat), []);
  } finally { await env.close(); }
});
