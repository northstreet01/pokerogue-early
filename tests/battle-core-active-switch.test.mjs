import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { canonical } from '../src/battle-core/coop-contract.mjs';

const parties = [[1, 4, 7], [906, 909, 912]];
const eggState = { players: [[], []] };
async function open(seed = 'vs02b08-switch') {
  const h = await createOriginalRuleHost({ seed, identity: { trainerId: 1, secretId: 2 } });
  const c = (await h.request('native-open-to-input', { parties, eggState })).checkpoint;
  return { h, c };
}
const switchOption = (c, seat) => c.decision.options[seat].find(o => o.kind === 'switch');
const fightOption = (c, seat) => c.decision.options[seat].find(o => o.kind === 'fight' && (o.target === null || o.target >= 2));
const party = (c, seat) => c.roster.entries.filter(e => e.owner === seat && e.group === 'party')
  .sort((a, b) => a.index - b.index).map(e => e.pokemon.fields.id);

test('native active switch applies the original POKEMON command and keeps the ally in its own slot', async () => {
  const { h, c } = await open();
  try {
    const sw = switchOption(c, 0), partnerFight = fightOption(c, 1);
    assert.ok(sw && partnerFight);
    const oldActive = c.roster.field[0], ally = c.roster.field[1];
    const switched = party(c, 0).indexOf(sw.pokemonId);
    assert.ok(switched > 0);
    const before = c.roster.entries.find(e => e.pokemon.fields.id === oldActive).pokemon.fields.moveset.map(m => m.fields.ppUsed);
    await h.request('native-validate', { checkpoint: c, seat: 0, action: sw });
    const sub = (await h.request('native-submit', { checkpoint: c, inputs: { 0: sw, 1: partnerFight } })).checkpoint;
    assert.equal(sub.decision.kind, 'continuing');
    const r = (await h.request('native-run-to-boundary', sub)).checkpoint;
    assert.equal(r.decision.kind, 'wait-actions');
    assert.equal(r.roster.field[0], sw.pokemonId);
    assert.equal(r.roster.field[1], ally);
    assert.deepEqual(party(r, 0).slice(0, 2), [sw.pokemonId, oldActive]);
    assert.deepEqual(party(r, 1), party(c, 1));
    const after = r.roster.entries.find(e => e.pokemon.fields.id === oldActive).pokemon.fields.moveset.map(m => m.fields.ppUsed);
    assert.deepEqual(after, before, 'switching must not consume the outgoing move PP');
    assert.equal(r.battle.turn, c.battle.turn + 1);
  } finally { await h.close(); }
});

test('both seats can switch in the same turn and the next action boundary remains shared', async () => {
  const { h, c } = await open();
  try {
    const s0 = switchOption(c, 0), s1 = switchOption(c, 1);
    assert.ok(s0 && s1);
    const sub = (await h.request('native-submit', { checkpoint: c, inputs: { 0: s0, 1: s1 } })).checkpoint;
    const r = (await h.request('native-run-to-boundary', sub)).checkpoint;
    assert.equal(r.decision.kind, 'wait-actions');
    assert.equal(r.roster.field[0], s0.pokemonId);
    assert.equal(r.roster.field[1], s1.pokemonId);
    assert.equal(r.decision.requiredSeats.length, 2);
  } finally { await h.close(); }
});

test('active switch validation rejects partner, active and stale targets without mutation', async () => {
  const { h, c } = await open();
  try {
    const before = JSON.stringify(c);
    const active = c.roster.field[0];
    const partner = c.roster.entries.find(e => e.owner === 1 && e.group === 'party').pokemon.fields.id;
    for (const id of [active, partner, 999999999]) {
      await assert.rejects(h.request('native-validate', { checkpoint: c, seat: 0,
        action: { kind: 'switch', pokemonId: id } }), error =>
        ['INVALID_ACTION', 'INVALID_SWITCH_TARGET', 'INVALID_SWITCH_INTENT'].includes(error.code));
    }
    assert.equal(JSON.stringify(c), before);
  } finally { await h.close(); }
});

