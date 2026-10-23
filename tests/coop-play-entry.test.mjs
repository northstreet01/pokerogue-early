import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, isBuiltin } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'vite';
import { IDBFactory } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import { showCoopExitReturn } from '../src/coop/exit-home.mjs';
import { createPlayStorage } from '../src/coop/play-storage.mjs';
import { pauseAutoResume, autoResumePaused, allowAutoResume } from '../src/coop/exit-recovery.mjs';
import { digestProjection } from '../src/battle-core/coop-client.mjs';
import { PROTOCOL_VERSION, CHECKPOINT_VERSION } from '../src/battle-core/coop-contract.mjs';

let api;
const origin = 'http://localhost:8031';
const versions = { protocolVersion: PROTOCOL_VERSION, checkpointVersion: CHECKPOINT_VERSION,
  rulesVersion: 'early-vs02', contentHash: 'vs02-original-coop' };
before(async () => {
  await build({ configFile: false, publicDir: false, logLevel: 'error',
    resolve: { alias: [
      { find: /^phaser$/, replacement: resolve('server/headless-presentation.mjs') },
      { find: /^phaser3-rex-plugins\/.*$/, replacement: resolve('server/headless-rex.mjs') },
    ] }, ssr: { noExternal: true }, build: { ssr: resolve('tests/fixtures/coop-play-ui-entry.mjs'),
      outDir: resolve('build/coop-play-test'), emptyOutDir: true, minify: false,
      rollupOptions: { external: isBuiltin, output: { format: 'cjs', entryFileNames: 'entry.cjs' } } } });
  api = createRequire(import.meta.url)('../build/coop-play-test/entry.cjs');
  api.describeOriginalCatalogs();
});

function phase() {
  globalThis.location = { origin };
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  globalThis.indexedDB = new IDBFactory();
  const p = new api.CoopPlayPhase({});
  const sent = [], errors = [];
  p.send = message => sent.push(structuredClone(message));
  p.setStatus = (message, error) => { if (error) errors.push(message); };
  p.controls = { replaceChildren() {} };
  p.renderLobbyControls = () => {};
  p.updateLobbyView = () => {};
  p.model = api.createOriginalClientModel({ restorePokemonState: () => { throw new Error('NO_PARTY_EXPECTED'); },
    capturePokemonState: () => { throw new Error('NO_PARTY_EXPECTED'); } });
  return { p, sent, errors };
}

function draftGameData() {
  return Object.assign(Object.create(api.GameData.prototype), { trainerId: 1, secretId: 2, eggs: [],
    dexData: Object.fromEntries([1, 4, 7].map(id => [id, { ivs: [10, 10, 10, 10, 10, 10],
      caughtAttr: 149n, natureAttr: 2, caughtCount: 0, hatchedCount: 0 }])), starterEggMoveData: { 1: 0, 4: 0, 7: 0 } });
}
const draftStarters = ids => ids.map(id => ({ species: api.getPokemonSpecies(id), dexAttr: 149n, nature: 0,
  pokerus: false }));
const waitUntil = async predicate => {
  for (let n = 0; n < 100 && !predicate(); n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), 'bounded async condition');
};
async function draftPhase() {
  const state = phase(), { p } = state, modes = [];
  await p.onMessage(welcome); await p.onMessage(await snapshot());
  p.scene = { gameData: draftGameData(), ui: { setMode: async (...args) => { modes.push(args); } } };
  p.inputReady = true;
  await p.openStarterSelect();
  return { ...state, modes, config: modes.at(-1)[2], confirm: modes.at(-1)[1] };
}
async function commitDraftForUi(p, action, revision) {
  await p.onMessage({ type: 'actionReceipt', roomId: p.roomId, actionId: p.actionId,
    decisionId: p.latest.decisionId, revision: p.latest.revision, accepted: true, code: 'ACCEPTED' });
  const next = await snapshot(revision);
  next.personal.profile = structuredClone(action.profile);
  next.personal.priced = api.priceProfileDraft(action.profile);
  next.shared.budget.used = next.personal.priced.total;
  next.shared.budget.remaining = 14 - next.shared.budget.used;
  next.personalHash = await digestProjection(next.personal); next.sharedHash = await digestProjection(next.shared);
  await p.onMessage(next);
  await p.onMessage({ type: 'syncStatus', roomId: p.roomId, runId: p.runId, revision,
    blocked: false, submitted: [false, false], reason: 'READY' });
}

test('real IDB draft queue coalesces unsent edits, keeps durable bytes, preserves open Starter and readies only accepted selection', async () => {
  const { p, config, confirm, sent, modes } = await draftPhase();
  config.onChange(draftStarters([1]));
  config.onChange(draftStarters([1, 4]));
  config.onChange(draftStarters([4]));
  await waitUntil(() => sent.some(message => message.type === 'submitAction'));
  let actions = sent.filter(message => message.type === 'submitAction');
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].action.profile.starters.map(starter => starter.speciesId), [1]);
  assert.deepEqual(await p.storage.pendingActions(origin, p.roomId, p.seat), [actions[0]]);
  await commitDraftForUi(p, actions[0].action, 1);
  await waitUntil(() => sent.filter(message => message.type === 'submitAction').length === 2);
  actions = sent.filter(message => message.type === 'submitAction');
  assert.deepEqual(actions[1].action.profile.starters.map(starter => starter.speciesId), [4]);
  assert.equal(p.lastProfile.starters[0].speciesId, 4);
  assert.equal(p.starterOpen, true);
  assert.equal(modes.length, 1, 'background update never closes or reopens original Starter');
  confirm(draftStarters([4]));
  await commitDraftForUi(p, actions[1].action, 2);
  await waitUntil(() => sent.filter(message => message.type === 'submitAction').length === 3);
  const ready = sent.filter(message => message.type === 'submitAction')[2];
  assert.equal(ready.action.kind, 'profile-ready'); assert.equal(ready.action.ready, true);
  assert.deepEqual(ready.action.profile, actions[1].action.profile);
});

test('budget rejection retains local draft and stops automatic retries; a new edit can submit without closing Starter', async () => {
  const { p, config, sent, errors, modes } = await draftPhase();
  config.onChange(draftStarters([1]));
  await waitUntil(() => sent.some(message => message.type === 'submitAction'));
  await p.onMessage({ type: 'actionReceipt', roomId: p.roomId, actionId: p.actionId,
    decisionId: p.latest.decisionId, revision: p.latest.revision, accepted: false, code: 'SHARED_BUDGET_EXCEEDED' });
  for (let n = 0; n < 3; n++) await p.onMessage({ type: 'syncStatus', roomId: p.roomId, runId: p.runId,
    revision: 0, blocked: false, submitted: [false, false], reason: 'READY' });
  assert.equal(sent.filter(message => message.type === 'submitAction').length, 1);
  assert.equal(p.lastProfile.starters[0].speciesId, 1);
  assert.ok(errors.some(error => error.includes('SHARED_BUDGET_EXCEEDED')));
  assert.equal(modes.length, 1);
  config.onChange([]);
  await waitUntil(() => sent.filter(message => message.type === 'submitAction').length === 2);
  assert.deepEqual(sent.filter(message => message.type === 'submitAction')[1].action.profile.starters, []);
  config.onCancel();
  await p.sendProfile(true); assert.ok(errors.some(error => error.includes('至少选择一只')));
});

test('stale draft retries once with a new ID only after resync; persisted retry bytes are unchanged', async () => {
  const { p, config, sent } = await draftPhase();
  config.onChange(draftStarters([1]));
  await waitUntil(() => sent.some(message => message.type === 'submitAction'));
  for (let attempt = 0; attempt < 2; attempt++) {
    await p.onMessage({ type: 'actionReceipt', roomId: p.roomId, actionId: p.actionId,
      decisionId: p.latest.decisionId, revision: p.latest.revision, accepted: false, code: 'STALE_DECISION' });
    await p.onMessage(await snapshot());
    await p.onMessage({ type: 'syncStatus', roomId: p.roomId, runId: p.runId, revision: 0,
      blocked: false, submitted: [false, false], reason: 'READY' });
    if (!attempt) await waitUntil(() => sent.filter(message => message.type === 'submitAction').length === 2);
  }
  const actions = sent.filter(message => message.type === 'submitAction');
  assert.equal(actions.length, 2); assert.notEqual(actions[0].actionId, actions[1].actionId);
  assert.deepEqual(actions[0].action, actions[1].action);
  assert.ok(p.lobbyDraft.error.includes('STALE_DECISION'));
});

test('failed draft disk write is bounded; exit and old Starter callbacks cannot save or reactivate a session', async () => {
  const { p, config, sent } = await draftPhase();
  let saves = 0;
  p.storage = { ...p.storage, saveAction: async () => { saves++; throw Error('TEST_DRAFT_STORAGE'); } };
  config.onChange(draftStarters([1])); await waitUntil(() => !!p.lobbyDraft.error);
  await p.flushLobbyDraft(); assert.equal(saves, 1); assert.equal(sent.length, 1); // Only the earlier state ACK.
  p.stopSession(); config.onChange(draftStarters([4]));
  assert.equal(saves, 1); assert.equal(p.lobbyDraft, null);
});

test('original Starter add/pop emits deduplicated drafts; solo callback remains optional and teardown emits no empty edit', () => {
  const gd = draftGameData(), changes = [], species = api.getPokemonSpecies(1);
  const sprite = () => ({ x: 0, y: 0, visible: false, setVisible() {}, setPosition() {}, setTexture() {}, setFrame() {} });
  let options;
  const ui = { setMode() {}, setModeWithoutClear: (_mode, config) => { options = config.options; }, playSelect() {}, playError() {} };
  const handler = Object.assign(Object.create(api.StarterSelectUiHandler.prototype), {
    scene: { ui, gameData: gd }, starterSelectOptions: { onChange: starters => changes.push(starters) },
    starterGens: [], starterCursors: [], starterAttr: [], starterNatures: [], starterMovesets: [],
    genSpecies: [[species]], cursor: 0, genMode: false, startCursorObj: sprite(), cursorObj: sprite(),
    speciesStarterDexEntry: gd.dexData[1], dexAttrCursor: 149n, natureCursor: 0, starterMoveset: [33],
    starterCursorObjs: [sprite()], starterIcons: [sprite()], speciesLoaded: new Map(), speciesStarterMoves: [33],
    pokerusGens: [], pokerusCursors: [], getGenCursorWithScroll: () => 0, updateInstructions() {},
    valueLimitLabel: { setText() {}, setColor() {}, setShadowColor() {} },
  });
  assert.equal(handler.processInput(api.Button.ACTION), true);
  options[0].handler(); // Execute the original add-to-party implementation.
  assert.equal(changes.length, 1); assert.equal(changes[0][0].species, species);
  handler.notifyStarterChange(); assert.equal(changes.length, 1);
  handler.processInput(api.Button.CANCEL); assert.equal(changes.length, 2); assert.deepEqual(changes[1], []);
  handler.starterSelectOptions = {}; handler.notifyStarterChange(); assert.equal(changes.length, 2);
});

test('original Starter restores selected attributes and moves through its details port without publishing a transient empty draft', () => {
  const gd = draftGameData(), changes = [], calls = [], positions = [];
  const sprite = index => ({ setTexture() {}, setFrame() {}, setVisible() {}, setPosition: (...args) => positions[index] = args });
  const handler = Object.assign(Object.create(api.StarterSelectUiHandler.prototype), {
    scene: { gameData: gd }, starterSelectOptions: { onChange: starters => changes.push(starters) },
    starterGens: [], starterCursors: [], starterAttr: [], starterNatures: [], starterMovesets: [],
    genSpecies: [[api.getPokemonSpecies(1), api.getPokemonSpecies(4)]],
    pokerusGens: [], pokerusCursors: [], starterIcons: [sprite(0), sprite(1)],
    starterCursorObjs: [sprite(0), sprite(1)], tryUpdateValue() {}, setGenMode() {}, setCursor() {},
    setSpeciesDetails(species, shiny, form, female, ability, nature) {
      calls.push([species.speciesId, nature]); this.starterMoveset = [33]; this.notifyStarterChange();
    },
  });
  const starters = draftStarters([1, 4]); starters[1].moveset = [10, 45];
  handler.restoreSelectedStarters(starters);
  assert.deepEqual(changes, []);
  assert.deepEqual(calls, [[1, 0], [4, 0]]);
  assert.deepEqual(positions, [[148, 10], [166, 10]]);
  handler.notifyStarterChange();
  assert.deepEqual(changes[0].map(starter => starter.moveset), [[33], [10, 45]]);
  starters[1].moveset.pop(); assert.deepEqual(changes[0][1].moveset, [10, 45]);
});

