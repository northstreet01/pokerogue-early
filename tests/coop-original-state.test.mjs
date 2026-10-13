import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterStateCodec } from '../src/battle-core/roster-state.mjs';
import { copy, requireContract } from '../src/battle-core/coop-contract.mjs';
import { createSnapshotConsumer } from '../src/battle-core/coop-client.mjs';
import { formalFixture } from './helpers/formal-ws.mjs';
import { pokemon, originalPokemon } from './helpers/original-model.mjs';
const codec = createRosterStateCodec(pokemon);
function initialRoster() {
  return { entries: [
    { owner: 0, group: 'party', index: 0, pokemon: originalPokemon(100) },
    { owner: 1, group: 'party', index: 0, pokemon: originalPokemon(101) },
    { owner: null, group: 'enemy', index: 0, pokemon: originalPokemon(102, true) }
  ], field: [100, 101, 102, null], retiredIds: [] };
}
// This adapter executes original healing/PP/status methods solely to test M2
// continuation. It is not the M3 turn runner and is never mounted in production.
const adapter = {
  rulesVersion: 'm2-original-pokemon-slice', contentHash: 'test-catalog-only',
  createInitialContext: () => ({ tick: 0, roster: initialRoster() }),
  captureCheckpoint: ctx => ({ tick: ctx.tick, roster: codec.capture(ctx.roster) }),
  validateCheckpoint(s) { requireContract(Number.isSafeInteger(s.tick) && s.tick >= 0); codec.restore(s.roster); },
  restoreCheckpoint: s => ({ tick: s.tick, roster: codec.restore(s.roster) }),
  describeDecision: ctx => ({ id: `state-${ctx.tick}`, requiredSeats: [0, 1] }),
  validateAction(ctx, seat, action) { requireContract(action.kind === 'continue-test' && action.pokemonId === ctx.roster.field[seat], 'INVALID_OWNER'); },
  advanceToDecision(ctx) {
    for (const entry of ctx.roster.entries) { entry.pokemon.heal(2); entry.pokemon.status.incrementTurn(); entry.pokemon.moveset[0].ppUsed++; }
    ctx.tick++; return { context: ctx, events: [], grants: [] };
  },
  projectSnapshot: (ctx, seat) => ({ shared: { tick: ctx.tick, roster: codec.capture(ctx.roster) }, personal: { ownIds: ctx.roster.entries.filter(e => e.owner === seat).map(e => e.pokemon.id) } })
};
function consumer(client, versions) {
  return createSnapshotConsumer({ versions, isCurrent: epoch => client.identity.connectionEpoch === epoch, send: m => client.send(m), adapter: {
    applySnapshot(s) {
      const candidate = codec.restore(s.shared.roster); // Whole candidate before replacing old model.
      client.model = { tick: s.shared.tick, roster: candidate };
      if (client.corrupt) candidate.entries[0].pokemon.hp++;
    },
    captureAppliedState: () => adapter.projectSnapshot(client.model, client.identity.seat),
    async applyGrantsTransaction(grants) { assert.deepEqual(grants, []); }
  } });
}
async function connect(f, identities) {
  const a = await f.client(), b = await f.client();
  for (const [index, client] of [a, b].entries()) {
    client.send(identities ? { type: 'resumeSeat', roomId: identities[index].roomId, resumeToken: identities[index].resumeToken } : index === 0 ? { type: 'createRoom', name: 'A' } : { type: 'joinRoom', name: 'B', roomId: a.identity.roomId });
    client.identity = await client.wait(m => m.type === 'welcome'); client.consume = consumer(client, f.versions);
  }
  const sa = await a.wait(m => m.type === 'snapshot'), sb = await b.wait(m => m.type === 'snapshot');
  await a.consume(sa); await b.consume(sb); await a.wait(m => m.type === 'syncStatus' && !m.blocked);
  return { a, b, sa, sb };
}
const action = (snapshot, actionId) => ({ type: 'submitAction', roomId: snapshot.roomId, runId: snapshot.runId, decisionId: snapshot.decisionId, expectedRevision: snapshot.revision, actionId, action: { kind: 'continue-test', pokemonId: snapshot.shared.roster.field[snapshot.seat] } });

