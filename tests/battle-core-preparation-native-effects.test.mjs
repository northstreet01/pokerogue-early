import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { canonical } from '../src/battle-core/coop-contract.mjs';

const parties = [[1, 4, 7], [906, 909, 912]];
before(async () => { await buildCoopRuntime(); });
const eggState = { players: [[], []] };
const front = c => (c.continuation.phaseQueuePrepend.at(-1) ?? c.continuation.phaseQueue[0])?.phase?.type;
async function prep(seed) {
  const h = await createOriginalRuleHost({ seed, identity: { trainerId: 1, secretId: 2 } });
  let c = (await h.request('native-open-to-input', { parties, eggState })).checkpoint;
  for (let turn = 0; turn < 14; turn++) {
    if (c.decision.kind === 'wait-actions') {
      const options = c.decision.options;
      c = (await h.request('native-submit', { checkpoint: c, inputs: {
        0: options[0].find(o => o.target >= 2) ?? options[0][0],
        1: options[1].find(o => o.target >= 2) ?? options[1][0],
      } })).checkpoint;
    }
    c = (await h.request('native-run-to-boundary', c)).checkpoint;
    if (front(c) === 'SelectModifierPhase' && c.decision.kind === 'continuing') {
      c = (await h.request('native-preparation', c)).checkpoint;
      return { h, c };
    }
  }
  await h.close();
  throw new Error('PREPARATION_NOT_REACHED');
}

test('real Worker grants an original Pokeball reward once with unchanged peer/RNG', async t => {
  const { h, c } = await prep('mvp-native-entry');
  try {
    const p = c.decision.players[0];
    const ball = p.rewards.find(r => ['POKEBALL', 'GREAT_BALL', 'ULTRA_BALL'].includes(r.type.catalogId));
    assert.ok(ball, 'fixture reward must include a ball');
    const action = { kind: 'preparation', operation: 'reward', optionId: ball.id,
      pokemonId: null, moveIndex: null, fusionId: null };
    const beforeBalls = JSON.stringify(c.players[0].pokeballCounts);
    const beforePeer = canonical(c.players[1]);
    const beforeRandom = c.sceneRandom;
    await h.request('native-validate-preparation', { checkpoint: c, seat: 0, action });
    const r = (await h.request('native-prepare-action', { checkpoint: c, seat: 0, action })).checkpoint;
    assert.notEqual(JSON.stringify(r.players[0].pokeballCounts), beforeBalls);
    assert.equal(r.decision.players[0].rewardResolved, true);
    assert.equal(canonical(r.players[1]), beforePeer);
    assert.equal(r.sceneRandom, beforeRandom);
    await assert.rejects(h.request('native-prepare-action', { checkpoint: r, seat: 0, action }),
      error => error.code === 'INVALID_PREPARATION_OPTION' || error.code === 'REWARD_ALREADY_RESOLVED');
  } finally { await h.close(); }
});

test('real Worker applies an original Potion to the selected own target only', async t => {
  const { h, c } = await prep('potion-d');
  try {
    const p = c.decision.players[0];
    const potion = p.rewards.find(r => r.type.catalogId === 'POTION');
    assert.ok(potion, 'fixture reward must include a Potion');
    const own = c.roster.entries.filter(e => e.owner === 0 && e.group === 'party');
    const target = own.find(e => e.pokemon.fields.hp > 0 && e.pokemon.fields.hp < e.pokemon.fields.stats[0]);
    assert.ok(target);
    const action = { kind: 'preparation', operation: 'reward', optionId: potion.id,
      pokemonId: target.pokemon.fields.id, moveIndex: null, fusionId: null };
    const beforeHp = target.pokemon.fields.hp, maxHp = target.pokemon.fields.stats[0];
    const beforePeer = canonical(c.players[1]);
    const beforePeerHp = canonical(c.roster.entries.filter(e => e.owner === 1).map(e => e.pokemon.fields.hp));
    await h.request('native-validate-preparation', { checkpoint: c, seat: 0, action });
    const r = (await h.request('native-prepare-action', { checkpoint: c, seat: 0, action })).checkpoint;
    const afterHp = r.roster.entries.find(e => e.pokemon.fields.id === target.pokemon.fields.id).pokemon.fields.hp;
    assert.equal(afterHp, Math.min(maxHp, beforeHp + Math.max(20, Math.ceil(maxHp * 0.1))));
    assert.equal(canonical(r.players[1]), beforePeer);
    assert.equal(canonical(r.roster.entries.filter(e => e.owner === 1).map(e => e.pokemon.fields.hp)), beforePeerHp);
    assert.equal(r.decision.players[0].rewardResolved, true);
  } finally { await h.close(); }
});