test('public lobby renders both authoritative selections and fractional budget without replacing a dirty local draft or menu', async () => {
  const { p, config, modes } = await draftPhase();
  p.inputReady = false; config.onChange(draftStarters([1]));
  p.roomLine = {}; p.budget = {}; p.lobbySelections = {};
  const next = await snapshot(1);
  next.shared.selections = [
    { seat: 0, state: 'draft', ready: false, total: 0.5, starters: [{ speciesId: 10, cost: 0.5, formIndex: 0 }] },
    { seat: 1, state: 'confirmed', ready: true, total: 3, starters: [{ speciesId: 4, cost: 3, formIndex: 0 }] },
  ];
  next.shared.ready = [false, true]; next.shared.budget.used = 3.5; next.shared.budget.remaining = 10.5;
  next.personal.profile = { synthetic: 'old-accepted' }; next.personal.priced = { total: 0.5 };
  await api.CoopPlayPhase.prototype.updateLobbyView.call(p, next);
  assert.match(p.lobbySelections.textContent, /席位1 编辑中/);
  assert.match(p.lobbySelections.textContent, /0.5点/); assert.match(p.lobbySelections.textContent, /席位2 已准备/);
  assert.match(p.budget.textContent, /剩余 10.5/);
  assert.equal(p.lastProfile.starters[0].speciesId, 1); assert.equal(modes.length, 1);
});

test('lobby prepare cannot bypass the original selector confirmation; cancel clears readiness intent and old reconnect callbacks expire', async () => {
  const { p, config, confirm, sent, errors } = await draftPhase();
  p.inputReady = false; config.onChange(draftStarters([1]));
  await p.sendProfile(true);
  assert.ok(errors.some(error => error.includes('原选队界面确认')));
  assert.equal(p.draftFinal, false);
  config.onCancel(); assert.equal(p.starterOpen, false); assert.equal(p.draftFinal, false);
  const local = p.lastProfile;
  p.lifecycle++; confirm(draftStarters([4])); config.onChange(draftStarters([4]));
  assert.equal(p.lastProfile, local);
  assert.equal(sent.filter(message => message.type === 'submitAction').length, 0);
});

test('cancel-to-reopen waits for the original fade and expires old same-room Starter callbacks', async () => {
  const { p, config, confirm, sent } = await draftPhase();
  const closing = deferred(), started = deferred(), opens = [];
  p.scene.ui.setMode = async (mode, callback, options) => {
    if (mode === api.Mode.MESSAGE) { started.resolve(); await closing.promise; }
    if (mode === api.Mode.STARTER_SELECT) opens.push({ callback, options });
  };
  config.onCancel(); await started.promise;
  const reopening = p.openStarterSelect();
  await tick(); assert.equal(opens.length, 0);
  config.onChange(draftStarters([1])); confirm(draftStarters([1]));
  assert.equal(sent.filter(message => message.type === 'submitAction').length, 0);
  closing.resolve(); await reopening;
  assert.equal(opens.length, 1); assert.equal(p.starterOpen, true);
});

test('failed original Starter opening leaves to MESSAGE before a fresh retry can open', async () => {
  const { p, config } = await draftPhase();
  config.onCancel(); await p.starterTransition;
  const modes = []; let fail = true;
  p.scene.ui.setMode = async mode => {
    modes.push(mode);
    if (mode === api.Mode.STARTER_SELECT && fail) { fail = false; throw Error('TEST_STARTER_OPEN_FAILED'); }
  };
  await assert.rejects(p.openStarterSelect(), /TEST_STARTER_OPEN_FAILED/);
  await p.starterTransition;
  assert.deepEqual(modes, [api.Mode.STARTER_SELECT, api.Mode.MESSAGE]);
  await p.openStarterSelect(); assert.equal(p.starterOpen, true);
  assert.equal(modes.at(-1), api.Mode.STARTER_SELECT);
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function exitEnvironment(p) {
  const navigations = [], modes = [];
  globalThis.location = { origin, search: '', assign: url => navigations.push(url) };
  const memory = () => {
    const values = new Map();
    return { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key), removeItem: key => values.delete(key) };
  };
  globalThis.localStorage = memory(); globalThis.sessionStorage = memory();
  p.scene.ui = { setMode: async mode => modes.push(mode) };
  let cleared = 0, closed = 0;
  p.presentation = { clear: () => { cleared++; } };
  p.socket = { close: () => { closed++; } };
  return { navigations, modes, cleared: () => cleared, closed: () => closed };
}

test('IDB explicit pause blocks the unique legacy-seat fallback and keeps credentials and original outbox', async () => {
  const store = createPlayStorage(new IDBFactory());
  const value = { roomId: 'ABCDEF', seat: 0, token: 'synthetic-retained' };
  await store.saveSeat(origin, value);
  const old = { id: 'old-session', isCurrent: () => true };
  assert.deepEqual(await store.beginSession(origin, old, true), value);
  const action = { roomId: value.roomId, actionId: 'synthetic-pending', expectedRevision: 3 };
  await store.saveAction(origin, 0, action);
  assert.equal(await store.pauseSession(origin, old), true);
  assert.equal(await store.saveSeat(origin, value, old), false);
  assert.equal(await store.loadSeat(origin), null);
  assert.equal(await store.beginSession(origin, { id: 'reload', isCurrent: () => true }, true), null);
  assert.deepEqual(await store.pendingActions(origin, value.roomId, 0), [action]);
  const next = { id: 'new-session', isCurrent: () => true };
  await store.beginSession(origin, next);
  const newValue = { ...value, roomId: 'FEDCBA', token: 'synthetic-new' };
  assert.equal(await store.saveSeat(origin, newValue, next), true);
  assert.equal(await store.saveSeat(origin, value, old), false);
  assert.equal(await store.pauseSession(origin, old), false);
  assert.deepEqual(await store.loadSeat(origin), newValue);
  assert.deepEqual(await store.pendingActions(origin, newValue.roomId, 0), []);
  assert.deepEqual(await store.pendingActions(origin, value.roomId, 0), [action]);
});

test('real IDB delayed open cannot reactivate a left seat after a newer session commits', async () => {
  const factory = new IDBFactory(), store = createPlayStorage(factory);
  const old = { id: 'old', isCurrent: () => true }, next = { id: 'next', isCurrent: () => true };
  await store.beginSession(origin, old);
  const opened = deferred(); let resume;
  const delayed = createPlayStorage({ open: (...args) => {
    const request = factory.open(...args);
    return new Proxy(request, { set(target, key, value) {
      target[key] = key === 'onsuccess' ? event => { resume = () => value(event); opened.resolve(); } : value;
      return true;
    } });
  } });
  const late = delayed.saveSeat(origin, { roomId: 'ABCDEF', seat: 0, token: 'synthetic-old' }, old);
  await opened.promise;
  await store.pauseSession(origin, old);
  await store.beginSession(origin, next);
  const value = { roomId: 'FEDCBA', seat: 1, token: 'synthetic-next' };
  await store.saveSeat(origin, value, next);
  resume();
  assert.equal(await late, false);
  assert.deepEqual(await store.loadSeat(origin), value);
});

for (const state of ['battle', 'waiting', 'animation', 'disconnected', 'sync-error', 'starter']) {
  test(`local exit from ${state} closes only this session, cancels display and ignores late messages`, async () => {
    const { p, sent } = phase(), env = exitEnvironment(p);
    await p.storage.beginSession(origin, p.session());
    p.roomId = 'ABCDEF'; p.seat = 0; p.token = 'synthetic-retained'; p.epoch = 'epoch-1';
    await p.persistSeat();
    p.inputReady = state === 'battle'; p.starterOpen = state === 'starter';
    p.messageChain = state === 'sync-error' ? new Promise(() => {}) : Promise.resolve();
    const before = await snapshot();
    await p.leaveSession();
    assert.equal(p.disposed, true);
    assert.equal(p.inputReady, false);
    assert.equal(env.closed(), 1); assert.equal(env.cleared(), 1);
    assert.deepEqual(env.navigations, ['/?coopExit=saved']);
    assert.equal(await p.storage.loadSeat(origin), null);
    assert.equal(autoResumePaused(), true);
    await p.onMessage(welcome); await p.onMessage(before);
    await p.onMessage({ type: 'actionReceipt', roomId: 'ABCDEF', actionId: 'old' });
    await p.tryResume(); await p.leaveSession();
    assert.deepEqual(sent, []);
    assert.deepEqual(env.modes, []);
    assert.equal(env.navigations.length, 1);
  });
}

test('exit bounds stalled IDB and reports failed persistence, even with unavailable browser storage', async () => {
  for (const blocked of [false, true]) {
    const { p } = phase(), env = exitEnvironment(p);
    globalThis.localStorage = globalThis.sessionStorage = { setItem() { throw Error('TEST_DENIED'); }, getItem() { throw Error('TEST_DENIED'); } };
    p.storage = { pauseSession: () => blocked ? new Promise(() => {}) : Promise.reject(Error('TEST_IDB_FAILURE')) };
    const start = performance.now();
    await p.leaveSession();
    assert.ok(performance.now() - start < 1500);
    assert.deepEqual(env.navigations, ['/?coopExit=limited']);
    location.search = '?fresh=1';
    assert.equal(autoResumePaused(), true);
    let loads = 0;
    const next = phase(); location.search = '?fresh=1';
    next.p.storage = { beginSession: async () => { loads++; throw Error('MUST_NOT_RESUME'); } };
    await next.p.tryResume();
    assert.equal(loads, 0); assert.deepEqual(next.sent, []);
  }
});

test('exit during durable action write retains original action but never sends it or reopens menus', async () => {
  const { p, sent } = phase(), env = exitEnvironment(p), written = deferred();
  p.roomId = 'ABCDEF'; p.seat = 0; p.epoch = 'epoch-1'; p.latest = await snapshot(); p.inputReady = true;
  await p.storage.beginSession(origin, p.session());
  const store = p.storage;
  p.storage = { ...store, saveAction: async (...args) => { await written.promise; await store.saveAction(...args); } };
  const task = p.sendAction({ kind: 'synthetic-action' }, 'submitted');
  await p.leaveSession(); written.resolve();
  assert.equal(await task, false);
  assert.deepEqual(sent, []); assert.deepEqual(env.modes, []);
  const actions = await store.pendingActions(origin, 'ABCDEF', 0);
  assert.equal(actions.length, 1); assert.equal(actions[0].actionId, p.actionId);
  assert.equal(await store.loadSeat(origin), null);
});

test('exit during snapshot apply, receipt IO or outbox load cannot continue the old message', async () => {
  for (const kind of ['snapshot', 'receipt', 'outbox', 'resume']) {
    const { p, sent } = phase(), env = exitEnvironment(p), blocked = deferred(), started = deferred();
    p.roomId = 'ABCDEF'; p.seat = 0; p.epoch = 'epoch-1'; p.runId = 'original-run';
    p.actionId = 'old-action';
    let task;
    const wait = async value => { started.resolve(); await blocked.promise; return value; };
    if (kind === 'snapshot') {
      p.consumer = () => wait(true);
      task = p.onMessage(await snapshot());
    } else if (kind === 'receipt') {
      p.storage = { ...p.storage, deleteAction: () => wait(null) };
      task = p.onMessage({ type: 'actionReceipt', roomId: 'ABCDEF', actionId: 'old-action' });
    } else if (kind === 'resume') {
      p.roomId = null; p.token = null;
      p.storage = { ...p.storage, beginSession: () => wait({ roomId: 'ABCDEF', token: 'synthetic' }) };
      task = p.tryResume();
    } else {
      p.latest = await snapshot();
      p.storage = { ...p.storage, pendingActions: () => wait([{ roomId: 'ABCDEF', runId: p.runId, actionId: 'old-outbox' }]) };
      task = p.replayOutbox();
    }
    await started.promise; await p.leaveSession(); blocked.resolve(); await task;
    assert.deepEqual(sent, []); assert.deepEqual(env.modes, []);
    assert.equal(p.latest?.revision, kind === 'outbox' ? 0 : undefined);
    assert.equal(p.actionId, 'old-action'); assert.equal(p.runId, 'original-run');
  }
});

test('explicit create wins over a pending auto-resume and stale starter callbacks stay inert after exit', async () => {
  const { p, sent } = phase(), env = exitEnvironment(p), blocked = deferred(), started = deferred();
  const store = p.storage;
  p.storage = { ...store, beginSession: async (...args) => {
    if (args[2]) { started.resolve(); await blocked.promise; return { roomId: 'ABCDEF', token: 'synthetic-old' }; }
    return store.beginSession(...args);
  } };
  const resume = p.tryResume(); await started.promise;
  await p.createRoom(); blocked.resolve(); await resume;
  assert.deepEqual(sent.map(m => m.type), ['createRoom']);
  assert.equal(p.roomId, null);
  let callback, cancel;
  p.scene.ui.setMode = async (_mode, accept, config) => { callback = accept; cancel = config.onCancel; };
  await p.openStarterSelect();
  await p.leaveSession(); callback([]); cancel();
  assert.deepEqual(sent.map(m => m.type), ['createRoom']);
  assert.equal(env.navigations.length, 1);
});

test('old socket callbacks cannot reconnect after exit or feed a newer connection message chain', async t => {
  const previous = globalThis.WebSocket;
  const sockets = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    callbacks = {};
    constructor() { sockets.push(this); }
    addEventListener(name, callback) { this.callbacks[name] = callback; }
    close() { this.readyState = 3; this.callbacks.close?.(); }
  }
  globalThis.WebSocket = Socket;
  t.after(() => { globalThis.WebSocket = previous; });
  const { p, sent } = phase(); exitEnvironment(p);
  location.protocol = 'http:'; location.host = 'localhost:8031';
  p.connect(); const old = sockets[0];
  p.messageChain = new Promise(() => {});
  p.connect(); const next = sockets[1];
  await next.callbacks.open();
  next.callbacks.message({ data: JSON.stringify({ type: 'welcome' }) });
  await p.messageChain;
  await p.leaveSession();
  old.callbacks.open(); old.callbacks.error(); old.close();
  old.callbacks.message({ data: JSON.stringify(welcome) });
  next.callbacks.message({ data: JSON.stringify(welcome) });
  await p.messageChain;
  assert.equal(p.reconnectTimer, null);
  assert.equal(sockets.length, 2);
  assert.deepEqual(sent.map(m => m.type), ['hello']);
});

