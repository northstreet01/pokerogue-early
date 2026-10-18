import { createRequire } from 'node:module';
import { createOriginalClientModel } from '../src/coop/original-client-model.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import test, { before } from 'node:test';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
before(() => buildCoopRuntime());
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FormalRoomStore } from '../server/formal-coop-service.mjs';
import { createOriginalCoopAdapter } from '../server/original-coop-adapter.mjs';
import { canonical } from '../src/battle-core/coop-contract.mjs';

// VS-02 segment 1: lobby selections, persisted adapter envelope and restart
// projection. No browser or production storage is touched.
const fixture = {
  seed: 'vs02-lobby-fixture',
  identities: [{ trainerId: 1, secretId: 2 }, { trainerId: 3, secretId: 4 }],
  lobby: true,
};
const starter = (seat) => seat === 0 ? [1, 4, 7] : [25, 133, 152];
const action = (seat, ready = true) => ({ kind: 'starter-ready', starters: starter(seat), eggs: [], ready });

async function lobbyContext(adapter, runId) {
  return adapter.createInitialContext({ runId });
}

test('lobby selections create a real battle with each seat party and persisted envelope', async () => {
  const adapter = createOriginalCoopAdapter({ fixture });
  const runId = 'vs02-lobby-' + Date.now();
  try {
    let context = await lobbyContext(adapter, runId);
    assert.ok(context.lobby);
    assert.deepEqual(await adapter.describeDecision(context), {
      id: `lobby-${runId}-0`, requiredSeats: [0, 1], collection: 'incremental',
    });
    const before0 = await adapter.projectSnapshot(context, 0);
    const before1 = await adapter.projectSnapshot(context, 1);
    assert.equal(canonical(before0.shared), canonical(before1.shared));
    assert.equal(before0.shared.stage, 'lobby');
    assert.equal(before0.personal.selection.starters, null);

    await adapter.validateAction(context, 0, action(0));
    const afterOne = await adapter.advanceToDecision(context, { 0: action(0) });
    context = afterOne.context;
    assert.ok(context.lobby);
    const afterOneView = await adapter.projectSnapshot(context, 0);
    assert.deepEqual(afterOneView.shared.ready, [true, false]);
    assert.deepEqual(afterOneView.personal.selection.starters, starter(0));

    await adapter.validateAction(context, 1, action(1));
    const battle = await adapter.advanceToDecision(context, { 1: action(1) });
    context = battle.context;
    assert.ok(!context.lobby);
    assert.equal(context.checkpoint.decision.kind, 'wait-actions');
    const view0 = await adapter.projectSnapshot(context, 0);
    const view1 = await adapter.projectSnapshot(context, 1);
    assert.equal(canonical(view0.shared), canonical(view1.shared));
    assert.equal(view0.shared.stage, 'battle');
    assert.equal(view0.shared.waveIndex, 1);
    assert.deepEqual(view0.personal.party.map(entry => entry.pokemon.fields.species), starter(0));
    assert.deepEqual(view1.personal.party.map(entry => entry.pokemon.fields.species), starter(1));

    const checkpoint = await adapter.captureCheckpoint(context);
    assert.equal(checkpoint.formatVersion, 2);
    assert.equal(checkpoint.stage, 'battle');
    assert.equal(checkpoint.lobby, null);
    const stored = JSON.parse(JSON.stringify(checkpoint));
    await adapter.validateCheckpoint(stored);
    const restored = await adapter.restoreCheckpoint(stored);
    assert.deepEqual(canonical(await adapter.captureCheckpoint(restored)), canonical(checkpoint));
    assert.ok(checkpoint.intents.length > 0);
    assert.ok(checkpoint.intents.every(intent => typeof intent.id === 'string' && 'owner' in intent));
  } finally {
    await adapter.closeAll();
  }
});

test('lobby rejects invalid starters and eggs before buffering', async () => {
  const adapter = createOriginalCoopAdapter({ fixture });
  try {
    const context = await lobbyContext(adapter, 'vs02-invalid-lobby');
    await assert.rejects(adapter.validateAction(context, 0, {
      kind: 'starter-ready', starters: [1, 1, 7], eggs: [], ready: true,
    }), /INVALID_POKEMON_SELECTION/);
    await assert.rejects(adapter.validateAction(context, 0, {
      kind: 'starter-ready', starters: [1, 4, 999999], eggs: [], ready: true,
    }), /INVALID_POKEMON_SELECTION/);
    await assert.rejects(adapter.validateAction(context, 0, {
      kind: 'starter-ready', starters: starter(0), eggs: [{ id: 1, gachaType: 0, hatchWaves: 1 }], ready: true,
    }), /INVALID_EGG_STATE/);
    assert.equal(canonical(await adapter.captureCheckpoint(context)),
      canonical(await adapter.captureCheckpoint(await lobbyContext(adapter, 'vs02-invalid-lobby'))));
  } finally {
    await adapter.closeAll();
  }
});