test('JSON restoration before submit produces the same active-switch result', async () => {
  const { h, c } = await open();
  try {
    const a = switchOption(c, 0), b = fightOption(c, 1);
    const first = (await h.request('native-submit', { checkpoint: JSON.parse(JSON.stringify(c)), inputs: { 0: a, 1: b } })).checkpoint;
    const second = (await h.request('native-submit', { checkpoint: JSON.parse(JSON.stringify(c)), inputs: { 0: a, 1: b } })).checkpoint;
    assert.equal(canonical(first), canonical(second));
  } finally { await h.close(); }
});

test('two switches with an incoming Intimidate survive every queued phase restart', async () => {
  const h = await createOriginalRuleHost({ seed: 'vs02b08-switch', identity: { trainerId: 1, secretId: 2 } });
  try {
    const c = (await h.request('native-open-to-input', {
      parties: [[1, 4, 7], [906, 23, 912]], eggState
    })).checkpoint;
    const inputs = { 0: switchOption(c, 0), 1: switchOption(c, 1) };
    const submitted = (await h.request('native-submit', { checkpoint: c, inputs })).checkpoint;
    const expected = (await h.request('native-run-to-boundary', submitted)).checkpoint;
    let restored = submitted;
    const trace = [];
    for (let step = 0; restored.decision.kind === 'continuing' && step < 80; step++) {
      const fresh = await createOriginalRuleHost({ seed: c.scene.seed, identity: { trainerId: 1, secretId: 2 } });
      try {
        const result = await fresh.request('native-step', JSON.parse(JSON.stringify(restored)));
        restored = result.checkpoint;
        trace.push(...result.events.filter(e => e.kind === 'phase-start').map(e => e.phase));
      } finally { await fresh.close(); }
    }
    assert.equal(restored.decision.kind, 'wait-actions');
    assert.deepEqual(restored.roster.field.slice(0, 2), [inputs[0].pokemonId, inputs[1].pokemonId]);
    const semantic = value => {
      const copy = structuredClone(value);
      delete copy.decision.id;
      for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue'])
        for (const descriptor of copy.continuation[key]) delete descriptor.phaseId;
      return copy;
    };
    assert.deepEqual(semantic(restored), semantic(expected));
    assert.ok(trace.includes('ShowAbilityPhase'), 'incoming ability must interrupt the switch chain');
  } finally { await h.close(); }
});

test('switched-out participants receive original experience and reach preparation after victory', async () => {
  const { h, c } = await open();
  try {
    const outgoing = c.roster.field.slice(0, 2);
    let state = (await h.request('native-submit', { checkpoint: c,
      inputs: { 0: switchOption(c, 0), 1: switchOption(c, 1) } })).checkpoint;
    const trace = [];
    for (let turn = 0; turn < 12; turn++) {
      const result = await h.request('native-run-to-boundary', state);
      state = result.checkpoint;
      trace.push(...result.events.filter(e => e.kind === 'phase-start').map(e => e.phase));
      if (state.decision.kind !== 'wait-actions') break;
      state = (await h.request('native-submit', { checkpoint: state,
        inputs: { 0: fightOption(state, 0), 1: fightOption(state, 1) } })).checkpoint;
    }
    assert.ok(trace.includes('ShowPartyExpBarPhase'));
    assert.ok(trace.includes('HidePartyExpBarPhase'));
    assert.ok(state.continuation.phaseQueue.some(d => d.phase.type === 'SelectModifierPhase'));
    for (const id of outgoing) {
      const before = c.roster.entries.find(e => e.pokemon.fields.id === id).pokemon.fields;
      const after = state.roster.entries.find(e => e.pokemon.fields.id === id).pokemon.fields;
      assert.ok(after.exp > before.exp);
    }
  } finally { await h.close(); }
});