test('DOM exit remains outside replaced controls with input blocked and hung menu/message queues', async t => {
  const oldDocument = globalThis.document;
  const dom = new JSDOM('<body><div id="app"></div></body>');
  globalThis.document = dom.window.document;
  t.after(() => { globalThis.document = oldDocument; dom.window.close(); });
  const { p } = phase(), env = exitEnvironment(p);
  p.createOverlay();
  const button = document.getElementById('coop-exit-session');
  assert.equal(button.disabled, false);
  assert.ok(!p.controls.contains(button));
  p.controls.replaceChildren();
  assert.equal(document.getElementById('coop-exit-session'), button);
  assert.match(document.getElementById('coop-exit-note').textContent, /仅本人离开/);
  p.inputReady = false; p.messageChain = new Promise(() => {});
  p.scene.ui.setMode = () => new Promise(() => {});
  await p.storage.beginSession(origin, p.session());
  button.click(); await new Promise(resolve => setImmediate(resolve)); await p.exitTask;
  assert.deepEqual(env.navigations, ['/?coopExit=saved']);
  assert.equal(document.getElementById('coop-play-overlay'), null);
});

test('return notice offers explicit fresh cooperative entry, explains failed persistence and preserves the solo page', () => {
  for (const result of ['saved', 'limited', 'unknown', '']) {
    const dom = new JSDOM('<body><div id="app">original solo</div></body>', { url: `${origin}/?coopExit=${result}` });
    try {
      const notice = showCoopExitReturn(dom.window.document, dom.window.location);
      assert.equal(dom.window.document.getElementById('app').textContent, 'original solo');
      if (!['saved', 'limited'].includes(result)) { assert.equal(notice, null); continue; }
      assert.equal(showCoopExitReturn(dom.window.document, dom.window.location), notice);
      assert.equal(notice.querySelector('a').getAttribute('href'), '/coop-play.html?fresh=1');
      assert.match(notice.textContent, result === 'limited' ? /未确认保存/ : /未清除/);
      notice.querySelector('button').click();
      assert.equal(dom.window.document.getElementById('coop-exit-return'), null);
    } finally { dom.window.close(); }
  }
});

test('explicit activation clears fallback pause only after its IDB commit and failed activation preserves it', async () => {
  const { p, sent } = phase(); exitEnvironment(p);
  pauseAutoResume(); assert.equal(autoResumePaused(), true);
  const commit = deferred(), started = deferred(), store = p.storage;
  p.storage = { ...store, beginSession: async (...args) => { started.resolve(); await commit.promise; return store.beginSession(...args); } };
  const task = p.joinRoom('FEDCBA'); await started.promise;
  assert.equal(autoResumePaused(), true); assert.deepEqual(sent, []);
  commit.resolve(); await task;
  assert.equal(autoResumePaused(), false);
  assert.deepEqual(sent.map(m => m.type), ['joinRoom']);
  const next = phase(); exitEnvironment(next.p); pauseAutoResume();
  next.p.storage = { beginSession: async () => { throw Error('TEST_IDB_DENIED'); } };
  await assert.rejects(next.p.createRoom(), /TEST_IDB_DENIED/);
  assert.equal(autoResumePaused(), true); assert.deepEqual(next.sent, []);
  allowAutoResume();
});
const welcome = { type: 'welcome', ...versions, roomId: 'ABCDEF', seat: 0,
  connectionEpoch: 'epoch-1', resumeToken: 'synthetic-test-token' };
async function snapshot(revision = 0, epoch = 'epoch-1') {
  const shared = { format: 3, stage: 'lobby', ready: [false, false], budget: { shared: 14, personal: 10, used: 0, remaining: 14 } };
  const personal = { format: 3, stage: 'lobby', seat: 0, party: [], eggs: null, resources: null,
    profile: null, priced: null, decision: { id: `lobby-${revision}`, kind: 'lobby', requiredSeats: [0, 1] } };
  return { type: 'snapshot', ...versions, roomId: 'ABCDEF', runId: 'run-1', revision,
    decisionId: `lobby-${revision}`, connectionEpoch: epoch, seat: 0, shared, personal,
    sharedHash: await digestProjection(shared), personalHash: await digestProjection(personal), events: [], grants: [] };
}

test('IndexedDB stores the active seat and isolates pending actions by origin/room/seat', async () => {
  const store = createPlayStorage(new IDBFactory());
  await store.saveSeat(origin, { roomId: 'ABCDEF', seat: 0, token: 'synthetic-a' });
  await store.saveSeat(origin, { roomId: 'FEDCBA', seat: 1, token: 'synthetic-b' });
  assert.equal((await store.loadSeat(origin)).roomId, 'FEDCBA');
  assert.equal(await store.loadSeat('http://other-origin'), null);
  const m = { roomId: 'ABCDEF', expectedRevision: 1, actionId: 'synthetic-action' };
  await store.saveAction(origin, 0, m);
  assert.deepEqual(await store.pendingActions(origin, 'ABCDEF', 0), [m]);
  for (const [url, room, seat] of [[origin, 'ABCDEF', 1], [origin, 'FEDCBA', 0], ['http://other-origin', 'ABCDEF', 0]])
    assert.deepEqual(await store.pendingActions(url, room, seat), []);
  await store.deleteAction(origin, 'ABCDEF', 0, m.actionId);
  assert.deepEqual(await store.pendingActions(origin, 'ABCDEF', 0), []);
});

test('new default identity is saved once; existing, corrupt or failed profiles are never overwritten', async () => {
  for (const kind of ['existing', 'new', 'corrupt', 'write-failed']) {
    const { p } = phase(); let saves = 0, connects = 0;
    p.scene.gameData = { loadSystem: async () => {
      if (kind === 'corrupt') throw new Error('TEST_CORRUPT_PROFILE');
      return kind === 'existing';
    }, saveSystem: async () => { saves++; return kind !== 'write-failed'; } };
    p.connect = () => { connects++; };
    if (['corrupt', 'write-failed'].includes(kind)) await assert.rejects(p.loadProfileAndConnect());
    else await p.loadProfileAndConnect();
    assert.equal(saves, ['new', 'write-failed'].includes(kind) ? 1 : 0);
    assert.equal(connects, ['existing', 'new'].includes(kind) ? 1 : 0);
  }
});

test('original selected callback receives real choices and captures a v2 profile without starting local battle', async () => {
  const { p, errors } = phase();
  await p.onMessage(welcome); await p.onMessage(await snapshot());
  p.inputReady = true;
  const species = api.getPokemonSpecies(1), ivs = [10, 10, 10, 10, 10, 10];
  const gd = { trainerId: 1, secretId: 2, eggs: [], dexData: { 1: { ivs, caughtAttr: 149n,
    natureAttr: 2, caughtCount: 0, hatchedCount: 0 } }, starterEggMoveData: { 1: 0 } };
  let originalCallback, options, submitted, lastMode;
  const ui = { setMode: async (mode, callback, config) => {
    lastMode = mode;
    if (callback) { originalCallback = callback; options = config; }
  }, showText: (_text, _delay, callback) => callback(),
    setModeWithoutClear: (_mode, accept) => accept() };
  p.scene = { ui, gameData: gd, clearPhaseQueue: () => assert.fail('must not leave cooperation'),
    pushPhase: () => assert.fail('must not start solo phase') };
  p.sendAction = async action => { submitted = action; p.actionId = 'draft-pending'; return true; };
  await p.openStarterSelect();
  const handler = Object.assign(Object.create(api.StarterSelectUiHandler.prototype), {
    scene: p.scene, starterSelectCallback: originalCallback, starterSelectOptions: options,
    starterGens: [0], starterCursors: [0], genSpecies: [[species]], starterAttr: [149n],
    starterNatures: [0], starterMovesets: [undefined], pokerusGens: [], pokerusCursors: [],
  });
  assert.equal(handler.tryStart(true), true); // Real original confirmation/callback implementation.
  assert.equal(submitted.kind, 'profile-draft');
  assert.equal(submitted.ready, false, 'final readiness waits for the authoritative draft snapshot');
  assert.equal(submitted.profile.version, 2);
  assert.deepEqual(submitted.profile.starters[0].ivs, ivs);
  assert.equal(submitted.profile.starters[0].speciesId, 1);
  assert.equal(p.starterOpen, false);
  handler.starterGens = []; handler.starterCursors = []; handler.statsMode = false;
  handler.processInput(api.Button.CANCEL); // Original cancellation uses the injected cooperative callback.
  await p.openStarterSelect();
  gd.starterEggMoveData = {};
  originalCallback([{ species, dexAttr: 149n, nature: 0, pokerus: false }]);
  await p.starterTransition;
  assert.equal(p.starterOpen, false);
  assert.equal(lastMode, api.Mode.MESSAGE);
  assert.ok(errors.some(message => message.includes('MISSING_EGG_MOVE_RECORD')));
});

test('stale/corrupt snapshots cannot replace the verified page state or pin an old epoch', async () => {
  const { p, sent, errors } = phase();
  await p.onMessage(welcome);
  const current = await snapshot(2);
  await p.onMessage(current);
  assert.equal(p.latest.revision, 2);
  const old = await snapshot(1);
  await p.onMessage(old);
  assert.equal(p.latest.revision, 2);
  await p.onMessage(await snapshot(3, 'old-epoch'));
  assert.equal(p.epoch, 'epoch-1');
  assert.equal(p.latest.revision, 2);
  const corrupt = await snapshot(3); corrupt.shared.budget.used = 100;
  p.inputReady = true;
  await p.onMessage(corrupt);
  assert.equal(p.inputReady, false);
  assert.equal(p.latest.revision, 2);
  assert.ok(errors.some(message => message.includes('SNAPSHOT_CORRUPT')));
  assert.equal(sent.filter(message => message.type === 'stateAck').length, 1);
});

test('outbox survives a missing receipt and replays the exact message once per resumed epoch', async () => {
  const first = phase(); await first.p.onMessage(welcome);
  await first.p.onMessage(await snapshot());
  first.p.inputReady = true;
  const retained = api.captureProfileDraft(draftGameData(), draftStarters([1]));
  await first.p.sendProfile(true, retained);
  await first.p.sendProfile(true, retained);
  const [message] = first.sent.filter(message => message.type === 'submitAction');
  assert.ok(message);
  assert.equal(first.sent.filter(message => message.type === 'submitAction').length, 1);
  const second = phase(); second.p.storage = first.p.storage;
  await second.p.onMessage({ ...welcome, connectionEpoch: 'epoch-2' });
  await second.p.onMessage(await snapshot(0, 'epoch-2'));
  assert.deepEqual(second.sent.find(m => m.type === 'submitAction'), message);
  await second.p.onMessage(await snapshot(0, 'epoch-2'));
  assert.equal(second.sent.filter(m => m.type === 'submitAction').length, 1);
  await second.p.onMessage({ type: 'actionReceipt', roomId: message.roomId, actionId: message.actionId,
    accepted: false, code: 'SHARED_BUDGET_EXCEEDED' });
  assert.deepEqual(await second.p.storage.pendingActions(origin, 'ABCDEF', 0), []);
  assert.deepEqual(second.p.lastProfile, retained);
});

test('local write failure prevents send and retains the selection for retry', async () => {
  const { p, sent, errors } = phase();
  await p.onMessage(welcome); await p.onMessage(await snapshot());
  p.inputReady = true;
  const retained = api.captureProfileDraft(draftGameData(), draftStarters([1])); p.lastProfile = retained;
  p.storage = { ...p.storage, saveAction: async () => { throw new Error('TEST_STORAGE_FULL'); } };
  await p.sendProfile(true);
  assert.equal(sent.filter(message => message.type === 'submitAction').length, 0);
  assert.equal(p.actionId, null);
  assert.deepEqual(p.lastProfile, retained);
  assert.ok(errors.some(message => message.includes('TEST_STORAGE_FULL')));
});