test('FormalRoomStore persists and reloads the adapter envelope without touching production data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vs02-store-'));
  const adapter = createOriginalCoopAdapter({ fixture });
  try {
    const context = await lobbyContext(adapter, 'vs02-store-room');
    const checkpoint = await adapter.captureCheckpoint(context);
    const store = new FormalRoomStore(directory);
    await store.save({ roomId: 'ABCDEF', envelope: checkpoint });
    const loaded = await store.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].roomId, 'ABCDEF');
    await adapter.validateCheckpoint(loaded[0].envelope);
    const restored = await adapter.restoreCheckpoint(loaded[0].envelope);
    assert.equal(restored.lobby.step, 0);
    const corrupt = JSON.parse(JSON.stringify(loaded[0].envelope));
    corrupt.formatVersion = 1;
    await assert.rejects(adapter.validateCheckpoint(corrupt), /INVALID_CHECKPOINT/);
    assert.equal((await store.load()).length, 1);
  } finally {
    await adapter.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a fresh adapter restores the persisted battle envelope and matches uninterrupted projection', async () => {
  const first = createOriginalCoopAdapter({ fixture });
  const second = createOriginalCoopAdapter({ fixture });
  const runId = 'vs02-restart-' + Date.now();
  try {
    let context = await lobbyContext(first, runId);
    await first.validateAction(context, 0, action(0));
    context = (await first.advanceToDecision(context, { 0: action(0) })).context;
    await first.validateAction(context, 1, action(1));
    context = (await first.advanceToDecision(context, { 1: action(1) })).context;
    const checkpoint = await first.captureCheckpoint(context);
    const stored = JSON.parse(JSON.stringify(checkpoint));
    const restored = await second.restoreCheckpoint(stored);
    const viewFirst = await first.projectSnapshot(context, 0);
    const viewSecond = await second.projectSnapshot(restored, 0);
    assert.deepEqual(canonical(viewSecond), canonical(viewFirst));
  } finally {
    await first.closeAll();
    await second.closeAll();
  }
});


test('restore rejects corrupt stages, seed, shape, intents and ready-without-selection', async () => {
  const adapter = createOriginalCoopAdapter({ fixture });
  try {
    let context = await adapter.createInitialContext({ runId: 'vs02-restore-validation' });
    const lobby = await adapter.captureCheckpoint(context);
    for (const mutate of [
      c => { c.formatVersion = 1; },
      c => { c.unexpected = true; },
      c => { c.lobby.players[0].ready = true; },
      c => { c.lobby.players[0].eggs = [{}]; },
      c => { c.intents = [{}]; },
    ]) {
      const bad = structuredClone(lobby); mutate(bad);
      await assert.rejects(adapter.restoreCheckpoint(bad));
    }
    context = (await adapter.advanceToDecision(context, { 0: action(0) })).context;
    context = (await adapter.advanceToDecision(context, { 1: action(1) })).context;
    const battle = await adapter.captureCheckpoint(context);
    for (const mutate of [
      c => { c.stage = 'preparation'; },
      c => { c.provisioning.seed = 'wrong-seed'; },
      c => { c.intents.push(structuredClone(c.intents[0])); },
      c => { c.intents[0].status = 'granted'; },
    ]) {
      const bad = structuredClone(battle); mutate(bad);
      await assert.rejects(adapter.restoreCheckpoint(bad), /INVALID_CHECKPOINT/);
    }
    const mismatched = structuredClone(battle);
    mismatched.provisioning.identities[0].trainerId++;
    await assert.rejects(adapter.restoreCheckpoint(mismatched), /ROOM_PROVISIONING_MISMATCH/);
    assert.equal(canonical(await adapter.captureCheckpoint(context)), canonical(battle));
  } finally { await adapter.closeAll(); }
});

test('lobby projection cannot mutate selections and invalid seat is rejected', async () => {
  const adapter = createOriginalCoopAdapter({ fixture });
  try {
    let context = await adapter.createInitialContext({ runId: 'vs02-view-purity' });
    context = (await adapter.advanceToDecision(context, { 0: action(0) })).context;
    const before = canonical(await adapter.captureCheckpoint(context));
    const view = await adapter.projectSnapshot(context, 0);
    view.personal.selection.starters[0] = 999;
    await assert.rejects(adapter.validateAction(context, 2, action(0)), /INVALID_SEAT/);
    assert.equal(canonical(await adapter.captureCheckpoint(context)), before);
  } finally { await adapter.closeAll(); }
});