test('roster validates ownership, stable field/source references and rejects whole corrupt candidates', () => {
  const original = initialRoster(), saved = codec.capture(original), restored = codec.restore(copy(saved));
  assert.deepEqual(codec.capture(restored), saved); assert.equal(restored.entries[0].pokemon.isPlayer(), true);
  const mutations = [s => { s.entries[1].pokemon.fields.id = 100; }, s => { s.field[0] = 101; }, s => { s.entries[1].owner = 0; }, s => { s.entries[0].owner = null; }, s => { s.entries[2].pokemon.fields.turnData.fields.attacksReceived[0].fields.sourceId = 999; }, s => { s.entries[2].pokemon.fields.hp = -1; }];
  for (const mutate of mutations) { const bad = copy(saved); mutate(bad); assert.throws(() => codec.restore(bad)); assert.deepEqual(codec.capture(original), saved); }
  const retired = copy(saved); retired.entries[0].pokemon.fields.turnData.fields.attacksReceived[0].fields.sourceId = 999; retired.retiredIds.push(999); assert.doesNotThrow(() => codec.restore(retired));
});
test('two WebSocket clients independently restore original Pokemon prototypes and continue identically after restart', async () => {
  let f = await formalFixture(adapter);
  try {
    const p = await connect(f); assert.notEqual(p.a.model.roster.entries[0].pokemon, p.b.model.roster.entries[0].pokemon);
    assert.equal(p.a.model.roster.entries[0].pokemon instanceof pokemon.PlayerPokemon, true);
    p.a.send(action(p.sa, 'pending')); await p.a.wait(m => m.type === 'actionReceipt' && m.accepted);
    const reference = adapter.advanceToDecision(adapter.createInitialContext()).context;
    const store = f.store; await f.close(); f = await formalFixture(adapter, store);
    const resumed = await connect(f, [p.a.identity, p.b.identity]);
    resumed.b.send(action(resumed.sb, 'finish')); await resumed.b.wait(m => m.type === 'actionReceipt' && m.accepted);
    const sa = await resumed.a.wait(m => m.type === 'snapshot' && m.revision === 1), sb = await resumed.b.wait(m => m.type === 'snapshot' && m.revision === 1);
    await resumed.a.consume(sa); await resumed.b.consume(sb); await resumed.a.wait(m => m.type === 'syncStatus' && m.revision === 1 && !m.blocked);
    assert.deepEqual(adapter.captureCheckpoint(resumed.a.model), adapter.captureCheckpoint(reference));
    assert.deepEqual(adapter.captureCheckpoint(resumed.b.model), adapter.captureCheckpoint(reference));
  } finally { await f.close(); }
});
test('damage to one applied original model prevents the next decision; full resync repairs both clients', async () => {
  const f = await formalFixture(adapter);
  try {
    const p = await connect(f); p.a.messages = []; p.b.messages = [];
    p.a.corrupt = true; await assert.rejects(p.a.consume(p.sa), /MODEL_MISMATCH/);
    const sa = await p.a.wait(m => m.type === 'snapshot'), sb = await p.b.wait(m => m.type === 'snapshot');
    p.b.send(action(sb, 'blocked')); assert.equal((await p.b.wait(m => m.type === 'actionReceipt')).code, 'SYNC_BLOCKED');
    p.a.corrupt = false; await p.a.consume(sa); await p.b.consume(sb); await p.a.wait(m => m.type === 'syncStatus' && !m.blocked);
    assert.deepEqual(adapter.captureCheckpoint(p.a.model), adapter.captureCheckpoint(p.b.model));
  } finally { await f.close(); }
});