test('a rejected draft survives an older committed profile and unrelated syncStatus cannot open input', async () => {
  const { p } = phase();
  await p.onMessage(welcome);
  const current = await snapshot(); await p.onMessage(current);
  p.roomLine = {}; p.budget = {};
  const draft = { synthetic: 'rejected-draft' };
  p.lastProfile = draft; p.profileDirty = true;
  current.personal.profile = { synthetic: 'old-accepted-selection' };
  current.personal.priced = { total: 3 };
  api.CoopPlayPhase.prototype.updateLobbyView.call(p, current);
  assert.deepEqual(p.lastProfile, draft);
  await p.onMessage({ type: 'syncStatus', roomId: 'OTHER', runId: 'run-1', revision: 0, blocked: false });
  assert.equal(p.inputReady, false);
  await p.onMessage({ type: 'syncStatus', roomId: 'ABCDEF', runId: 'run-1', revision: 0, blocked: false });
  assert.equal(p.inputReady, true);
});

test('battle syncStatus opens the original command port only for an ACK-ready unsubmitted seat', async () => {
  const { p } = phase();
  const modes = [];
  p.scene = { ui: { setMode: async (...args) => modes.push(args) }, getPlayerField: () => [{ id: 101 }, { id: 202 }] };
  p.roomId = 'ABCDEF'; p.runId = 'run-1'; p.seat = 1;
  p.latest = { revision: 4, personal: { decision: { kind: 'wait-actions', requiredSeats: [0, 1] } } };
  const status = { type: 'syncStatus', roomId: p.roomId, runId: p.runId, revision: 4,
    submitted: [false, false], blocked: false };
  await p.onMessage(status);
  assert.deepEqual(modes, [[api.Mode.COMMAND, 1]]);
  assert.equal(p.getPokemon().id, 202);
  assert.equal(p.scene.standbyPhase, p);
  await p.onMessage({ ...status, submitted: [false, true] });
  assert.equal(p.battleInputActive, false);
  assert.equal(modes.at(-1)[0], api.Mode.MESSAGE);
  await p.onMessage({ ...status, blocked: true });
  assert.equal(p.battleInputActive, false);
  assert.equal(p.handleCommand(0, 0), false);
});

test('original target callback cancels without intent and cannot submit after revision or epoch replacement', async () => {
  for (const changed of ['cancel', 'revision', 'epoch', 'valid']) {
    const { p, sent } = phase();
    const modes = [];
    p.scene = { ui: { setMode: async (...args) => modes.push(args) },
      getPlayerField: () => [{ id: 101, getMoveset: () => [{ moveId: 33 }] }] };
    p.roomId = 'ABCDEF'; p.runId = 'run-1'; p.seat = 0; p.epoch = 'epoch-1';
    p.inputReady = p.battleInputActive = true;
    p.latest = { runId: p.runId, revision: 4, decisionId: 'turn-4', personal: { decision: {
      kind: 'wait-actions', requiredSeats: [0, 1], options: [2, 3].map(target =>
        ({ kind: 'fight', pokemonId: 101, cursor: 0, target })) } } };
    assert.equal(p.handleCommand(0, 0), true);
    assert.deepEqual(modes[0].slice(0, 3), [api.Mode.TARGET_SELECT, 0, 33]);
    assert.deepEqual(modes[0][4], [2, 3]);
    if (changed === 'revision') p.latest = { ...p.latest, revision: 5 };
    if (changed === 'epoch') p.epoch = 'epoch-2';
    await modes[0][3](changed === 'cancel' ? -1 : 2);
    assert.equal(sent.length, changed === 'valid' ? 1 : 0);
    if (changed === 'valid') {
      assert.deepEqual(sent[0].action, { kind: 'fight', cursor: 0, pokemonId: 101, target: 2 });
      assert.equal(p.battleInputActive, false);
      assert.equal(p.handleCommand(0, 0), false);
    }
    if (changed === 'cancel') assert.equal(modes.at(-1)[0], api.Mode.FIGHT);
  }
});

test('battle outbox write failure keeps original move input usable; automatic targets retain server null', async () => {
  const { p, sent } = phase(); const modes = [];
  p.scene = { ui: { setMode: async (...args) => modes.push(args) },
    getPlayerField: () => [{ id: 101, getMoveset: () => [{ moveId: 45 }] }] };
  p.roomId = 'ABCDEF'; p.runId = 'run-1'; p.seat = 0; p.epoch = 'epoch-1';
  p.inputReady = p.battleInputActive = true;
  p.latest = { runId: p.runId, revision: 4, decisionId: 'turn-4', personal: { decision: {
    kind: 'wait-actions', requiredSeats: [0, 1], options: [{ kind: 'fight', pokemonId: 101, cursor: 0, target: null }] } } };
  p.storage = { ...p.storage, saveAction: async () => { throw new Error('TEST_DISK_FAILURE'); } };
  assert.equal(p.handleCommand(0, 0), true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sent.length, 0); assert.equal(p.actionId, null);
  assert.equal(p.battleInputActive, true); assert.equal(modes.length, 0);
  assert.equal(p.interceptCommand(1), true); assert.equal(p.interceptCommand(2), true);
});

test('a battle presentation failure cannot ACK or replace the last verified page snapshot', async () => {
  const { p, sent, errors } = phase(); await p.onMessage(welcome);
  const old = await snapshot(); await p.onMessage(old); sent.length = 0;
  const next = await snapshot(1);
  next.personal.decision.kind = 'wait-actions';
  next.personalHash = await digestProjection(next.personal);
  p.enterBattle = async () => { throw new Error('TEST_ASSET_FAILURE'); };
  await p.onMessage(next);
  assert.equal(sent.some(m => m.type === 'stateAck'), false);
  assert.equal(sent.filter(m => m.type === 'requestSnapshot').length, 1);
  assert.equal(p.latest.revision, 0);
  assert.equal(p.inputReady, false);
  assert.ok(errors.some(e => e.includes('TEST_ASSET_FAILURE')));
});

test('an old durable fight receipt clears outbox without locking a new battle decision', async () => {
  const { p } = phase(); const modes = [];
  p.scene = { ui: { setMode: async (...args) => modes.push(args) }, getPlayerField: () => [{ id: 101 }] };
  p.roomId = 'ABCDEF'; p.runId = 'run-1'; p.seat = 0;
  p.latest = { revision: 5, decisionId: 'turn-5', personal: { decision: { kind: 'wait-actions', requiredSeats: [0, 1] } } };
  p.inputReady = true; p.actionId = 'old-action'; p.pendingAction = { action: { kind: 'fight' } };
  await p.onMessage({ type: 'actionReceipt', roomId: p.roomId, actionId: 'old-action', accepted: true,
    revision: 4, decisionId: 'turn-4' });
  assert.equal(p.actionId, null); assert.equal(p.submitted, false);
  assert.equal(p.battleInputActive, true);
  assert.deepEqual(modes, [[api.Mode.COMMAND, 0]]);
});


function preparationPhase() {
  const { p, sent, errors } = phase(); const modes = [], controls = [];
  p.roomId = 'ABCDEF'; p.runId = 'run-1'; p.seat = 0; p.epoch = 'epoch-1';
  p.inputReady = true;
  p.scene = { gameMode: { hasNoShop: false }, ui: { setMode: async (...args) => modes.push(args) } };
  p.renderPreparationControls = player => controls.push(structuredClone(player));
  p.latest = { runId: p.runId, revision: 4, decisionId: 'prep-4', personal: { resources: { money: 300 },
    decision: { id: 'prep-4', kind: 'preparation', requiredSeats: [0, 1], players: {
      ready: false, rewardResolved: false, rewards: [{ id: 'reward-a', type: api.captureModifierTypeState(api.modifierTypes.POTION().withIdFromFunc(api.modifierTypes.POTION)) }],
      shop: [], rerollCost: 250, selection: null, subdecision: null } } } };
  return { p, sent, errors, modes, controls };
}

test('original preparation UI receives authoritative shop/rewards and reroll without changing gameMode', async () => {
  const { p, modes, controls, sent } = preparationPhase(); const mode = p.scene.gameMode;
  await p.openPreparationMenu(); await p.openPreparationMenu();
  assert.equal(modes.length, 1); assert.equal(modes[0][0], api.Mode.MODIFIER_SELECT);
  assert.equal(modes[0][2][0].type.id, 'POTION');
  assert.deepEqual(modes[0][5].shopOptions, []);
  assert.equal(modes[0][5].allowReroll, true); assert.equal(modes[0][5].allowTransfer, false);
  assert.equal(modes[0][5].preparation.rewardResolved, false);
  assert.equal(p.scene.gameMode, mode); assert.equal(p.scene.money, 300);
  assert.equal(modes[0][3](1, 0), false); assert.equal(sent.length, 0);
  assert.equal(controls.length, 0, 'completion stays inside the original reward page');
});

test('blocked preparation can reopen the same decision after ACK; stale original callbacks cannot send', async () => {
  const { p, modes, sent } = preparationPhase(); await p.openPreparationMenu(); const callback = modes[0][3];
  await p.onMessage({ type: 'syncStatus', roomId: p.roomId, runId: p.runId, revision: 4,
    blocked: true, submitted: [false, false], reason: 'WAITING_ACK' });
  await p.onMessage({ type: 'syncStatus', roomId: p.roomId, runId: p.runId, revision: 4,
    blocked: false, submitted: [false, false], reason: 'READY' });
  assert.equal(modes.filter(m => m[0] === api.Mode.MODIFIER_SELECT).length, 2);
  p.epoch = 'epoch-2'; assert.equal(callback(-1), false);
  assert.equal(sent.length, 0);
});

test('preparation write failure preserves the original menu without a false skip', async () => {
  const { p, sent, modes } = preparationPhase(); await p.openPreparationMenu();
  p.storage = { ...p.storage, saveAction: async () => { throw new Error('TEST_WRITE_FAILURE'); } };
  assert.equal(await p.sendPreparation('skip-reward'), false);
  assert.equal(sent.length, 0); assert.equal(p.actionId, null);
  assert.equal(p.latest.personal.decision.players.rewardResolved, false);
  assert.equal(modes.filter(mode => mode[0] === api.Mode.MODIFIER_SELECT).length, 2);
});

test('old personal buttons cannot rebase a skip/ready operation onto a newer decision', async () => {
  const { p, sent } = preparationPhase(); const snapshot = p.latest, epoch = p.epoch;
  p.latest = { ...snapshot, revision: 5, decisionId: 'prep-5' };
  assert.equal(await p.sendPreparation('skip-reward', snapshot, epoch), false);
  assert.equal(sent.length, 0);
  assert.equal(await p.sendPreparation('ready'), false);
  assert.equal(sent.length, 0);
});

test('resolved preparation keeps the original shop page and exposes in-page unready without allowing a second reward', async () => {
  const { p, modes, sent, errors } = preparationPhase();
  Object.assign(p.latest.personal.decision.players, { rewardResolved: true, ready: true });
  await p.openPreparationMenu();
  assert.equal(modes[0][0], api.Mode.MODIFIER_SELECT);
  assert.equal(modes[0][5].preparation.ready, true); assert.equal(modes[0][5].allowReroll, false);
  modes[0][3](1, 0); assert.ok(errors.some(error => error.includes('不能重复领取')));
  modes[0][5].preparation.onComplete();
  await waitUntil(() => sent.length === 1); assert.equal(sent[0].action.operation, 'unready');
});

test('original ModifierSelect cancel remains usable when a coop callback declines to close', () => {
  let calls = 0;
  const handler = Object.create(api.ModifierSelectUiHandler.prototype);
  handler.scene = { ui: { playSelect() {} } };
  handler.player = true; handler.awaitingActionInput = true;
  handler.inputPresentation = {};
  handler.onActionInput = row => { assert.equal(row, -1); calls++; return false; };
  assert.equal(handler.processInput(api.Button.CANCEL), true);
  assert.equal(handler.awaitingActionInput, true);
  assert.equal(handler.processInput(api.Button.CANCEL), true);
  assert.equal(calls, 2);
});

test('original ModifierSelect completion supports keyboard navigation and does not replace solo actions', () => {
  let completed = 0, selected = 0;
  const handler = Object.assign(Object.create(api.ModifierSelectUiHandler.prototype), {
    getUi: () => ({ playSelect() {} }), awaitingActionInput: true, rowCursor: 0, cursor: 0,
    inputPresentation: { preparation: { onComplete: () => completed++ } },
    rerollButtonContainer: { visible: true }, transferButtonContainer: { visible: false },
    setCursor(cursor) { this.cursor = cursor; return true; },
    onActionInput: () => { selected++; return false; },
  });
  assert.equal(handler.processInput(api.Button.RIGHT), true); assert.equal(handler.cursor, 2);
  assert.equal(handler.processInput(api.Button.ACTION), true); assert.equal(completed, 1);
  handler.rowCursor = 1; handler.cursor = 0;
  assert.equal(handler.processInput(api.Button.SUBMIT), true); assert.equal(completed, 2);
  assert.equal(handler.processInput(api.Button.ACTION), true); assert.equal(selected, 1);
  handler.inputPresentation = {};
  assert.equal(handler.processInput(api.Button.SUBMIT), false);
  assert.equal(handler.processInput(api.Button.ACTION), true); assert.equal(selected, 2);
});