test('v6 projection preserves unknown egg inventory rather than inventing empty eggs', async () => {
  const adapter = createOriginalCoopAdapter({ fixture });
  try {
    let context = await adapter.createInitialContext({ runId: 'vs02-v6-view' });
    context = (await adapter.advanceToDecision(context, { 0: action(0) })).context;
    context = (await adapter.advanceToDecision(context, { 1: action(1) })).context;
    const saved = await adapter.captureCheckpoint(context);
    // Explicit legacy-codec fixture, never a production migration.
    saved.nativeCheckpoint.version = 6;
    delete saved.nativeCheckpoint.eggState;
    const legacy = await adapter.restoreCheckpoint(saved);
    const view = await adapter.projectSnapshot(legacy, 0);
    assert.equal(view.personal.eggs, null);
    const original = createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');
    original.describeOriginalCatalogs();
    const model = createOriginalClientModel(original);
    model.applySnapshot({ seat: 0, ...view });
    assert.deepEqual(model.captureAppliedState(), view);
    assert.equal((await adapter.captureCheckpoint(legacy)).nativeCheckpoint.version, 6);
    assert.ok(!Object.hasOwn((await adapter.captureCheckpoint(legacy)).nativeCheckpoint, 'eggState'));
  } finally { await adapter.closeAll(); }
});

for (const disposal of ['failRoom', 'closeRoom', 'closeAll']) {
  test('pending request cannot resurrect a Worker after ' + disposal, async () => {
    let count = 0, started, rejectPending;
    const pendingStarted = new Promise(resolve => { started = resolve; });
    // Lifecycle-only fault injection. No simulated battle result or rules.
    const adapter = createOriginalCoopAdapter({ fixture, hostFactory: async () => {
      count++;
      return {
        request(operation) {
          if (operation === 'catalogs') return Promise.resolve({ species: [1, 4, 7].map(id => ({ id })) });
          assert.equal(operation, 'native-validate-eggs');
          return new Promise((resolve, reject) => { rejectPending = reject; started(); });
        },
        async close() { rejectPending?.(Object.assign(new Error('closed'), { code: 'ORIGINAL_RUNTIME_CLOSED' })); },
      };
    } });
    try {
      const context = await adapter.createInitialContext({ runId: 'lifecycle-' + disposal });
      const request = adapter.validateAction(context, 0, action(0));
      const rejected = assert.rejects(request, /ROOM_WORKER_FAILED/);
      await pendingStarted;
      await adapter[disposal](context.runId);
      await rejected;
      assert.equal(count, 1, 'explicit disposal must not create replacement host');
    } finally { await adapter.closeAll(); }
  });
}


test('original status acquisition agrees with continuous execution and worker restart at each phase', { timeout: 60000 }, async () => {
  const config = { seed: fixture.seed, identity: fixture.identities[0] };
  let host = await createOriginalRuleHost(config);
  try {
    const initial = (await host.request('native-open-to-input', {
      parties: [starter(0), starter(1)], eggState: { players: [[], []] }, identities: fixture.identities,
    })).checkpoint;
    const inputs = Object.fromEntries([0, 1].map(seat =>
      [seat, initial.decision.options[seat].find(option => option.kind === 'fight' && option.target >= 2)]));
    const submitted = (await host.request('native-submit', { checkpoint: initial, inputs })).checkpoint;
    const continuous = await host.request('native-run-to-boundary', submitted);
    let checkpoint = submitted; const events = [];
    for (let i = 0; checkpoint.decision.kind === 'continuing'; i++) {
      assert.ok(i < 100);
      const next = checkpoint.continuation.phaseQueuePrepend.at(-1) ?? checkpoint.continuation.phaseQueue[0];
      if (next?.phase.type === 'SelectModifierPhase') break;
      await host.close(); host = await createOriginalRuleHost(config);
      const result = await host.request('native-step', JSON.parse(JSON.stringify(checkpoint)));
      checkpoint = result.checkpoint; events.push(...result.events);
    }
    const semantic = value => {
      const copy = structuredClone(value); delete copy.decision.id;
      for (const key of ['currentPhase', 'standbyPhase']) if (copy.continuation[key]) delete copy.continuation[key].phaseId;
      for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue'])
        for (const phase of copy.continuation[key]) delete phase.phaseId;
      return copy;
    };
    assert.deepEqual(semantic(checkpoint), semantic(continuous.checkpoint));
    assert.deepEqual(events, continuous.events);
    assert.ok(events.some(e => e.kind === 'phase-start' && e.phase === 'ObtainStatusEffectPhase'));
    assert.ok(checkpoint.roster.entries.some(e => e.pokemon.fields.status));
  } finally { await host.close(); }
});


test('concurrent failed requests share one replacement Worker', async () => {
  let created = 0, closed = new Set();
  const adapter = createOriginalCoopAdapter({ fixture, hostFactory: async () => {
    const id = ++created;
    return {
      async request(operation) {
        if (operation === 'catalogs') return { species: [1, 4, 7].map(id => ({ id })) };
        assert.equal(operation, 'native-validate-eggs');
        if (id === 1) throw Object.assign(new Error('worker exited'), { code: 'ORIGINAL_RUNTIME_EXITED' });
        return true;
      },
      async close() { closed.add(id); },
    };
  } });
  try {
    const context = await adapter.createInitialContext({ runId: 'vs02-recovery-concurrent' });
    await Promise.all([adapter.validateAction(context, 0, action(0)), adapter.validateAction(context, 1, action(0))]);
    assert.equal(created, 2);
  } finally { await adapter.closeAll(); }
  assert.deepEqual([...closed].sort(), [1, 2]);
});
