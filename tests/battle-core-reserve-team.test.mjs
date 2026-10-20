import test from 'node:test';
import assert from 'node:assert/strict';
import { capturedPreparation, settleNative, enterNextNative, attack } from './helpers/native-reserve-fixture.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';

const personal = (c, group) => c.roster.entries.filter(e => e.owner === 1 && e.group === group).sort((a, b) => a.index - b.index);
const swap = (c, index = 0) => ({ kind: 'preparation', operation: 'reserve-swap',
  partyId: personal(c, 'party')[index].pokemon.fields.id, reserveId: personal(c, 'reserve')[0].pokemon.fields.id });

test('ordinary captured reserve swaps into the front without replaying rewards and fights next encounter', async () => {
  const { h, c } = await capturedPreparation();
  try {
    const action = swap(c), before = JSON.stringify(c);
    assert.equal(action.reserveId, 0, 'zero is a valid stable captured ID');
    await h.request('native-validate-preparation', { checkpoint: c, seat: 1, action });
    assert.equal(JSON.stringify(c), before);
    const switched = (await h.request('native-prepare-action', { checkpoint: c, seat: 1, action })).checkpoint;
    assert.equal(switched.roster.field[1], null, 'next original Summon owns deployment, not the roster edit');
    assert.deepEqual(personal(switched, 'party')[0].pokemon, personal(c, 'reserve')[0].pokemon);
    assert.deepEqual(personal(switched, 'reserve')[0].pokemon, personal(c, 'party')[0].pokemon);
    assert.deepEqual(switched.decision.players, c.decision.players);
    assert.deepEqual(switched.pendingEffects, c.pendingEffects);
    assert.deepEqual(switched.players, c.players);
    assert.deepEqual(switched.eggState, c.eggState);
    const projected = await h.request('native-project', { checkpoint: switched, seat: 1 });
    assert.equal(projected.personal.party[0].id, action.reserveId);
    const next = await enterNextNative(h, JSON.parse(JSON.stringify(switched)));
    assert.equal(next.roster.field[1], action.reserveId);
    const inputs = { 0: attack(next, 0), 1: attack(next, 1) };
    assert.equal(inputs[1].pokemonId, action.reserveId);
    const beforeMoves = personal(next, 'party')[0].pokemon.fields.moveset;
    const submitted = (await h.request('native-submit', { checkpoint: next, inputs })).checkpoint;
    const result = await settleNative(h, submitted);
    const caught = result.roster.entries.find(e => e.pokemon.fields.id === action.reserveId);
    assert.equal(caught.pokemon.fields.moveset[inputs[1].cursor].fields.ppUsed,
      beforeMoves[inputs[1].cursor].fields.ppUsed + 1);
    assert.equal(personal(result, 'reserve')[0].pokemon.fields.id, action.partyId);
  } finally { await h.close(); }
});

test('reserve swap respects one and six member parties and a later original pre-battle selection', async () => {
  const { h, c } = await capturedPreparation();
  try {
    for (const size of [1, 6]) {
      // Explicit synthetic size boundaries; the reserve itself was captured by
      // the actual ordinary-ball path above. Never used as browser evidence.
      const initial = structuredClone(c), own = personal(initial, 'party');
      if (size === 1) {
        initial.roster.entries = initial.roster.entries.filter(e => !own.slice(1).includes(e));
        initial.roster.retiredIds.push(...own.slice(1).map(e => e.pokemon.fields.id));
      } else for (let index = 3; index < size; index++) {
        const entry = structuredClone(own[1]); entry.index = index; entry.pokemon.fields.id = 4000000000 + index;
        initial.roster.entries.push(entry);
      }
      const action = swap(initial, size - 1);
      const after = (await h.request('native-prepare-action', { checkpoint: initial, seat: 1, action })).checkpoint;
      assert.equal(personal(after, 'party').length, size);
      assert.deepEqual(after.roster.field.slice(0, 1), initial.roster.field.slice(0, 1));
      const next = await enterNextNative(h, after, size === 6 ? action.reserveId : null);
      assert.equal(next.roster.field[1], action.reserveId);
      assert.equal(personal(next, 'party').length, size);
    }
  } finally { await h.close(); }
});