test('in-page completion blocks unresolved reward or pending choice and ignores stale callbacks', async () => {
  for (const pending of ['reward', 'selection', 'subdecision']) {
    const { p, modes, sent, errors } = preparationPhase();
    if (pending !== 'reward') {
      p.latest.personal.decision.players.rewardResolved = true;
      p.latest.personal.decision.players[pending] = { pending: true };
    }
    await p.openPreparationMenu(); modes.at(-1)[5].preparation.onComplete();
    assert.deepEqual(sent, []); assert.ok(errors.some(message => message.includes('必要选择')));
  }
  const { p, modes, sent } = preparationPhase();
  p.latest.personal.decision.players.rewardResolved = true;
  await p.openPreparationMenu(); const old = modes.at(-1)[5].preparation.onComplete;
  p.preparationSignature = ''; await p.openPreparationMenu();
  old(); assert.deepEqual(sent, []);
  modes.at(-1)[5].preparation.onComplete(); modes.at(-1)[5].preparation.onComplete();
  await waitUntil(() => sent.length === 1); assert.equal(sent[0].action.operation, 'ready');
});

test('authoritative shop rows map both original shop lines to durable buy IDs without local money changes', async () => {
  for (const [row, cursor, index] of [[3, 5, 5], [2, 1, 7], [2, 0, 0]]) {
    const { p, modes, sent } = preparationPhase(); let updates = 0;
    p.scene.updateMoneyText = () => updates++;
    p.latest.personal.decision.players.shop = Array.from({ length: row === 2 && index === 0 ? 3 : 8 }, (_, i) =>
      ({ ...rewardOption('POKEBALL'), id: `shop-${i}`, cost: 125 + i }));
    p.latest.personal.decision.players.rewardResolved = true;
    await p.openPreparationMenu(); const original = modes.at(-1);
    assert.equal(original[5].shopOptions[index].cost, 125 + index);
    assert.equal(original[5].allowReroll, false); assert.equal(updates, 1);
    original[3](row, cursor); original[3](row, cursor);
    await waitUntil(() => sent.length === 1);
    assert.deepEqual(sent[0].action, { kind: 'preparation', operation: 'buy', optionId: `shop-${index}`,
      pokemonId: null, moveIndex: null, fusionId: null });
    assert.equal(p.scene.money, 300); assert.equal(p.latest.personal.resources.money, 300);
  }
});

test('preparation reroll submits once and a mode failure is reported without losing the persisted action', async () => {
  const { p, modes, sent, errors } = preparationPhase();
  await p.openPreparationMenu(); const select = modes.at(-1)[3];
  p.scene.ui.setMode = async () => { throw Error('TEST_SHOP_MODE_FAILED'); };
  select(0, 0); select(0, 0);
  await waitUntil(() => errors.some(message => message.includes('TEST_SHOP_MODE_FAILED')));
  assert.equal(sent.length, 1); assert.equal(sent[0].action.operation, 'reroll');
  assert.ok(p.actionId); assert.equal(p.latest.personal.resources.money, 300);
});


test('a verified duplicate snapshot preserves the active personal menu callbacks and controls', async () => {
  const { p } = phase(); let views = 0;
  p.updateLobbyView = () => { views++; };
  await p.onMessage(welcome);
  const message = await snapshot(); await p.onMessage(message); const active = p.latest;
  await p.onMessage(structuredClone(message));
  assert.equal(p.latest, active); assert.equal(views, 1);
});

test('a rejected personal receipt restores the same preparation decision controls', async () => {
  const { p, controls, modes } = preparationPhase();
  await p.openPreparationMenu();
  assert.equal(await p.sendPreparation('skip-reward'), true);
  const actionId = p.actionId;
  await p.onMessage({ type: 'actionReceipt', roomId: p.roomId, actionId, revision: 4,
    decisionId: 'prep-4', accepted: false, code: 'TEST_REJECTION' });
  assert.equal(p.actionId, null);
  assert.equal(controls.length, 0);
  assert.equal(modes.filter(m => m[0] === api.Mode.MODIFIER_SELECT).length, 2);
  assert.equal(p.latest.personal.decision.players.rewardResolved, false);
});

test('authoritative snapshot events are replayed once in order and never mutate rule state', async () => {
  const calls = [];
  const scene = { ui: {
    setMode: async () => {},
    showText: (text, _delay, callback) => { calls.push(text); callback?.(); },
    getMessageHandler: () => ({ showDialogue: (text, _speaker, delay, callback, _callbackDelay, prompt) => {
      assert.equal(delay, 0); assert.equal(prompt, false); calls.push(text); callback?.();
    } }),
  }, tweens: { add: config => { config.onComplete?.(); return { stop() {} }; }, killTweensOf() {} }, getField: () => [] };
  const presentation = new api.CoopBattlePresentation(scene);
  const events = [
    { kind: 'message', text: 'first', eventId: 'room:1:0', eventIndex: 0 },
    { kind: 'dialogue', text: 'trainer', speaker: 'Youngster', eventId: 'room:1:1', eventIndex: 1 },
  ];
  await presentation.playEvents(events, { revision: 1, isCurrent: () => true });
  assert.deepEqual(calls, ['first', 'trainer']);
  await presentation.playEvents(events, { revision: 1, isCurrent: () => true });
  assert.deepEqual(calls, ['first', 'trainer'], 'a replayed snapshot event id is not displayed twice');
});

test('failed presentation can retry the same snapshot instead of caching a successful signature', async () => {
  const { p, errors } = phase();
  p.seat=0;p.epoch='retry-epoch';p.model={applied:{}};
  p.scene={ui:{setMode:async()=>{} }};
  p.renderReserve=()=>{};
  p.clearPreparationParty=p.clearActiveSwitchParty=()=>{};
  let attempts=0;
  p.presentation={apply:async()=>{if(++attempts===1)throw new Error('synthetic asset failure');},playEvents:async()=>{}};
  const value={connectionEpoch:'retry-epoch',decisionId:'retry',revision:1,shared:{waveIndex:1},personal:{decision:{kind:'wait-actions'}}};
  await p.enterBattle(value);
  assert.equal(p.battleSignature,'');assert.ok(errors.some(error=>error.includes('synthetic asset failure')));
  await p.enterBattle(value);assert.equal(attempts,2);assert.notEqual(p.battleSignature,'');
  await p.enterBattle(value);assert.equal(attempts,2,'a successful duplicate does not rebuild the menu');
});

test('cancel during message display prevents later text and leaves unfinished events replayable', async () => {
  let entered;
  const pending = new Promise(resolve => { entered = resolve; });
  const calls = [];
  const presentation = new api.CoopBattlePresentation({ ui: {
    setMode: () => assert.fail('replay must not start a new mode transition'),
    showText: text => { calls.push(text); entered(); },
  } });
  const event = { kind: 'message', eventId: 'cancelled-message', text: 'old text' };
  const playing = presentation.playEvents([event, {kind:'message',text:'late text',eventIndex:1,eventId:'late-message'}]);
  await pending;
  presentation.cancel();
  await playing;
  assert.deepEqual(calls, ['old text']);
  assert.equal(presentation.playedEvents.has(event.eventId), false);
});

test('abandoned original fade clears its overlay and stops the outstanding tween', () => {
  const calls = [];
  const ui = Object.create(api.UI.prototype);
  ui.overlay = { setVisible(value) { calls.push(['visible',value]); return this; },
    setAlpha(value) { calls.push(['alpha',value]); return this; } };
  ui.scene = { tweens: { killTweensOf: target => assert.equal(target,ui.overlay) } };
  ui.overlayActive = true;
  ui.cancelFade();
  assert.equal(ui.overlayActive,false);
  assert.deepEqual(calls,[['visible',false],['alpha',0]]);
});

test('replay failure restores committed HP on the display copy without touching the model', async () => {
  const model = { hp: 9 }, display = { hp: model.hp, updateInfo: async () => {} };
  const presentation = new api.CoopBattlePresentation({ damageNumberHandler: { add() {} } });
  presentation.displayed = [display]; presentation.displayedById.set(1, display);
  presentation.playPhase = async () => { throw new Error('synthetic resource failure'); };
  await assert.rejects(presentation.playEvents([
    { kind: 'damage-display', pokemonId: 1, remainingHp: 20, eventIndex: 0, eventId: 'hp-intermediate' },
    { kind: 'phase-start', phase: 'test', eventIndex: 1, eventId: 'hp-failure' },
  ]), /synthetic resource failure/);
  assert.equal(display.hp, 9); assert.equal(model.hp, 9);
  assert.equal(presentation.playedEvents.has('hp-failure'), false);
});

test('experience replay closes the original bar before showing another member', async () => {
  const calls = [];
  const presentation = new api.CoopBattlePresentation({ partyExpBar: {
    showPokemonExp: async (pokemon, exp) => calls.push(['show', pokemon.id, exp]),
    hide: async () => calls.push(['hide']),
  } });
  presentation.displayedById.set(1, { id: 1 }); presentation.displayedById.set(2, { id: 2 });
  await presentation.playEvents([1, 2].map((id, eventIndex) => ({ kind: 'experience-bar',
    pokemonId: id, exp: 7, eventIndex, eventId: `exp-${id}` })));
  assert.deepEqual(calls, [['show', 1, 7], ['hide'], ['show', 2, 7], ['hide']]);
});

test('original animation abort stops its tween and restores sprites once; solo completion remains valid', () => {
  for (const cancel of [true, false]) {
    const configs = [], stopped = [], sprites = [];
    const pokemon = () => {
      const sprite = { pipelineData: {}, setPosition() { return this; }, setScale() { return this; },
        setAlpha() { return this; }, setAngle() { return this; }, setVisible(value) { this.visible = value; return this; } };
      sprites.push(sprite);
      return { x: 0, y: 0, isOnField: () => true, getSprite: () => sprite };
    };
    const animation = new api.CommonBattleAnim(0, pokemon(), pokemon());
    animation.getAnim = () => ({ frames: [] });
    const scene = { tweens: { addCounter: config => {
      configs.push(config); return { stop: () => stopped.push(true) };
    } } };
    let completed = 0;
    const controller = new AbortController();
    animation.play(scene, () => completed++, cancel ? controller.signal : undefined);
    if (cancel) { controller.abort(); configs[0].onRepeat(); }
    configs[0].onComplete();
    assert.equal(completed, 1); assert.equal(stopped.length, cancel ? 1 : 0);
    assert.ok(sprites.every(sprite => sprite.visible));
  }
});

test('trainer entrance events reuse the original trainer sprite and tween without server state', async () => {
  const positions = [], tweens = [];
  const trainer = { setVisible(value) { positions.push(['visible', value]); return this; },
    setX(value) { positions.push(['x', value]); return this; } };
  const scene = { trainer, tweens: { add: config => { tweens.push(config); config.onComplete?.(); return { stop() {} }; },
    killTweensOf() {} } };
  const presentation = new api.CoopBattlePresentation(scene);
  await presentation.playEvents([{ kind: 'phase-start', phase: 'ShowTrainerPhase', eventId: 'trainer:1',
    eventIndex: 0 }], { revision: 1, isCurrent: () => true });
  assert.deepEqual(positions, [['visible', true], ['x', -72]]);
  assert.equal(tweens[0].x, 106);
});

test('original display uses authoritative biome and day/night offset across seats and refresh', async () => {
  const sprite = () => ({ setTexture() { return this; }, setPosition() { return this; }, setVisible() { return this; } });
  const base = player => ({ base: sprite(), player, props: [], add() {}, setPosition() { return this; }, setVisible() { return this; } });
  const scene = offset => ({ waveCycleOffset: offset, arena: { biomeType: 99 }, arenaBg: sprite(),
    arenaBgTransition: sprite(), arenaPlayer: base(true), arenaEnemy: base(false), trainer: sprite() });
  const shared = { field: [null, null, null, null], pokemon: [], biome: 0,
    waveCycleOffset: 17, terrainColorRatio: 1, waveIndex: 2 };
  for (const offset of [0, 20, 35]) {
    const displayScene = scene(offset);
    await new api.CoopBattlePresentation(displayScene).apply({ shared }, { byId: new Map() });
    assert.equal(displayScene.waveCycleOffset, 17);
    assert.equal(displayScene.arena.biomeType, 0);
  }
});