test('production reward validation rejects unsupported rewards and foreign targets', async t => {
  const { h, c } = await prep('potion-d');
  try {
    const p = c.decision.players[0];
    const unsupported = p.rewards.find(r => r.type.catalogId === 'TEMP_STAT_BOOSTER');
    if (unsupported) await assert.rejects(h.request('native-validate-preparation', { checkpoint: c, seat: 0,
      action: { kind: 'preparation', operation: 'reward', optionId: unsupported.id,
        pokemonId: null, moveIndex: null, fusionId: null } }), error => error.code === 'PREPARATION_EFFECT_UNAVAILABLE');
    const potion = p.rewards.find(r => r.type.catalogId === 'POTION');
    const peer = c.roster.entries.find(e => e.owner === 1 && e.group === 'party');
    await assert.rejects(h.request('native-validate-preparation', { checkpoint: c, seat: 0,
      action: { kind: 'preparation', operation: 'reward', optionId: potion.id,
        pokemonId: peer.pokemon.fields.id, moveIndex: null, fusionId: null } }),
    error => error.code === 'INVALID_PREPARATION_OWNER' || error.code === 'INVALID_PREPARATION_TARGET');
  } finally { await h.close(); }
});

test('same reward selection after JSON restore is deterministic and does not change peer state', async t => {
  const { h, c } = await prep('potion-d');
  try {
    const p = c.decision.players[0];
    const potion = p.rewards.find(r => r.type.catalogId === 'POTION');
    const target = c.roster.entries.find(e => e.owner === 0 && e.group === 'party'
      && e.pokemon.fields.hp < e.pokemon.fields.stats[0]);
    const action = { kind: 'preparation', operation: 'reward', optionId: potion.id,
      pokemonId: target.pokemon.fields.id, moveIndex: null, fusionId: null };
    const first = (await h.request('native-prepare-action', { checkpoint: JSON.parse(JSON.stringify(c)), seat: 0, action })).checkpoint;
    const second = (await h.request('native-prepare-action', { checkpoint: JSON.parse(JSON.stringify(c)), seat: 0, action })).checkpoint;
    assert.equal(canonical(first), canonical(second));
  } finally { await h.close(); }
});

test('production explicitly rejects inherited Revive reward support without changing checkpoint', async () => {
  const { h, c } = await prep('potion-d');
  try {
    // A codec-valid menu descriptor exercises the support gate independently
    // of this seed's random reward draw. No browser checkpoint is injected.
    const option = c.decision.players[0].rewards[0];
    option.type = { version: 1, catalogId: 'REVIVE', recipe: null, args: [], fields: {
      group: { presence: 'value', value: 'revive' }, restorePoints: { presence: 'value', value: 0 },
      restorePercent: { presence: 'value', value: 50 }, healStatus: { presence: 'value', value: false } },
      id: { presence: 'value', value: 'REVIVE' }, generatorId: { presence: 'absent' }, tier: { presence: 'absent' } };
    const action = { kind: 'preparation', operation: 'reward', optionId: option.id,
      pokemonId: c.roster.entries.find(e => e.owner === 0).pokemon.fields.id,
      moveIndex: null, fusionId: null };
    const before = canonical(c);
    for (const operation of ['native-validate-preparation', 'native-prepare-action']) {
      await assert.rejects(h.request(operation, { checkpoint: c, seat: 0, action }),
        error => error.code === 'PREPARATION_EFFECT_UNAVAILABLE');
      assert.equal(canonical(c), before);
    }
  } finally { await h.close(); }
});
