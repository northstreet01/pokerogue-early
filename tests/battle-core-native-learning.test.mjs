import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';

import { learningFixture } from './helpers/native-learning-fixture.mjs';
const config = { seed: 'learn-review', identity: { trainerId: 1, secretId: 2 } };
const own = (c, seat) => c.roster.entries.find(e => e.owner === seat && e.group === 'party' && e.index === 0);

for (const seat of [0, 1]) for (const slot of [1, null])
  test(`native saved LearnMove resumes original replacement/decline seat=${seat} slot=${slot}`, async () => {
    let { h, c } = await learningFixture({ seat });
    try {
      const before = structuredClone(c);
      c = (await h.request('native-run-to-boundary', c)).checkpoint;
      assert.equal(c.decision.kind, 'learn-move');
      assert.ok(!c.continuation.phaseQueue.some(d => d.phase.type === 'LearnMovePhase'), 'selected phase leaves the queue');
      assert.deepEqual(c.decision.requiredSeats, [seat]);
      assert.equal(c.decision.learn.pokemonId, own(c, seat).pokemon.fields.id);
      const action = c.decision.options[seat].find(o => o.slot === slot);
      await h.request('native-validate-progression', { checkpoint: c, seat, action });
      const projected = await h.request('native-project', { checkpoint: c, seat });
      assert.deepEqual(projected.personal.decision.learn, c.decision.learn);
      await h.close(); h = await createOriginalRuleHost(config);
      const resumed = await h.request('native-progression', { checkpoint: JSON.parse(JSON.stringify(c)), seat, action });
      const result = await h.request('native-run-to-boundary', resumed.checkpoint);
      const after = result.checkpoint;
      assert.equal(after.decision.kind, 'wait-actions');
      assert.deepEqual(own(after, 1 - seat).pokemon, own(before, 1 - seat).pokemon);
      const expected = structuredClone(own(before, seat).pokemon.fields.moveset);
      if (slot !== null) expected[slot] = { type: 'PokemonMove', fields: { moveId: 73, ppUsed: 0, ppUp: 0, virtual: false }, undefinedFields: [] };
      assert.deepEqual(own(after, seat).pokemon.fields.moveset, expected);
    } finally { await h.close(); }
  });

test('native automatic LearnMove runs original empty-slot branch without browser assets', async () => {
  const { h, c } = await learningFixture({ seat: 1, full: false });
  try {
    const after = (await h.request('native-run-to-boundary', c)).checkpoint;
    assert.equal(after.decision.kind, 'wait-actions');
    assert.equal(own(after, 1).pokemon.fields.moveset.at(-1).fields.moveId, 73);
    assert.deepEqual(own(after, 0).pokemon, own(c, 0).pokemon);
  } finally { await h.close(); }
});

test('native original ExpPhase actually queues LevelUp then automatically learns its level move', async () => {
  const { h, c } = await learningFixture({ seat: 0, full: false });
  try {
    // Synthetic EXP amount/queue, not a claim of a naturally won encounter.
    const p = c.continuation.phaseQueue[0].phase;
    p.type = 'ExpPhase'; delete p.fields.moveId;
    p.fields.expValue = { presence: 'value', value: 80 };
    const result = await h.request('native-run-to-boundary', c);
    const after = own(result.checkpoint, 0).pokemon.fields;
    assert.equal(after.level, 6);
    assert.equal(after.moveset.at(-1).fields.moveId, 74, 'original Bulbasaur level-6 Growth');
    const phases = result.events.filter(e => e.kind === 'phase-start').map(e => e.phase);
    assert.ok(phases.indexOf('LevelUpPhase') > phases.indexOf('ExpPhase'));
    assert.ok(phases.indexOf('LearnMovePhase') > phases.indexOf('LevelUpPhase'));
  } finally { await h.close(); }
});

test('off-field member retains original fieldIndex=-1 through native learning and JSON recovery', async () => {
  const { h, c } = await learningFixture({ seat: 1, index: 2, full: false });
  try {
    const after = (await h.request('native-run-to-boundary', JSON.parse(JSON.stringify(c)))).checkpoint;
    const member = after.roster.entries.find(e => e.owner === 1 && e.group === 'party' && e.index === 2);
    assert.equal(member.pokemon.fields.moveset.at(-1).fields.moveId, 73);
    assert.deepEqual(after.roster.field, c.roster.field);
  } finally { await h.close(); }
});

test('native learning validation/execution reject foreign owner, extra fields and stale phase consistently', async () => {
  const { h, c: queued } = await learningFixture();
  try {
    const c = (await h.request('native-run-to-boundary', queued)).checkpoint;
    const action = c.decision.options[1][0], before = JSON.stringify(c);
    for (const payload of [
      { checkpoint: c, seat: 0, action },
      { checkpoint: c, seat: 1, action: { ...action, extra: true } },
      { checkpoint: c, seat: 1, action: { ...action, pokemonId: own(c, 0).pokemon.fields.id } },
      { checkpoint: c, seat: 1, action: { ...action, slot: 4 } },
    ]) for (const operation of ['native-validate-progression', 'native-progression']) await assert.rejects(h.request(operation, payload));
    const corrupt = structuredClone(c);
    corrupt.continuation.currentPhase.phase.fields.partyMemberIndex.value = 1;
    for (const operation of ['native-validate-progression', 'native-progression'])
      await assert.rejects(h.request(operation, { checkpoint: corrupt, seat: 1, action }));
    assert.equal(JSON.stringify(c), before);
  } finally { await h.close(); }
});
