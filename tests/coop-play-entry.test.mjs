import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, isBuiltin } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'vite';
import { IDBFactory } from 'fake-indexeddb';
import { createPlayStorage } from '../src/coop/play-storage.mjs';
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
  p.sendProfile = async (ready, profile) => { submitted = { ready, profile }; };
  await p.openStarterSelect();
  const handler = Object.assign(Object.create(api.StarterSelectUiHandler.prototype), {
    scene: p.scene, starterSelectCallback: originalCallback, starterSelectOptions: options,
    starterGens: [0], starterCursors: [0], genSpecies: [[species]], starterAttr: [149n],
    starterNatures: [0], starterMovesets: [undefined], pokerusGens: [], pokerusCursors: [],
  });
  assert.equal(handler.tryStart(true), true); // Real original confirmation/callback implementation.
  assert.equal(submitted.ready, true);
  assert.equal(submitted.profile.version, 2);
  assert.deepEqual(submitted.profile.starters[0].ivs, ivs);
  assert.equal(submitted.profile.starters[0].speciesId, 1);
  assert.equal(p.starterOpen, false);
  handler.starterGens = []; handler.starterCursors = []; handler.statsMode = false;
  handler.processInput(api.Button.CANCEL); // Original cancellation uses the injected cooperative callback.
  await p.openStarterSelect();
  gd.starterEggMoveData = {};
  originalCallback([{ species, dexAttr: 149n, nature: 0, pokerus: false }]);
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
  await first.p.sendProfile(true, { synthetic: 'retained-selection' });
  await first.p.sendProfile(true, { synthetic: 'duplicate-click' });
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
  assert.deepEqual(second.p.lastProfile, { synthetic: 'retained-selection' });
});

test('local write failure prevents send and retains the selection for retry', async () => {
  const { p, sent, errors } = phase();
  await p.onMessage(welcome); await p.onMessage(await snapshot());
  p.inputReady = true; p.lastProfile = { synthetic: 'selection' };
  p.storage = { ...p.storage, saveAction: async () => { throw new Error('TEST_STORAGE_FULL'); } };
  await p.sendProfile(true);
  assert.equal(sent.filter(message => message.type === 'submitAction').length, 0);
  assert.equal(p.actionId, null);
  assert.deepEqual(p.lastProfile, { synthetic: 'selection' });
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

test('original preparation UI receives drawn types without changing gameMode or enabling local shop/reroll', async () => {
  const { p, modes, controls, sent } = preparationPhase(); const mode = p.scene.gameMode;
  await p.openPreparationMenu(); await p.openPreparationMenu();
  assert.equal(modes.length, 1); assert.equal(modes[0][0], api.Mode.MODIFIER_SELECT);
  assert.equal(modes[0][2][0].type.id, 'POTION');
  assert.deepEqual(modes[0][5], { shopOptions: [], allowReroll: false, allowTransfer: false });
  assert.equal(p.scene.gameMode, mode); assert.equal(p.scene.money, 300);
  assert.equal(modes[0][3](1, 0), false); assert.equal(sent.length, 0);
  assert.equal(controls.length, 1);
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

test('preparation write failure preserves actionable controls and original menu without a false skip', async () => {
  const { p, sent, controls } = preparationPhase(); await p.openPreparationMenu();
  p.storage = { ...p.storage, saveAction: async () => { throw new Error('TEST_WRITE_FAILURE'); } };
  assert.equal(await p.sendPreparation('skip-reward'), false);
  assert.equal(sent.length, 0); assert.equal(p.actionId, null);
  assert.equal(p.latest.personal.decision.players.rewardResolved, false);
  assert.equal(controls.length, 2);
});

test('old personal buttons cannot rebase a skip/ready operation onto a newer decision', async () => {
  const { p, sent } = preparationPhase(); const snapshot = p.latest, epoch = p.epoch;
  p.latest = { ...snapshot, revision: 5, decisionId: 'prep-5' };
  assert.equal(await p.sendPreparation('skip-reward', snapshot, epoch), false);
  assert.equal(sent.length, 0);
  assert.equal(await p.sendPreparation('ready'), false);
  assert.equal(sent.length, 0);
});

test('resolved preparation never redraws reward menu; ready seat retains unready controls', async () => {
  const { p, modes, controls } = preparationPhase();
  Object.assign(p.latest.personal.decision.players, { rewardResolved: true, ready: true });
  await p.openPreparationMenu();
  assert.deepEqual(modes, [[api.Mode.MESSAGE]]); assert.equal(controls[0].ready, true);
});

test('original ModifierSelect cancel remains usable when a coop callback declines to close', () => {
  let calls = 0;
  const handler = Object.create(api.ModifierSelectUiHandler.prototype);
  handler.scene = { ui: { playSelect() {} } };
  handler.player = true; handler.awaitingActionInput = true;
  handler.onActionInput = row => { assert.equal(row, -1); calls++; return false; };
  assert.equal(handler.processInput(api.Button.CANCEL), true);
  assert.equal(handler.awaitingActionInput, true);
  assert.equal(handler.processInput(api.Button.CANCEL), true);
  assert.equal(calls, 2);
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
  assert.equal(controls.length, 2);
  assert.equal(modes.filter(m => m[0] === api.Mode.MODIFIER_SELECT).length, 2);
  assert.equal(p.latest.personal.decision.players.rewardResolved, false);
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

test('REVIVE remains explicitly unsupported rather than inheriting Potion UI support', async () => {
  const { p, sent, modes, errors } = preparationPhase();
  await p.choosePreparationReward(rewardOption('REVIVE'), p.latest, p.epoch);
  assert.equal(modes.length, 0); assert.equal(sent.length, 0);
  assert.ok(errors.some(error => error.includes('尚不支持')));
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
    modes.at(-1)[3](outcome === 'cancel' ? 6 : 1,
      outcome === 'cancel' ? api.PartyOption.CANCEL : api.PartyOption.SEND_OUT);
    await tick(); await tick();
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