test('late original trainer asset completion cannot revive a cleared trainer; refresh uses its stable position', async () => {
  const sprite = () => ({ visible: false, setTexture() { return this; }, setFrame() { return this; },
    setPosition(x,y) { this.x=x; this.y=y; return this; }, setVisible(value) { this.visible=value; return this; } });
  const base = player => ({ base:sprite(),player,props:[],add(){},setPosition(){return this;},setVisible(){return this;} });
  let complete;
  const scene = { arena:{},arenaBg:sprite(),arenaBgTransition:sprite(),arenaPlayer:base(true),arenaEnemy:base(false),trainer:sprite(),
    textures:{exists:()=>false},loadAtlas(){},load:{once(_event,callback){complete=callback;},isLoading:()=>false,start(){}},
    anims:{generateFrameNames:()=>[],create(){}} };
  const shared = { field:[null,null,null,null],pokemon:[],biome:0,waveCycleOffset:17,terrainColorRatio:1 };
  const type=Object.keys(api.trainerConfigs).find(key=>api.trainerConfigs[key].getSpriteKey);
  const trainer={type:Number(type),variant:0,spriteKey:api.trainerConfigs[type].getSpriteKey(false)};
  const presentation=new api.CoopBattlePresentation(scene);
  const old=presentation.apply({shared:{...shared,trainer}},{byId:new Map()});
  assert.equal(typeof complete,'function');
  await presentation.apply({shared},{byId:new Map()});
  complete();await old;
  assert.equal(scene.trainer.visible,false,'a late loader cannot overwrite the new wild encounter');
  scene.textures.exists=()=>true;
  await presentation.apply({shared:{...shared,trainer}},{byId:new Map()});
  assert.equal(scene.trainer.visible,true);assert.equal(scene.trainer.x,106,'restored trainer does not wait offscreen for a deduplicated entrance');
});

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function rewardOption(id) {
  return { id: `reward-${id}`, type: api.captureModifierTypeState(api.modifierTypes[id]().withIdFromFunc(api.modifierTypes[id])) };
}
function personalPotionPhase() {
  const state = preparationPhase(), { p } = state;
  const runtime = api.createOriginalRuntime('personal-party-menu', { trainerId: 1, secretId: 2 });
  const pokemon = api.constructOriginalPokemon(runtime, 1, 5);
  const entry = { id: pokemon.id, pokemon };
  p.model = { applied: { personal: { party: [entry] } } };
  p.scene.party = ['original-public-field'];
  p.scene.currentBattle = { double: true };
  // The callback tests exercise the real controller with a display-only port;
  // headless RuleContainer deliberately cannot create actual Phaser sprites.
  p.makeTeamPokemon = entry => {
    const copy = api.restorePokemonState(api.capturePokemonState(entry.pokemon));
    copy.scene = p.scene; copy.generateName();
    copy.init = () => {}; copy.loadAssets = async () => {}; copy.destroy = () => {};
    return copy;
  };
  return { ...state, entry };
}

test('production-minified reward type identity is not needed for original ball submission', async () => {
  const { p, sent } = preparationPhase();
  const option = rewardOption('GREAT_BALL');
  await p.choosePreparationReward(option, p.latest, p.epoch);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action.optionId, option.id);
  assert.equal(sent[0].action.pokemonId, null);
});

test('original Potion Party cancellation reopens reward menu without altering verified Pokemon', async () => {
  const { p, sent, modes, entry } = personalPotionPhase();
  const party = p.scene.party, battle = p.scene.currentBattle;
  const before = api.capturePokemonState(entry.pokemon), oldScene = entry.pokemon.scene;
  await p.choosePreparationReward(rewardOption('POTION'), p.latest, p.epoch);
  assert.notEqual(p.scene.party[0], entry.pokemon);
  assert.equal(p.scene.currentBattle.getBattlerCount(), 1);
  assert.equal(p.scene.currentBattle.double, false);
  const callback = modes.at(-1)[3]; callback(6); await tick();
  assert.equal(p.scene.party, party); assert.equal(p.scene.currentBattle, battle);
  assert.equal(entry.pokemon.scene, oldScene);
  assert.deepEqual(api.capturePokemonState(entry.pokemon), before);
  assert.equal(modes.at(-1)[0], api.Mode.MODIFIER_SELECT); assert.equal(sent.length, 0);
  callback(0); await tick(); assert.equal(sent.length, 0);
});

test('blocked Potion Party releases temporary view and obsolete target callbacks cannot send', async () => {
  const { p, sent, modes } = personalPotionPhase();
  const party = p.scene.party, battle = p.scene.currentBattle;
  await p.choosePreparationReward(rewardOption('POTION'), p.latest, p.epoch);
  const callback = modes.at(-1)[3];
  await p.onMessage({ type: 'syncStatus', roomId: p.roomId, runId: p.runId, revision: 4,
    blocked: true, submitted: [false, false], reason: 'WAITING_ACK' });
  assert.equal(p.scene.party, party); assert.equal(p.scene.currentBattle, battle);
  await p.onMessage({ type: 'syncStatus', roomId: p.roomId, runId: p.runId, revision: 4,
    blocked: false, submitted: [false, false], reason: 'READY' });
  callback(0); await tick(); assert.equal(sent.length, 0);
});

test('Potion target submits stable personal id and failed outbox can reopen selection', async () => {
  for (const failed of [false, true]) {
    const { p, sent, modes, entry } = personalPotionPhase();
    if (failed) p.storage = { ...p.storage, saveAction: async () => { throw Error('TEST_DISK_FAILURE'); } };
    await p.choosePreparationReward(rewardOption('POTION'), p.latest, p.epoch);
    modes.at(-1)[3](0, api.PartyOption.APPLY); await tick(); await tick();
    for (let i = 0; i < 8 && !failed && !sent.length; i++) await tick();
    assert.equal(sent.length, failed ? 0 : 1);
    if (failed) assert.equal(modes.at(-1)[0], api.Mode.MODIFIER_SELECT);
    else assert.equal(sent[0].action.pokemonId, entry.id);
  }
});

test('original Revive selector accepts only a fainted owned target and submits no local effect', async () => {
  const { p, sent, modes, entry } = personalPotionPhase(); entry.pokemon.hp = 0;
  await p.choosePreparationReward(rewardOption('REVIVE'), p.latest, p.epoch);
  assert.equal(modes.at(-1)[0], api.Mode.PARTY);
  assert.equal(modes.at(-1)[4](p.scene.party[0]), null);
  await modes.at(-1)[3](0, api.PartyOption.APPLY);
  assert.equal(sent[0].action.pokemonId, entry.id);
  assert.equal(entry.pokemon.hp, 0);
});

test('original PP Party passes original move filters, stable target and move index without restoring locally', async () => {
  for (const id of ['ETHER', 'PP_UP']) {
    const { p, modes, sent, entry } = personalPotionPhase();
    entry.pokemon.getMoveset()[0].ppUsed = 2;
    const before = api.capturePokemonState(entry.pokemon), option = rewardOption(id);
    await p.choosePreparationReward(option, p.latest, p.epoch, 'buy');
    const party = modes.at(-1);
    assert.equal(party[1], api.PartyUiMode.MOVE_MODIFIER);
    assert.equal(typeof party[5], 'function');
    assert.equal(party[5](p.scene.party[0].getMoveset()[0]), null);
    assert.ok(party[7].allowedOptions.includes(api.PartyOption.MOVE_1));
    await party[3](0, api.PartyOption.MOVE_1);
    assert.deepEqual(sent[0].action, { kind: 'preparation', operation: 'buy', optionId: option.id,
      pokemonId: entry.id, moveIndex: 0, fusionId: null });
    assert.deepEqual(api.capturePokemonState(entry.pokemon), before);
  }
});

test('reopened preparation fences old reward and completion callbacks during a target transition', async () => {
  const { p, modes, sent } = personalPotionPhase();
  await p.openPreparationMenu(); const old = modes.at(-1);
  old[3](1, 0);
  await waitUntil(() => modes.at(-1)[0] === api.Mode.PARTY);
  const select = modes.at(-1)[3];
  await select(6);
  assert.equal(modes.at(-1)[0], api.Mode.MODIFIER_SELECT);
  old[3](-1); old[5].preparation.onComplete(); old[3](1, 0);
  await tick(); assert.deepEqual(sent, []);
  assert.equal(modes.at(-1)[0], api.Mode.MODIFIER_SELECT);
  modes.at(-1)[3](-1);
  await waitUntil(() => sent.length === 1); assert.equal(sent[0].action.operation, 'skip-reward');
});

test('late shop transition after exit cannot persist or submit to the old room', async () => {
  const { p, modes, sent } = preparationPhase();
  p.latest.personal.decision.players.shop = [{ ...rewardOption('POKEBALL'), id: 'shop-0', cost: 200 }];
  await p.openPreparationMenu(); const select = modes.at(-1)[3], transition = deferred();
  p.scene.ui.setMode = () => transition.promise;
  select(2, 0); p.stopSession(); transition.resolve();
  await tick(); assert.deepEqual(sent, []); assert.equal(p.actionId, null);
});

test('personal DOM skip while Potion Party is open releases the temporary view before outbox work', async () => {
  const { p, sent, modes } = personalPotionPhase();
  const party = p.scene.party, battle = p.scene.currentBattle;
  await p.choosePreparationReward(rewardOption('POTION'), p.latest, p.epoch);
  const callback = modes.at(-1)[3];
  assert.equal(await p.sendPreparation('skip-reward'), true);
  assert.equal(p.scene.party, party); assert.equal(p.scene.currentBattle, battle);
  callback(0); await tick();
  assert.equal(sent.length, 1); assert.equal(sent[0].action.operation, 'skip-reward');
});

function activeSwitchPhase() {
  const state = personalPotionPhase(), { p, entry } = state;
  const runtime = api.createOriginalRuntime('switch-party-menu', { trainerId: 1, secretId: 2 });
  const pokemon = api.constructOriginalPokemon(runtime, 4, 5);
  p.model.applied.personal.party.push({ id: pokemon.id, pokemon });
  p.latest.personal.decision = { id: 'fight-4', kind: 'wait-actions', requiredSeats: [0, 1],
    options: [{ kind: 'switch', pokemonId: pokemon.id }] };
  p.latest.decisionId = 'fight-4';
  p.battleInputActive = true;
  p.getPokemon = () => entry.pokemon;
  return { ...state, target: pokemon.id };
}

test('active Party cancel, failed outbox and rejection restore Command without mutating verified party', async () => {
  for (const outcome of ['cancel', 'disk-failure', 'rejected']) {
    const { p, modes, sent, target } = activeSwitchPhase();
    const party = p.scene.party, battle = p.scene.currentBattle;
    const before = p.model.applied.personal.party.map(e => api.capturePokemonState(e.pokemon));
    if (outcome === 'disk-failure') p.storage = { ...p.storage, saveAction: async () => { throw Error('TEST_DISK_FAILURE'); } };
    await p.openActiveSwitchParty();
    assert.equal(p.scene.currentBattle.getBattlerCount(), 1);
    await modes.at(-1)[3](outcome === 'cancel' ? 6 : 1,
      outcome === 'cancel' ? api.PartyOption.CANCEL : api.PartyOption.SEND_OUT);
    if (outcome === 'rejected') {
      assert.equal(sent[0].action.pokemonId, target);
      await p.onMessage({ type: 'actionReceipt', roomId: p.roomId, actionId: p.actionId,
        decisionId: p.latest.decisionId, revision: p.latest.revision, accepted: false, code: 'POKEMON_TRAPPED' });
    } else assert.equal(sent.length, 0);
    assert.equal(p.scene.party, party); assert.equal(p.scene.currentBattle, battle);
    assert.equal(modes.at(-1)[0], api.Mode.COMMAND);
    assert.deepEqual(p.model.applied.personal.party.map(e => api.capturePokemonState(e.pokemon)), before);
  }
});

test('active Party selection cannot submit after its awaited mode transition crosses revision or epoch', async () => {
  for (const stale of ['revision', 'epoch']) {
    const { p, modes, sent } = activeSwitchPhase();
    await p.openActiveSwitchParty();
    let finish;
    const originalMode = p.scene.ui.setMode;
    p.scene.ui.setMode = () => new Promise(resolve => { finish = resolve; });
    modes.at(-1)[3](1, api.PartyOption.SEND_OUT);
    if (stale === 'revision') p.latest = { ...p.latest, revision: 5, decisionId: 'fight-5' };
    else p.epoch = 'epoch-2';
    p.scene.ui.setMode = originalMode;
    finish(); await tick(); await tick();
    assert.equal(sent.length, 0, 'old choice must not acquire the new decision envelope');
  }
});

test('cooperative active Party permits only SEND_OUT and summary; local release and Baton Pass cannot execute', async () => {
  const { p, modes, sent } = activeSwitchPhase();
  await p.openActiveSwitchParty();
  const permitted = modes.at(-1)[7].allowedOptions;
  assert.deepEqual(permitted, [api.PartyOption.SEND_OUT, api.PartyOption.SUMMARY]);
  for (const option of [api.PartyOption.RELEASE, api.PartyOption.UNPAUSE_EVOLUTION, api.PartyOption.PASS_BATON]) {
    const handler = Object.assign(Object.create(api.PartyUiHandler.prototype), {
      optionsMode: true, options: [option], optionsCursor: 0,
      allowedOptions: new Set([...permitted, api.PartyOption.CANCEL]),
      getUi: () => ({ playError() {} }),
      scene: { getParty: () => assert.fail('unsupported local operation must not reach party mutation') },
    });
    assert.equal(handler.processInput(api.Button.ACTION), false);
  }
  modes.at(-1)[3](1, api.PartyOption.PASS_BATON);
  await tick(); await tick();
  assert.equal(sent.length, 0, 'Baton Pass must not be silently submitted as ordinary switch');
});

