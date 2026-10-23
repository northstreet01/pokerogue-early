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
import { defaultTrainerRoute, progressDefault } from './helpers/native-default-trainer.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';
import { presentationFixture } from './helpers/coop-presentation-fixture.mjs';

let api, profiles, firstPreparation;
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
  const route = await defaultTrainerRoute(); profiles = route.profiles;
  try {
    let c = route.initial;
    for (let n = 0; n < 70 && c.decision.kind !== 'preparation'; n++) c = (await progressDefault(route.h, c)).checkpoint;
    assert.equal(c.decision.kind, 'preparation'); firstPreparation = c;
  } finally { await route.h.close(); }
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
async function openUiRoom(seat, t, lobbyOnly = false, prepared = null, homeEntry = false, render = false) {
  const directory = await mkdtemp(join(tmpdir(), 'vs02b15-ui-'));
  const original = createOriginalCoopAdapter({ fixture: { profileLobby: true,
    seed: 'learning-natural-2', identities: profiles.map(profile => profile.trainer) } });
  // Optional synthetic original-factory preparation, explicitly distinct from
  // the normal selected-profile lobby used by the preceding VS15–17 cases.
  const adapter = prepared ? { ...original, createInitialContext: ({ runId }) => original.restoreCheckpoint({
    formatVersion: 2, runId, stage: 'preparation', provisioning: { seed: 'learning-natural-2', identities: profiles.map(profile => profile.trainer) },
    lobby: null, nativeCheckpoint: structuredClone(prepared), intents: [],
  }) } : original;
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
  const peerModel = api.createOriginalClientModel(api);
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
  phase.model = api.createOriginalClientModel(api);
  phase.lastProfile = profiles[seat]; phase.profileDirty = true;
  for (const key of ['status', 'budget', 'roomLine', 'reserveLine', 'controls', 'modifierLine']) phase[key] = document.createElement('div');
  const originalStatus = phase.setStatus.bind(phase);
  phase.setStatus = (text, error) => { originalStatus(text, error); if (error) errors.push(Error(text)); };
  phase.enterBattle = async () => {}; // Display only; verified real model apply/capture remains intact.
  if (prepared) {
    phase.presentation = { apply: async () => {}, playEvents: async () => {} };
    phase.enterBattle = api.CoopPlayPhase.prototype.enterBattle.bind(phase);
  }
  let visual;
  if (render) {
    visual = presentationFixture(api, scene);
    // Actual reconciliation and replay; only Phaser allocation/assets are ports.
    scene.ui = ui;
    phase.presentation = visual.p;
    phase.enterBattle = api.CoopPlayPhase.prototype.enterBattle.bind(phase);
    phase.scene.gameMode = api.createOriginalRuntime('render-mode', profiles[seat].trainer).scene.gameMode;
  }
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
  if (homeEntry) {
    const runtime = api.createOriginalRuntime('home-entry', profiles[seat].trainer);
    scene.executeWithSeedOffset = (fn, offset, seed) => api.withStarterRandomContext(runtime.context,
      () => runtime.scene.executeWithSeedOffset(fn, offset, seed));
    const own = new api.GameData(scene, { readOnly: true });
    const bytes = JSON.stringify({ ...profiles[seat].trainer, gender: 1, dexData: own.dexData,
      voucherCounts: {0: 4, 1: 0, 2: 0, 3: 0}, eggs: [], timestamp: 1700000000000 },
    (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    await api.writeLocalSave('data', bytes); scene.gameData = own;
    const assigned = []; location.assign = url => assigned.push(url);
    const home = new api.HomePhase(scene);
    // Original Home callbacks and original GameData read, with display ports only.
    ui.clearText = () => {};
    await home.showHome(); modes.at(-1)[1].options[3].handler(); await home.transitions;
    modes.at(-1)[1].options[2].handler();
    await until(() => ui.mode === api.Mode.EGG_GACHA, 'home personal vouchers');
    assert.equal(scene.gameData.voucherCounts[0], 4);
    modes.at(-1)[1].onCancel(); await home.transitions;
    assert.equal(await api.readLocalSave('data'), bytes); assert.equal(scene.gameData, own);
    modes.at(-1)[1].options[1].handler();
    assert.deepEqual(assigned, ['/coop-play.html?fresh=1']); location.search = '?fresh=1';
  }
  phase.connect(); await until(() => phase.versions, 'primary hello');
  if (seat === 0) {
    await phase.createRoom(); await until(() => phase.roomId, 'primary room');
    peer.send({ type: 'joinRoom', roomId: phase.roomId, name: 'synthetic-peer' });
  } else {
    peer.send({ type: 'createRoom', name: 'synthetic-peer' });
    await until(() => peerLatest, 'peer room'); await phase.joinRoom(peerLatest.roomId);
  }
  await until(() => phase.inputReady && peerLatest && phase.latest?.personal.decision.kind === (prepared ? 'preparation' : 'lobby'), 'initial model ACK');
  const submitPeer = action => peer.send({ type: 'submitAction', roomId: peerLatest.roomId, runId: peerLatest.runId,
    decisionId: peerLatest.decisionId, expectedRevision: peerLatest.revision, actionId: crypto.randomUUID(), action });
  const environment = { phase, command, ball, ui, peer, errors, modes, server, directory, adapter,
    peerSnapshot: () => peerLatest, submitPeer, close, visual };
  if (lobbyOnly || prepared) return environment;
  await phase.sendProfile(true, profiles[seat]);
  await until(() => !phase.actionId && phase.latest.shared.ready[seat] && phase.inputReady
    && peerLatest.revision === phase.latest.revision, 'primary profile');
  submitPeer({ kind: 'profile-ready', profile: profiles[1 - seat], ready: true });
  await until(() => phase.inputReady && phase.latest?.personal.decision.kind === 'wait-actions'
    && peerLatest.personal.decision.kind === 'wait-actions', 'selected Worker battle');
  return environment;
}

for (const seat of [0, 1]) test(`VS19 Home personal return -> fresh cooperative UI seat ${seat} -> real profile/IDB/WS/Worker/FIGHT`, { timeout: 90000 }, async t => {
  const env = await openUiRoom(seat, t, false, null, true);
  try {
    const {phase,modes}=env;
    assert.equal(phase.latest.personal.decision.kind,'wait-actions');
    const option=phase.latest.personal.decision.options.find(o=>o.kind==='fight' && (o.target===null || o.target>=2));
    assert.ok(option);phase.battleInputActive=true;env.command.cursor=0;env.command.cursor2=0;
    env.command.processInput(api.Button.ACTION);assert.equal(modes.at(-1)[0],api.Mode.FIGHT);
    assert.deepEqual(env.errors,[]);
    assert.equal((await api.readLocalSaveSnapshot(['data'])).data.includes('"voucherCounts":{"0":4'),true);
    assert.deepEqual(await phase.storage.pendingActions(location.origin,phase.roomId,seat),[]);
  } finally { await env.close(); }
});

for (const seat of [0, 1]) test(`VS16 original Starter callbacks seat ${seat}: draft IDB/WS/model ACK, readiness, selected Worker and FIGHT`, { timeout: 90000 }, async t => {
  const env = await openUiRoom(seat, t, true);
  try {
    const { phase, modes } = env;
    // A real owned profile, original codecs and minimal headless rendering ports.
    const own = profiles[seat];
    const records = Object.fromEntries(own.starters.map((starter, index) => [starter.speciesId, {
      ...own.costs[index], ...own.unlocks[index], caughtAttr: BigInt(own.unlocks[index].caughtAttr),
    }]));
    phase.scene.gameData = { ...own.trainer, eggs: [], dexData: records,
      starterEggMoveData: Object.fromEntries(own.starters.map(starter =>
        [api.getPokemonSpecies(starter.speciesId).getRootSpeciesId(), starter.eggMoves])) };
    const starters = own.starters.map(api.restoreStarterSelection).map(({ species, dexAttr, nature, moveset, pokerus }) =>
      ({ species, dexAttr, nature, moveset, pokerus }));
    await phase.openStarterSelect();
    const [, confirm, config] = modes.at(-1);
    const priorModes = modes.length;
    config.onChange(starters.slice(0, 1));
    await until(() => phase.inputReady && !phase.actionId && phase.latest.personal.profile?.starters.length === 1, 'accepted one-starter draft');
    assert.equal(modes.length, priorModes, 'draft sync does not close original Starter');
    await until(() => env.peerSnapshot().revision === phase.latest.revision, 'peer draft ACK');
    assert.equal(env.peerSnapshot().shared.selections[seat].state, 'draft');
    assert.equal(env.peerSnapshot().shared.selections[seat].starters.length, 1);
    assert.equal(env.peerSnapshot().personal.profile, null);
    assert.deepEqual(phase.latest.shared.ready, [false, false]);
    config.onChange(starters);
    await until(() => phase.inputReady && !phase.actionId && phase.latest.personal.profile?.starters.length === 2, 'accepted two-starter draft');
    confirm(starters);
    await until(() => phase.inputReady && !phase.actionId && phase.latest.shared.ready[seat], 'confirmed exact draft');
    await until(() => env.peerSnapshot().revision === phase.latest.revision, 'peer final lobby');
    env.submitPeer({ kind: 'profile-ready', profile: profiles[1 - seat], ready: true });
    await until(() => phase.inputReady && phase.latest.personal.decision.kind === 'wait-actions'
      && env.peerSnapshot().personal.decision.kind === 'wait-actions', 'original selected battle');
    assert.deepEqual(phase.latest.personal.party.map(entry => entry.pokemon.fields.species), own.starters.map(starter => starter.speciesId));
    const revision = phase.latest.revision;
    await phase.sendAction(attack(phase.latest), 'original FIGHT');
    await until(() => phase.submitted, 'owned FIGHT receipt');
    env.submitPeer(attack(env.peerSnapshot()));
    await until(() => phase.latest.revision > revision && phase.inputReady, 'next FIGHT input');
    assert.deepEqual(env.errors, []);
    assert.deepEqual(await phase.storage.pendingActions(location.origin, phase.roomId, seat), []);
  } finally { await env.close(); }
});

const attack = snapshot => {
  const options = snapshot.personal.decision.options.filter(option => option.kind === 'fight' && (option.target === null || option.target >= 2));
  const moves = snapshot.personal.party[0].pokemon.fields.moveset;
  return options.find(option => [52, 55, 22, 670].includes(moves[option.cursor]?.fields.moveId))
    ?? options.find(option => [33, 10].includes(moves[option.cursor]?.fields.moveId)) ?? options[0];
};

for (const seat of [0, 1]) test(`VS20 seat ${seat}: real IDB/dual WS/Worker preparation keeps original displays and peer menu callbacks`, { timeout: 120000 }, async t => {
  // firstPreparation was reached through the unmodified natural Worker route.
  const env = await openUiRoom(seat, t, false, firstPreparation, false, true);
  try {
    const {phase,visual,modes}=env;
    await until(()=>phase.inputReady && modes.at(-1)?.[0]===api.Mode.MODIFIER_SELECT,'original shop');
    const objects=[...phase.presentation.field], allocations={...visual.counts};
    const menu=modes.at(-1), baseline=phase.latest, revision=phase.latest.revision;
    await until(()=>env.peerSnapshot().revision===revision,'peer shop ACK');
    env.submitPeer({kind:'preparation',operation:'skip-reward'});
    await until(()=>phase.latest.revision>revision && phase.inputReady,'peer reward snapshot');
    assert.deepEqual(visual.counts,allocations);
    assert.deepEqual(phase.presentation.field,objects);
    const changed=(a,b,path='')=>JSON.stringify(a)===JSON.stringify(b)?[]:
      a&&b&&typeof a==='object'&&typeof b==='object'?[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>changed(a[k],b[k],`${path}.${k}`)):[path];
    assert.equal(modes.at(-1),menu,`peer update preserves the open original shop; changed ${changed({decisionId:baseline.decisionId,personal:baseline.personal,shared:baseline.shared},{decisionId:phase.latest.decisionId,personal:phase.latest.personal,shared:phase.latest.shared}).join(',')}`);
    // A callback captured before that peer update must still submit legally.
    const previous=phase.latest;
    menu[3](-1,0);
    await until(()=>phase.latest.revision>previous.revision && phase.inputReady,'retained original skip callback');
    assert.equal(phase.latest.personal.decision.players.rewardResolved,true);
    assert.deepEqual(phase.presentation.field,objects);
    assert.deepEqual(visual.counts,allocations);
    const beforeBuy=phase.latest;
    const purchases=beforeBuy.personal.decision.players.shop.flatMap(option=>{
      const type=api.modifierTypes[option.type.catalogId]?.();
      if(option.cost>beforeBuy.personal.resources.money || !type?.selectFilter)return [];
      return phase.model.applied.personal.party.flatMap(entry=>{
        if(type.selectFilter(entry.pokemon)!==null)return [];
        const moveIndex=type.moveSelectFilter?entry.pokemon.getMoveset().findIndex(move=>type.moveSelectFilter(move)===null):null;
        return moveIndex===-1?[]:[{option,pokemonId:entry.id,moveIndex}];
      });
    });
    assert.ok(purchases.length,'naturally generated affordable effective consumable');
    const purchase=purchases[0];
    await phase.sendAction({kind:'preparation',operation:'buy',optionId:purchase.option.id,pokemonId:purchase.pokemonId,
      moveIndex:purchase.moveIndex,fusionId:null},'VS20 purchase verification');
    await until(()=>phase.latest.revision>beforeBuy.revision && phase.inputReady,'incremental purchase');
    assert.equal(phase.latest.personal.resources.money,beforeBuy.personal.resources.money-purchase.option.cost);
    assert.deepEqual(phase.presentation.field,objects);
    assert.deepEqual(visual.counts,allocations);
    assert.equal(modes.at(-1)[0],api.Mode.MODIFIER_SELECT);
    assert.deepEqual(await phase.storage.pendingActions(location.origin,phase.roomId,seat),[]);
    assert.deepEqual(env.errors,[]);
  } finally {await env.close();}
});

for (const seat of [0, 1]) test(`VS17 natural preparation seat ${seat}: original menu/Party, IDB/WS money, completion and next FIGHT`, { timeout: 90000 }, async t => {
  const env = await openUiRoom(seat, t);
  try {
    const { phase, modes, ui } = env;
    // Only rendering/asset ports are replaced; production callbacks, store,
    // original rule Worker and both verified model ACKs remain real.
    phase.scene.currentBattle = { double: true };
    let moneyUpdates = 0;
    phase.scene.updateMoneyText = () => moneyUpdates++;
    phase.makeTeamPokemon = entry => {
      const copy = api.restorePokemonState(api.capturePokemonState(entry.pokemon));
      copy.scene = phase.scene; copy.init = () => {}; copy.loadAssets = async () => {}; copy.destroy = () => {};
      return copy;
    };
    for (let n = 0; n < 12 && phase.latest.personal.decision.kind === 'wait-actions'; n++) {
      const revision = phase.latest.revision;
      await phase.sendAction(attack(phase.latest), 'natural preparation setup');
      await until(() => phase.submitted || env.errors.length, 'natural setup receipt');
      env.submitPeer(attack(env.peerSnapshot()));
      await until(() => phase.latest.revision > revision && phase.inputReady || env.errors.length, 'natural setup next input');
      assert.deepEqual(env.errors, []);
    }
    assert.equal(phase.latest.personal.decision.kind, 'preparation');
    await until(() => env.peerSnapshot().revision === phase.latest.revision, 'peer preparation');
    const originalMenu = () => {
      const mode = modes.at(-1); assert.equal(mode[0], api.Mode.MODIFIER_SELECT);
      return Object.assign(Object.create(api.ModifierSelectUiHandler.prototype), {
        getUi: () => ui, awaitingActionInput: true, inputPresentation: mode[5],
        rowCursor: 0, cursor: 0, player: true, onActionInput: mode[3],
      });
    };
    let menu = originalMenu(), before = phase.latest;
    const startingMoney = api.createOriginalRuntime('check', profiles[seat].trainer).scene.gameMode.getStartingMoney();
    assert.equal(before.personal.resources.money, startingMoney);
    assert.equal(phase.scene.money, startingMoney); assert.ok(moneyUpdates > 0);
    const rerollCost = before.personal.decision.players.rerollCost;
    menu.processInput(api.Button.ACTION);
    await until(() => phase.latest.revision > before.revision && phase.inputReady, 'original reroll result');
    assert.equal(phase.latest.personal.resources.money, startingMoney - rerollCost);
    await until(() => env.peerSnapshot().revision === phase.latest.revision, 'peer reroll');
    assert.equal(env.peerSnapshot().personal.resources.money, startingMoney);
    before = phase.latest;
    const shop = before.personal.decision.players.shop;
    let chosen;
    for (const [index, option] of shop.entries()) {
      if (option.cost > before.personal.resources.money) continue;
      const type = api.modifierTypes[option.type.catalogId]?.(); if (!type?.selectFilter) continue;
      for (const [slot, entry] of phase.model.applied.personal.party.entries()) {
        if (type.selectFilter(entry.pokemon) !== null) continue;
        const move = type.moveSelectFilter ? entry.pokemon.getMoveset().findIndex(m => type.moveSelectFilter(m) === null) : null;
        if (move === -1) continue;
        chosen = { index, option, slot, move }; break;
      }
      if (chosen) break;
    }
    assert.ok(chosen, 'natural affordable effective original consumable');
    menu = originalMenu();
    menu.rowCursor = shop.length > 6 && chosen.index < 6 ? 3 : 2;
    menu.cursor = shop.length > 6 && chosen.index >= 6 ? chosen.index - 6 : chosen.index;
    menu.processInput(api.Button.ACTION);
    await until(() => ui.mode === api.Mode.PARTY || env.errors.length, 'original consumable Party');
    assert.deepEqual(env.errors, []);
    await modes.at(-1)[3](chosen.slot, chosen.move === null ? api.PartyOption.APPLY : api.PartyOption.MOVE_1 + chosen.move);
    await until(() => phase.latest.revision > before.revision && phase.inputReady, 'original buy result');
    assert.equal(phase.scene.money, before.personal.resources.money - chosen.option.cost);
    assert.equal(phase.latest.personal.decision.players.rewardResolved, false);
    before = phase.latest; menu = originalMenu(); menu.processInput(api.Button.CANCEL);
    await until(() => phase.latest.revision > before.revision && phase.inputReady, 'original skip');
    before = phase.latest; originalMenu().processInput(api.Button.SUBMIT);
    await until(() => phase.latest.revision > before.revision && phase.inputReady, 'original completion');
    assert.equal(phase.latest.personal.decision.players.ready, true);
    await until(() => env.peerSnapshot().revision === phase.latest.revision, 'peer completion ACK');
    env.submitPeer({ kind: 'preparation', operation: 'skip-reward' });
    await until(() => phase.inputReady && !phase.actionId && env.peerSnapshot().personal.decision.players.rewardResolved, 'peer skip');
    await until(() => env.peerSnapshot().revision === phase.latest.revision, 'peer skip ACK');
    env.submitPeer({ kind: 'preparation', operation: 'ready' });
    await until(() => phase.inputReady && phase.latest.personal.decision.kind !== 'preparation'
      && env.peerSnapshot().revision === phase.latest.revision, 'natural next encounter');
    for (let n = 0; n < 20 && phase.latest.personal.decision.kind !== 'wait-actions'; n++) {
      const current = phase.latest, decision = current.personal.decision;
      if (decision.requiredSeats.includes(seat)) {
        assert.equal(decision.kind, 'switch-confirm'); assert.equal(modes.at(-1)[0], api.Mode.CONFIRM);
        await modes.at(-1)[2]();
      } else {
        const option = env.peerSnapshot().personal.decision.options.find(option => option.accept === false || option.pokemonId === null);
        assert.ok(option); env.submitPeer(option);
      }
      await until(() => phase.inputReady && phase.latest.revision > current.revision
        && env.peerSnapshot().revision === phase.latest.revision, 'original next encounter keep');
    }
    assert.equal(phase.latest.personal.decision.kind, 'wait-actions');
    const revision = phase.latest.revision;
    await phase.sendAction(attack(phase.latest), 'next FIGHT');
    await until(() => phase.submitted, 'next owned FIGHT'); env.submitPeer(attack(env.peerSnapshot()));
    await until(() => phase.inputReady && phase.latest.revision > revision, 'next FIGHT result');
    assert.deepEqual(env.errors, []);
    assert.deepEqual(await phase.storage.pendingActions(location.origin, phase.roomId, seat), []);
  } finally { await env.close(); }
});

for (const seat of [0,1]) test(`VS18 original persistent Party seat ${seat}: synthetic factory, real IDB/WS/model ACK, private display and later FIGHT`,{timeout:90000},async t=>{
  const checkpoint=structuredClone(firstPreparation);
  checkpoint.decision.players[seat].rewards[0].type=api.captureModifierTypeState(api.modifierTypes.LUCKY_EGG().withIdFromFunc(api.modifierTypes.LUCKY_EGG));
  const env=await openUiRoom(seat,t,false,checkpoint);
  try{
    const {phase,modes,ui}=env;phase.scene.currentBattle={double:true};
    phase.makeTeamPokemon=entry=>{
      const p=api.restorePokemonState(api.capturePokemonState(entry.pokemon));p.scene=phase.scene;
      p.init=()=>{};p.loadAssets=async()=>{};p.destroy=()=>{};return p;
    };
    const mode=modes.at(-1);assert.equal(mode[0],api.Mode.MODIFIER_SELECT);
    const handler=Object.assign(Object.create(api.ModifierSelectUiHandler.prototype),{getUi:()=>ui,awaitingActionInput:true,inputPresentation:mode[5],rowCursor:1,cursor:0,player:true,onActionInput:mode[3]});
    const before=phase.latest;handler.processInput(api.Button.ACTION);
    await until(()=>ui.mode===api.Mode.PARTY||env.errors.length,'original persistent Party');assert.deepEqual(env.errors,[]);
    assert.equal(modes.at(-1)[4](phase.scene.party[0]),null);
    const choose=modes.at(-1)[3];await choose(0,api.PartyOption.APPLY);await choose(0,api.PartyOption.APPLY);
    await until(()=>phase.latest.revision>before.revision&&phase.inputReady,'persisted original held item');
    assert.equal(phase.model.applied.personal.resources.modifiers[0].stackCount,1);
    assert.match(phase.modifierLine.textContent,/Lucky Egg ×1/);
    await until(()=>env.peerSnapshot().revision===phase.latest.revision,'peer ACK');
    assert.deepEqual(env.peerSnapshot().personal.resources.modifiers,[]);
    assert.deepEqual(await phase.storage.pendingActions(location.origin,phase.roomId,seat),[]);
    let revision=phase.latest.revision;
    const ready=modes.at(-1);ready[5].preparation.onComplete();
    await until(()=>phase.latest.revision>revision&&phase.inputReady,'owner original completion');
    env.submitPeer({kind:'preparation',operation:'skip-reward'});
    await until(()=>phase.inputReady&&env.peerSnapshot().personal.decision.players.rewardResolved,'peer skip');
    env.submitPeer({kind:'preparation',operation:'ready'});
    await until(()=>phase.inputReady&&phase.latest.personal.decision.kind!=='preparation','next encounter');
    for(let n=0;n<20&&phase.latest.personal.decision.kind!=='wait-actions';n++){
      const current=phase.latest,d=current.personal.decision;
      if(d.requiredSeats.includes(seat))await modes.at(-1)[2]();
      else env.submitPeer(env.peerSnapshot().personal.decision.options.find(o=>o.accept===false||o.pokemonId===null));
      await until(()=>phase.inputReady&&phase.latest.revision>current.revision&&env.peerSnapshot().revision===phase.latest.revision,'original next keep');
    }
    revision=phase.latest.revision;await phase.sendAction(attack(phase.latest),'next held FIGHT');
    await until(()=>phase.submitted,'held fight receipt');env.submitPeer(attack(env.peerSnapshot()));
    await until(()=>phase.inputReady&&phase.latest.revision>revision,'held fight result');
    assert.ok(phase.latest.events.some(e=>e.phase==='MoveEffectPhase'));
    assert.deepEqual(env.errors,[]);assert.deepEqual(await phase.storage.pendingActions(location.origin,phase.roomId,seat),[]);
  }finally{await env.close();}
});

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
