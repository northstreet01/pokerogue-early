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