function capturePhase() {
  const state = activeSwitchPhase(), { p } = state;
  p.latest.personal.resources = { pokeballs: { 0: 5, 1: 0, 2: 0, 3: 0, 4: 0 } };
  p.latest.personal.decision.options = [{ kind: 'ball', pokeballType: 0, targetId: 123 }];
  return state;
}

test('original BALL port uses server inventory/options; cancel, failed outbox and rejection reopen Command', async () => {
  for (const outcome of ['cancel', 'disk-failure', 'rejected']) {
    const { p, modes, sent } = capturePhase();
    if (outcome === 'disk-failure') p.storage = { ...p.storage, saveAction: async () => { throw Error('TEST_DISK_FAILURE'); } };
    await p.openCaptureMenu();
    assert.equal(modes.at(-1)[0], api.Mode.BALL);
    p.openBattleCommand();
    assert.equal(modes.at(-1)[0], api.Mode.BALL, 'repeated ready notifications retain the open ball menu');
    const config = modes.at(-1)[1];
    assert.deepEqual(config.counts, p.latest.personal.resources.pokeballs);
    assert.notEqual(config.counts, p.latest.personal.resources.pokeballs);
    assert.deepEqual(config.allowed, [0]);
    if (outcome === 'cancel') await config.cancel();
    else await config.select(0);
    if (outcome === 'rejected') {
      assert.deepEqual(sent[0].action, { kind: 'ball', pokeballType: 0, targetId: 123 });
      await p.onMessage({ type: 'actionReceipt', roomId: p.roomId, actionId: p.actionId,
        decisionId: p.latest.decisionId, revision: p.latest.revision, accepted: false, code: 'INVALID_CAPTURE_TARGET' });
    } else assert.equal(sent.length, 0);
    assert.equal(modes.at(-1)[0], api.Mode.COMMAND);
    assert.equal(p.latest.personal.resources.pokeballs[0], 5, 'browser never settles ball consumption');
  }
});

test('original BALL callback cannot cross awaited revision or epoch, and cannot select an unlisted ball', async () => {
  for (const stale of ['revision', 'epoch']) {
    const { p, modes, sent } = capturePhase();
    await p.openCaptureMenu();
    const config = modes.at(-1)[1];
    await config.select(4); assert.equal(sent.length, 0);
    let finish;
    p.scene.ui.setMode = () => new Promise(resolve => { finish = resolve; });
    const pending = config.select(0);
    if (stale === 'revision') p.latest = { ...p.latest, revision: 6, decisionId: 'fight-6' };
    else p.epoch = 'epoch-2';
    finish(); await pending;
    assert.equal(sent.length, 0);
  }
});

test('a cancelled or replaced BALL menu cannot submit through its old same-snapshot callback', async () => {
  for (const change of ['cancel', 'replace']) {
    const { p, modes, sent } = capturePhase();
    await p.openCaptureMenu(); const old = modes.at(-1)[1];
    if (change === 'cancel') await old.cancel();
    else await p.openCaptureMenu();
    await old.select(0);
    assert.deepEqual(sent, []);
    assert.equal(p.latest.personal.resources.pokeballs[0], 5);
  }
});

test('BALL transition failure is reported and restores Command without an unhandled selection promise', async () => {
  const { p, modes, sent, errors } = capturePhase();
  await p.openCaptureMenu(); const config = modes.at(-1)[1];
  const setMode = p.scene.ui.setMode;
  let fail = true;
  p.scene.ui.setMode = async (...args) => {
    if (fail) { fail = false; throw Error('TEST_BALL_TRANSITION_FAILED'); }
    return setMode(...args);
  };
  await assert.doesNotReject(config.select(0));
  assert.deepEqual(sent, []);
  assert.ok(errors.some(message => message.includes('TEST_BALL_TRANSITION_FAILED')));
  assert.equal(modes.at(-1)[0], api.Mode.COMMAND);
  assert.equal(p.battleInputActive, true);
});

test('a repeated ready status cannot reopen Command while the chosen BALL is leaving its original menu', async () => {
  const { p, modes, sent } = capturePhase();
  await p.openCaptureMenu(); const config = modes.at(-1)[1];
  const transition = deferred(), started = deferred(), setMode = p.scene.ui.setMode;
  p.scene.ui.setMode = async (...args) => {
    if (args[0] === api.Mode.MESSAGE) { started.resolve(); await transition.promise; }
    return setMode(...args);
  };
  const selected = config.select(0); await started.promise;
  const commandCount = modes.filter(([mode]) => mode === api.Mode.COMMAND).length;
  await p.onMessage({ type: 'syncStatus', roomId: p.roomId, runId: p.runId, revision: p.latest.revision,
    blocked: false, submitted: [false, false] });
  assert.equal(modes.filter(([mode]) => mode === api.Mode.COMMAND).length, commandCount);
  transition.resolve(); await selected;
  assert.equal(sent.length, 1);
});

test('BALL show failure recovers to Command and an exiting pending selection cannot write or send', async () => {
  for (const failure of ['show', 'exit']) {
    const { p, modes, sent, errors } = capturePhase();
    const setMode = p.scene.ui.setMode;
    if (failure === 'show') {
      p.scene.ui.setMode = async (...args) => {
        if (args[0] === api.Mode.BALL) throw Error('TEST_BALL_SHOW_FAILED');
        return setMode(...args);
      };
      await assert.doesNotReject(p.openCaptureMenu());
      assert.equal(modes.at(-1)[0], api.Mode.COMMAND);
      assert.ok(errors.some(error => error.includes('TEST_BALL_SHOW_FAILED')));
    } else {
      await p.openCaptureMenu(); const config = modes.at(-1)[1], transition = deferred();
      p.scene.ui.setMode = () => transition.promise;
      const selected = config.select(0);
      p.stopSession(); transition.resolve(); await selected;
      assert.deepEqual(await p.storage.pendingActions(origin, p.roomId, p.seat), []);
    }
    assert.deepEqual(sent, []);
  }
});

test('an old rejected Command transition cannot disable input for a newer verified snapshot', async () => {
  const { p } = capturePhase();
  let reject;
  const pending = new Promise((_resolve, fail) => { reject = fail; });
  p.battleInputActive = false; p.scene.ui.setMode = () => pending;
  p.openBattleCommand(); p.latest = { ...p.latest, revision: p.latest.revision + 1 };
  reject(Error('TEST_OLD_COMMAND_FAILED'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.battleInputActive, true);
});

test('authoritative capture outcomes use the original message port and do not request local input', async () => {
  const messages = [];
  const presentation = new api.CoopBattlePresentation({ ui: { showText: (text, delay, callback) => {
    assert.equal(delay, 0); assert.equal(callback, undefined); messages.push(text);
  } } });
  await presentation.playEvents(['failed', 'caught', 'cancelled'].map((outcome, index) => ({
    kind: 'capture-result', outcome, pokeballType: 0, eventIndex: index, eventId: `synthetic-capture-${index}`,
  })));
  assert.match(messages[0], /捕获失败/); assert.match(messages[1], /捕获成功/);
  assert.match(messages[2], /未消耗精灵球/);
});

test('original BallUiHandler keeps its navigation/cancel and filters unlisted cooperative balls', () => {
  const selected = [], counts = { 0: 5, 1: 9, 2: 0, 3: 0, 4: 0 }; let cancelled = 0, errors = 0;
  const handler = Object.assign(Object.create(api.BallUiHandler.prototype), {
    cursor: 0, selection: { counts, allowed: [0], select: ball => selected.push(ball), cancel: () => cancelled++ },
    getUi: () => ({ playError: () => errors++, playSelect() {} }),
    setCursor(cursor) { this.cursor = cursor; return true; },
  });
  handler.processInput(api.Button.ACTION);
  handler.processInput(api.Button.DOWN); handler.processInput(api.Button.ACTION);
  handler.processInput(api.Button.CANCEL);
  assert.deepEqual(selected, [0]); assert.equal(errors, 1); assert.equal(cancelled, 1);
  assert.deepEqual(counts, { 0: 5, 1: 9, 2: 0, 3: 0, 4: 0 });
});

test('old inventory notice does not modify the restored captured models',()=>{
 const {p,entry}=personalPotionPhase(),pokemon=api.restorePokemonState(api.capturePokemonState(entry.pokemon));
 const before=api.capturePokemonState(pokemon);p.model.applied.personal.reserve=[{id:pokemon.id,pokemon}];
 p.reserveLine={hidden:true,textContent:''};p.renderReserve();
 assert.equal(p.reserveLine.hidden,false);assert.match(p.reserveLine.textContent,/旧版捕获待处理/);
 assert.deepEqual(api.capturePokemonState(pokemon),before);
 p.model.applied.personal.reserve=[];p.renderReserve();assert.equal(p.reserveLine.hidden,true);assert.equal(p.reserveLine.textContent,'');
});

function captureChoicePhase(legacy=false,underfull=false) {
 const state=personalPotionPhase(),{p,entry}=state,first=p.model.applied.personal.party[0];
 p.model.applied.personal.party=Array.from({length:underfull?3:6},(_,index)=>{
  const pokemon=api.restorePokemonState(api.capturePokemonState(entry.pokemon));pokemon.id=index===0?first.id:index-1;
  return {id:pokemon.id,owner:0,group:'party',index,pokemon};
 });
 p.model.applied.personal.reserve=[];
 if(legacy){
  const pokemon=api.restorePokemonState(api.capturePokemonState(entry.pokemon));pokemon.id=8;
  p.model.applied.personal.reserve=[{id:8,owner:0,group:'reserve',index:0,pokemon}];
  const action=(choice,releaseId)=>({kind:'preparation',operation:'legacy-capture',pokemonId:8,choice,releaseId});
  p.latest.personal.decision.legacyCapture={pokemonId:8,options:[action('discard',null),...(underfull?[action('keep',null)]:p.model.applied.personal.party.map(e=>action('keep',e.id)))]};
 }else p.latest.personal.decision={id:'capture-4',kind:'capture-choice',requiredSeats:[0],options:[{kind:'capture-choice',releaseId:null},...p.model.applied.personal.party.map(e=>({kind:'capture-choice',releaseId:e.id}))]};
 p.latest.decisionId=p.latest.personal.decision.id;
 return state;
}
const ruleState=p=>[...p.model.applied.personal.party,...p.model.applied.personal.reserve].map(e=>api.capturePokemonState(e.pokemon));

function learningMenuPhase() {
  const state = personalPotionPhase(), { p, entry } = state;
  const pokemonId = entry.id;
  p.latest.decisionId = 'learn-4';
  p.latest.personal.decision = { id: 'learn-4', kind: 'learn-move', requiredSeats: [0], learn: { pokemonId, moveId: 73 },
    options: [0, 1, 2, 3, null].map(slot => ({ kind: 'learn-move', pokemonId, slot })) };
  return state;
}

test('original learning Confirm/Summary uses loaded copies, cancels/reselects and submits server slot only', async () => {
  const { p, entry, modes, sent } = learningMenuPhase(), before = api.capturePokemonState(entry.pokemon);
  const modesBefore = () => modes.length;
  await p.openDecisionInput();
  const count = modesBefore(), oldAccept = modes.at(-1)[1];
  await p.openDecisionInput(); assert.equal(modes.length, count, 'duplicate snapshot does not replace active menu');
  await oldAccept();
  const summary = modes.at(-1);
  assert.equal(summary[0], api.Mode.SUMMARY);
  assert.equal(summary[2], api.SummaryUiMode.LEARN_MOVE);
  assert.notEqual(summary[1], entry.pokemon);
  await summary[4](4); assert.equal(modes.at(-1)[0], api.Mode.CONFIRM);
  assert.equal(sent.length, 0, 'cancel asks whether to stop teaching');
  await modes.at(-1)[2]();
  await modes.at(-1)[1]();
  const select = modes.at(-1)[4];
  await select(9); assert.equal(sent.length, 0);
  await select(1); assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].action, { kind: 'learn-move', pokemonId: entry.id, slot: 1 });
  await oldAccept(); await select(0); assert.equal(sent.length, 1, 'consumed callbacks cannot submit again');
  assert.deepEqual(api.capturePokemonState(entry.pokemon), before, 'verified model is never edited');
});

test('learning decline requires second confirmation and IndexedDB failure reopens the decision', async () => {
  const { p, modes, sent } = learningMenuPhase();
  const store = p.storage; p.storage = { ...store };
  p.storage.saveAction = async () => { throw Error('synthetic-disk-failure'); };
  await p.openDecisionInput(); await modes.at(-1)[2]();
  assert.equal(sent.length, 0);
  await modes.at(-1)[1]();
  assert.equal(p.actionId, null); assert.equal(sent.length, 0);
  assert.equal(modes.at(-1)[0], api.Mode.CONFIRM);
  p.storage = store;
  await modes.at(-1)[2](); await modes.at(-1)[1]();
  assert.equal(sent[0].action.slot, null);
});