test('reserve swap rejects foreign IDs, ready state, extra fields and unresolved personal choices without mutation', async () => {
  const { h, c } = await capturedPreparation();
  try {
    const action = swap(c);
    for (const bad of [{ ...action, partyId: c.roster.field[0] }, { ...action, reserveId: action.partyId },
      { ...action, reserveId: 4294967295 }, { ...action, extra: true }]) {
      await assert.rejects(h.request('native-validate-preparation', { checkpoint: c, seat: 1, action: bad }));
      await assert.rejects(h.request('native-prepare-action', { checkpoint: c, seat: 1, action: bad }));
    }
    const ready = structuredClone(c); ready.decision.players[1].rewardResolved = true; ready.decision.players[1].ready = true;
    await assert.rejects(h.request('native-validate-preparation', { checkpoint: ready, seat: 1, action }), e => e.code === 'PREPARATION_ALREADY_READY');
    const pending = structuredClone(c);
    pending.decision.players[1].selection = { optionId: pending.decision.players[1].rewards[0].id,
      pokemonId: action.partyId, moveIndex: null, fusionId: null };
    const before = JSON.stringify(pending);
    await assert.rejects(h.request('native-prepare-action', { checkpoint: pending, seat: 1, action }), e => e.code === 'UNRESOLVED_PREPARATION');
    assert.equal(JSON.stringify(pending), before);
    const growth = structuredClone(c);
    growth.pendingEffects.push({ id: 'preparation-growth-1-0', remaining: 'start', phase: { version: 1,
      type: 'LevelUpPhase', scope: 1, fields: Object.fromEntries(Object.entries({ partyMemberIndex: 0, fieldIndex: 0, player: true, lastLevel: 4, level: 5 })
        .map(([k, value]) => [k, { presence: 'value', value }])), presentation: {} } });
    await assert.rejects(h.request('native-prepare-action', { checkpoint: growth, seat: 1, action }), e => e.code === 'PREPARATION_GROWTH_PENDING');
    const empty = structuredClone(c);
    for (const e of empty.roster.entries) if (e.owner === 1 && e.pokemon.fields.id !== action.partyId) e.pokemon.fields.hp = 0;
    await assert.rejects(h.request('native-prepare-action', { checkpoint: empty, seat: 1, action }), e => e.code === 'NO_LIVING_PARTY_MEMBER');
  } finally { await h.close(); }
});

test('actual native faint requires an owned forced replacement and survives per-phase Worker recovery', async () => {
  const seed = 'team-forced-0', identity = { trainerId: 1, secretId: 2 };
  const h = await createOriginalRuleHost({ seed, identity });
  try {
    const initial = (await h.request('native-open-to-input', { parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } })).checkpoint;
    // Explicit synthetic near-faint initial HP, followed by original combat,
    // FaintPhase and its queued SwitchPhase. Not a browser shortcut.
    initial.roster.entries.find(e => e.pokemon.fields.id === initial.roster.field[1]).pokemon.fields.hp = 1;
    const submitted = (await h.request('native-submit', { checkpoint: initial, inputs: { 0: attack(initial, 0), 1: attack(initial, 1) } })).checkpoint;
    const result = await h.request('native-run-to-boundary', submitted), c = result.checkpoint;
    assert.equal(c.decision.kind, 'wait-switch');
    assert.ok(result.events.some(e => e.phase === 'FaintPhase'));
    assert.deepEqual(c.decision.requiredSeats, [1]);
    assert.equal(c.continuation.currentPhase.remaining, 'wait-switch');
    const action = c.decision.options[1][0], before = JSON.stringify(c);
    const wrongScope = structuredClone(c); wrongScope.continuation.currentPhase.phase.scope = 0;
    await assert.rejects(h.request('native-validate-checkpoint', wrongScope), e => e.code === 'INVALID_SWITCH_DECISION');
    await h.request('native-validate-switch', { checkpoint: c, seat: 1, action });
    for (const bad of [{ ...action, pokemonId: c.roster.field[0] }, { ...action, pokemonId: null }])
      await assert.rejects(h.request('native-validate-switch', { checkpoint: c, seat: 1, action: bad }));
    assert.equal(JSON.stringify(c), before);
    const chosen = (await h.request('native-switch', { checkpoint: c, inputs: { 1: action } })).checkpoint;
    const expected = await settleNative(h, chosen);
    let recovered = chosen;
    for (let guard = 0; guard < 20 && recovered.decision.kind === 'continuing'; guard++) {
      const fresh = await createOriginalRuleHost({ seed, identity });
      try { recovered = (await fresh.request('native-step', JSON.parse(JSON.stringify(recovered)))).checkpoint; }
      finally { await fresh.close(); }
    }
    const semantic = value => {
      const v = structuredClone(value); delete v.decision.id;
      for (const list of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue']) for (const d of v.continuation[list]) delete d.phaseId;
      return v;
    };
    assert.deepEqual(semantic(recovered), semantic(expected));
    assert.equal(recovered.roster.field[1], action.pokemonId);
    assert.equal(recovered.roster.field[0], initial.roster.field[0]);
    assert.equal(recovered.decision.kind, 'wait-actions');
  } finally { await h.close(); }
});