test('learning callbacks reject changed epoch across mode awaits and dispose after pending asset load', async () => {
  const { p, modes, sent } = learningMenuPhase();
  await p.openDecisionInput();
  const accept = modes.at(-1)[1], setMode = p.scene.ui.setMode;
  p.scene.ui.setMode = async (...args) => { await setMode(...args); p.epoch = 'other-epoch'; };
  await accept();
  assert.notEqual(modes.at(-1)[0], api.Mode.SUMMARY);
  assert.equal(sent.length, 0);
  p.clearTeamParty(); p.epoch = 'epoch-1'; p.scene.ui.setMode = setMode;
  let loaded, destroyed = 0;
  const make = p.makeTeamPokemon;
  p.makeTeamPokemon = entry => { const copy = make(entry); copy.loadAssets = () => new Promise(r => { loaded = r; });
    copy.destroy = () => { destroyed++; }; return copy; };
  const loading = p.openDecisionInput();
  p.clearTeamParty(); assert.equal(destroyed, 0);
  loaded(); await loading; assert.equal(destroyed, 1);
  assert.equal(sent.length, 0);
});

async function captureConfirmation(state) {
 const {p,modes}=state;await p.openDecisionInput();assert.equal(modes.at(-1)[0],api.Mode.CONFIRM);
 await modes.at(-1)[1]();assert.equal(modes.at(-1)[0],api.Mode.PARTY);
 await modes.at(-1)[3](1,api.PartyOption.RELEASE);assert.equal(modes.at(-1)[0],api.Mode.CONFIRM);
 return modes.at(-1);
}

test('capture choice reuses original Party/Summary, cancels/reselects and submits stable zero release ID once',async()=>{
 const state=captureChoicePhase(),{p,modes,sent}=state,before=ruleState(p),party=p.scene.party,battle=p.scene.currentBattle;
 await p.openDecisionInput();const ask=modes.at(-1);await ask[1]();
 assert.deepEqual(modes.at(-1)[7],{allowedOptions:[api.PartyOption.RELEASE,api.PartyOption.SUMMARY],readOnlySummary:true,submitReleaseOnly:true});
 const obsolete=modes.at(-1)[3],count=modes.length;await p.openDecisionInput();assert.equal(modes.length,count);
 await modes.at(-1)[3](6,api.PartyOption.CANCEL);assert.equal(modes.at(-1)[0],api.Mode.CONFIRM);assert.equal(sent.length,0);
 await modes.at(-1)[1]();await modes.at(-1)[3](1,api.PartyOption.RELEASE);
 await modes.at(-1)[2]();assert.equal(modes.at(-1)[0],api.Mode.PARTY,'No keeps the original selection available');
 await modes.at(-1)[3](1,api.PartyOption.RELEASE);const confirm=modes.at(-1);
 await confirm[1]();await confirm[1]();await obsolete(2,api.PartyOption.RELEASE);
 assert.equal(sent.length,1);assert.deepEqual(sent[0].action,{kind:'capture-choice',releaseId:0});
 assert.deepEqual(ruleState(p),before);assert.equal(p.scene.party,party);assert.equal(p.scene.currentBattle,battle);
});

test('declining a full capture and explicitly keeping/declining an old under-full capture send only server options',async()=>{
 for(const [legacy,keep] of [[false,false],[true,true],[true,false]]){
  const {p,modes,sent}=captureChoicePhase(legacy,legacy),before=ruleState(p);
  await p.openDecisionInput();await modes.at(-1)[keep?1:2]();
  assert.equal(sent.length,1);assert.equal(sent[0].action.kind,legacy?'preparation':'capture-choice');
  if(legacy){assert.equal(sent[0].action.choice,keep?'keep':'discard');assert.equal(sent[0].action.pokemonId,8)}
  assert.equal(sent[0].action.releaseId,null);assert.deepEqual(ruleState(p),before);
 }
});

test('capture confirmation cannot cross awaited revision, epoch or a newer menu on the same snapshot',async()=>{
 for(const stale of ['revision','epoch','menu']){
  const state=captureChoicePhase(),{p,sent}=state,confirm=await captureConfirmation(state);
  let finish;const setMode=p.scene.ui.setMode;p.scene.ui.setMode=()=>new Promise(resolve=>{finish=resolve});
  const choosing=confirm[1]();if(stale==='revision')p.latest={...p.latest,revision:5};else if(stale==='epoch')p.epoch='epoch-2';else p.clearTeamParty();
  p.scene.ui.setMode=setMode;finish();await choosing;assert.equal(sent.length,0);
 }
});

test('capture outbox failure and rejected receipt permit reselection and keep used confirmations inert',async()=>{
 for(const failure of ['outbox','rejected']){
  const state=captureChoicePhase(),{p,modes,sent}=state;
  if(failure==='outbox')p.storage={...p.storage,saveAction:async()=>{throw Error('TEST_DISK_FAILURE')}};
  const confirm=await captureConfirmation(state);await confirm[1]();
  if(failure==='rejected')await p.onMessage({type:'actionReceipt',roomId:p.roomId,actionId:p.actionId,revision:4,decisionId:p.latest.decisionId,accepted:false,code:'INVALID_CAPTURE_CHOICE'});
  const count=sent.length;await confirm[1]();assert.equal(sent.length,count);assert.equal(p.actionId,null);assert.equal(modes.at(-1)[0],api.Mode.CONFIRM);
  await modes.at(-1)[1]();assert.equal(modes.at(-1)[0],api.Mode.PARTY);
 }
});

test('cooperative original RELEASE submits its selection without running local release; solo still releases',()=>{
 const selected=[],released=[],party=[{id:12},{id:0}];
 const handler=Object.assign(Object.create(api.PartyUiHandler.prototype),{
  optionsMode:true,options:[api.PartyOption.RELEASE],optionsCursor:0,optionsScroll:false,cursor:1,
  partyUiMode:api.PartyUiMode.RELEASE,submitReleaseOnly:true,selectFilter:()=>null,
  scene:{getParty:()=>party},getUi:()=>({playSelect(){},playError(){}}),clearOptions(){this.optionsMode=false},
  doRelease:index=>released.push(index),selectCallback:(...args)=>selected.push(args),
 });
 handler.processInput(api.Button.ACTION);assert.deepEqual(selected,[[1,api.PartyOption.RELEASE]]);
 assert.deepEqual(released,[]);assert.equal(party.length,2);
 handler.submitReleaseOnly=false;handler.optionsMode=true;handler.selectCallback=(...args)=>selected.push(args);
 handler.processInput(api.Button.ACTION);assert.deepEqual(released,[1]);assert.equal(selected.length,1);
});

test('disconnect during capture Party asset loading restores the field before disposal and cannot open a stale menu',async()=>{
 const {p,modes,sent}=captureChoicePhase(),party=p.scene.party,battle=p.scene.currentBattle;
 let loaded,initialized=0,destroyed=0;const make=p.makeTeamPokemon;
 p.makeTeamPokemon=e=>Object.assign(make(e),{init(){initialized++},loadAssets:()=>new Promise(resolve=>{const old=loaded;loaded=()=>{old?.();resolve()}}),destroy(){destroyed++}});
 await p.openDecisionInput();const opening=modes.at(-1)[1]();await tick();assert.equal(initialized,6);
 await p.onMessage({type:'syncStatus',roomId:p.roomId,runId:p.runId,revision:4,blocked:true,submitted:[false,false],reason:'DISCONNECTED'});
 assert.equal(p.scene.party,party);assert.equal(p.scene.currentBattle,battle);assert.equal(destroyed,0);
 loaded();await opening;assert.equal(destroyed,6);assert.equal(sent.length,0);assert.notEqual(modes.at(-1)[0],api.Mode.PARTY);
});

test('pre-battle confirmation and required original Party submit only the server choice', async () => {
  for (const kind of ['switch-confirm', 'switch-select', 'wait-switch']) {
    const state = activeSwitchPhase(), { p, modes, sent, target } = state;
    p.switchSignature = ''; p.latest.personal.decision.kind = kind;
    const currentId = p.model.applied.personal.party[0].id;
    p.latest.personal.decision.options = kind === 'switch-confirm'
      ? [true, false].map(accept => ({ kind, pokemonId: currentId, accept }))
      : [{ kind: kind === 'wait-switch' ? 'forced-switch' : kind, pokemonId: target },
        ...(kind === 'switch-select' ? [{ kind, pokemonId: null }] : [])];
    await p.openSwitchPrompt();
    if (kind === 'switch-confirm') { await modes.at(-1)[1](); assert.equal(sent[0].action.accept, true); }
    else {
      assert.equal(modes.at(-1)[1], kind === 'wait-switch' ? api.PartyUiMode.FAINT_SWITCH : api.PartyUiMode.POST_BATTLE_SWITCH);
      await modes.at(-1)[3](1, api.PartyOption.SEND_OUT);
      assert.equal(sent[0].action.pokemonId, target);
      assert.equal(sent[0].action.kind, kind === 'wait-switch' ? 'forced-switch' : 'switch-select');
    }
  }
});

test('cooperative original Summary reads moves without reordering; solo move selection remains enabled', () => {
  const moves = [{ id: 1 }, { id: 2 }], ui = { playSelect() {}, playError() {} };
  const handler = Object.assign(Object.create(api.SummaryUiHandler.prototype), { transitioning: false,
    readOnly: true, moveSelect: true, moveCursor: 1, selectedMoveIndex: 0,
    summaryUiMode: api.SummaryUiMode.DEFAULT, pokemon: { moveset: moves }, getUi: () => ui });
  handler.processInput(api.Button.ACTION);
  assert.deepEqual(moves, [{ id: 1 }, { id: 2 }]); assert.equal(handler.selectedMoveIndex, 0);
  handler.readOnly = false; handler.selectedMoveIndex = -1;
  handler.setCursor = () => {};
  handler.processInput(api.Button.ACTION); assert.equal(handler.selectedMoveIndex, 1);
});

test('competing capture Party opens cannot replace the original field with an obsolete temporary party',async()=>{
 const state=captureChoicePhase(),{p,modes}=state,party=p.scene.party,battle=p.scene.currentBattle;
 await p.openDecisionInput();const ask=modes.at(-1),setMode=p.scene.ui.setMode,finishes=[];
 p.scene.ui.setMode=(...args)=>args[0]===api.Mode.MESSAGE?new Promise(resolve=>finishes.push(resolve)):setMode(...args);
 const first=ask[1]();p.switchSignature='';await p.openDecisionInput();const second=modes.at(-1)[1]();
 finishes[0]();await first;assert.equal(p.scene.party,party);
 finishes[1]();await second;assert.equal(p.scene.party.length,6);
 p.clearTeamParty();assert.equal(p.scene.party,party);assert.equal(p.scene.currentBattle,battle);
});

test('original faint Party refuses Esc and its cancel slot, while voluntary selection can cancel', () => {
  const choices = [], sounds = [];
  const handler = Object.assign(Object.create(api.PartyUiHandler.prototype), {
    optionsMode: false, cursor: 6, partyUiMode: api.PartyUiMode.FAINT_SWITCH,
    selectCallback: (...args) => choices.push(args),
    getUi: () => ({ playError: () => sounds.push('error'), playSelect: () => sounds.push('select') }),
  });
  handler.processInput(api.Button.CANCEL); handler.processInput(api.Button.ACTION);
  assert.equal(choices.length, 0); assert.deepEqual(sounds, ['error']);
  handler.partyUiMode = api.PartyUiMode.POST_BATTLE_SWITCH;
  handler.processInput(api.Button.CANCEL);
  assert.deepEqual(choices, [[6, api.PartyOption.CANCEL]]);
});

test('original Summary retains read-only across adjacent creatures and can return to the Party', () => {
  const party = [{ id: 0 }, { id: 8 }], shown = [], modes = [];
  const handler = Object.assign(Object.create(api.SummaryUiHandler.prototype), {
    transitioning: false, readOnly: true, moveSelect: false, cursor: 1,
    summaryUiMode: api.SummaryUiMode.DEFAULT, pokemon: party[0], scene: { getParty: () => party },
    getUi: () => ({ setMode: mode => modes.push(mode), playSelect() {}, playError() {} }),
    clear() { this.readOnly = false; this.pokemon = null; }, show: args => shown.push(args),
  });
  handler.processInput(api.Button.DOWN);
  assert.equal(shown[0][0], party[1]); assert.deepEqual(shown[0][4], { readOnly: true });
  handler.processInput(api.Button.CANCEL);
  assert.deepEqual(modes, [api.Mode.PARTY]);
});

test('capture RELEASE permits the original current-front choice without locally deleting or promoting a replacement',async()=>{
 const state=captureChoicePhase(),{p,modes,sent}=state,before=ruleState(p),front=p.model.applied.personal.party[0].id;
 await p.openDecisionInput();await modes.at(-1)[1]();await modes.at(-1)[3](0,api.PartyOption.RELEASE);
 assert.equal(modes.at(-1)[0],api.Mode.CONFIRM);await modes.at(-1)[1]();
 assert.equal(sent.length,1);assert.deepEqual(sent[0].action,{kind:'capture-choice',releaseId:front});assert.deepEqual(ruleState(p),before);
});
