import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { canonical } from '../src/battle-core/coop-contract.mjs';
import { createRequire } from 'node:module';

const parties = [[1, 4, 7], [906, 909, 912]];
let api;
before(async () => { await buildCoopRuntime(); api = createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs'); api.describeOriginalCatalogs(); });
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

test('real Worker can buy Revive then Potion for the same fainted Pokemon', async () => {
  const { h, c } = await prep('potion-d');
  try {
    c.players[0].money = 100000;
    const target = c.roster.entries.find(entry => entry.owner === 0 && entry.group === 'party');
    const pokemon = api.restorePokemonState(target.pokemon);
    pokemon.hp = 0;
    pokemon.status = new api.Status(api.StatusEffect.FAINT);
    target.pokemon = api.capturePokemonState(pokemon);
    // Model the original Faint boundary too: a manually fainted front member
    // must leave the field before a preparation item can revive the bench.
    c.roster.field[0] = null; c.battle.turnCommands[0] = null;
    let checkpoint = c;
    for (const catalogId of ['REVIVE', 'POTION']) {
      const option = checkpoint.decision.players[0].shop.find(option => option.type.catalogId === catalogId);
      assert.ok(option, catalogId);
      const action = { kind: 'preparation', operation: 'buy', optionId: option.id,
        pokemonId: pokemon.id, moveIndex: null, fusionId: null };
      await h.request('native-validate-preparation', { checkpoint, seat: 0, action });
      checkpoint = (await h.request('native-prepare-action', { checkpoint, seat: 0, action })).checkpoint;
      const after = api.restorePokemonState(checkpoint.roster.entries.find(entry => entry.pokemon.fields.id === pokemon.id).pokemon);
      assert.ok(after.hp > 0);
      assert.equal(after.status, undefined);
    }
  } finally { await h.close(); }
});

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
    const unsupported = structuredClone(p.rewards[0]);
    unsupported.type = api.captureModifierTypeState(api.modifierTypes.IV_SCANNER().withIdFromFunc(api.modifierTypes.IV_SCANNER));
    const unsupportedCheckpoint = structuredClone(c); unsupportedCheckpoint.decision.players[0].rewards[0] = unsupported;
    await assert.rejects(h.request('native-validate-preparation', { checkpoint: unsupportedCheckpoint, seat: 0,
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

test('production Revive uses the original fainted target filter and rejects a living target without mutation', async () => {
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
        error => error.code === 'INVALID_PREPARATION_TARGET');
      assert.equal(canonical(c), before);
    }
  } finally { await h.close(); }
});

for (const seat of [0, 1]) for (const id of ['POTION', 'FULL_RESTORE', 'REVIVE', 'MAX_REVIVE', 'FULL_HEAL',
  'ETHER', 'MAX_ETHER', 'ELIXIR', 'MAX_ELIXIR', 'PP_UP', 'PP_MAX', 'POKEBALL', 'NUGGET'])
test(`native original consumable ${id} seat ${seat} changes only the owner and survives JSON replay`, async () => {
  const { h, c } = await prep('potion-d');
  try {
    // Explicit synthetic original factory menu/condition: not a natural browser draw.
    const target = c.roster.entries.find(entry => entry.owner === seat && entry.group === 'party');
    const pokemon = api.restorePokemonState(target.pokemon);
    pokemon.hp = id.includes('REVIVE') ? 0 : 1;
    pokemon.status = new api.Status(id.includes('REVIVE') ? api.StatusEffect.FAINT : api.StatusEffect.POISON);
    pokemon.getMoveset().forEach(move => { move.ppUsed = 3; move.ppUp = 0; });
    target.pokemon = api.capturePokemonState(pokemon);
    if(id.includes('REVIVE')){c.roster.field[seat]=null;c.battle.turnCommands[seat]=null;}
    const type = api.modifierTypes[id](); type.id = id;
    const option = c.decision.players[seat].rewards[0]; option.type = api.captureModifierTypeState(type);
    const noTarget = ['POKEBALL', 'NUGGET'].includes(id), moveTarget = ['ETHER', 'MAX_ETHER', 'PP_UP', 'PP_MAX'].includes(id);
    const action = { kind: 'preparation', operation: 'reward', optionId: option.id,
      pokemonId: noTarget ? null : pokemon.id, moveIndex: moveTarget ? 0 : null, fusionId: null };
    const before = canonical(c), peer = canonical(c.players[1 - seat]);
    if (moveTarget) await assert.rejects(h.request('native-validate-preparation', { checkpoint: c, seat,
      action: { ...action, moveIndex: 3 } }), /INVALID_PREPARATION_MOVE/);
    await h.request('native-validate-preparation', { checkpoint: c, seat, action });
    assert.equal(canonical(c), before);
    const result = await h.request('native-prepare-action', { checkpoint: c, seat, action });
    const restored = await h.request('native-prepare-action', { checkpoint: JSON.parse(JSON.stringify(c)), seat, action });
    assert.equal(canonical(result), canonical(restored));
    const next = result.checkpoint, after = api.restorePokemonState(next.roster.entries.find(entry => entry.pokemon.fields.id === pokemon.id).pokemon);
    assert.equal(canonical(next.players[1 - seat]), peer);
    assert.equal(next.sceneRandom, c.sceneRandom);
    assert.equal(next.decision.players[seat].rewardResolved, true);
    if (id === 'POKEBALL') assert.equal(next.players[seat].pokeballCounts[0], c.players[seat].pokeballCounts[0] + 5);
    else if (id === 'NUGGET') {
      assert.ok(next.players[seat].money > c.players[seat].money);
      assert.ok(result.intents.some(intent => intent.kind === 'achievement-check' && intent.owner === seat));
    } else if (id.includes('PP_')) assert.ok(after.getMoveset()[0].ppUp > 0);
    else if (id.includes('ETHER') || id.includes('ELIXIR')) assert.equal(after.getMoveset()[0].ppUsed, 0);
    else if (id === 'FULL_HEAL') assert.equal(after.status, undefined);
    else { assert.ok(after.hp > pokemon.hp); if (id === 'FULL_RESTORE' || id.includes('REVIVE')) assert.equal(after.status, undefined); }
  } finally { await h.close(); }
});

test('native buys repeatedly at original prices, preserves free reward and rejects forged shop/targets/insufficient funds', async () => {
  const { h, c } = await prep('potion-d');
  try {
    c.players[0].money = 3000;
    const own = c.roster.entries.filter(entry => entry.owner === 0 && entry.group === 'party');
    for (const entry of own) entry.pokemon.fields.hp = 1;
    const target = own[0];
    const option = c.decision.players[0].shop.find(option => option.type.catalogId === 'POTION'); assert.ok(option);
    const action = { kind: 'preparation', operation: 'buy', optionId: option.id,
      pokemonId: target.pokemon.fields.id, moveIndex: null, fusionId: null };
    const first = (await h.request('native-prepare-action', { checkpoint: c, seat: 0, action })).checkpoint;
    assert.equal(first.players[0].money, c.players[0].money - option.cost);
    assert.equal(first.decision.players[0].rewardResolved, false);
    assert.equal(first.decision.players[0].ready, false);
    const secondAction = { ...action, pokemonId: own[1].pokemon.fields.id };
    const second = (await h.request('native-prepare-action', { checkpoint: first, seat: 0, action: secondAction })).checkpoint;
    assert.equal(second.players[0].money, c.players[0].money - 2 * option.cost);
    assert.ok(second.roster.entries.find(entry => entry.pokemon.fields.id === secondAction.pokemonId).pokemon.fields.hp > 1);
    assert.equal(second.decision.players[0].rewardResolved, false);
    const corrupt = structuredClone(c); corrupt.decision.players[0].shop.find(value => value.id === option.id).cost--;
    await assert.rejects(h.request('native-validate-preparation', { checkpoint: corrupt, seat: 0, action }), /STALE_PREPARATION_SHOP/);
    const poor = structuredClone(c); poor.players[0].money = 0;
    await assert.rejects(h.request('native-prepare-action', { checkpoint: poor, seat: 0, action }), /INVALID_PREPARATION_OPTION/);
    const peer = c.roster.entries.find(entry => entry.owner === 1 && entry.group === 'party');
    await assert.rejects(h.request('native-validate-preparation', { checkpoint: c, seat: 0,
      action: { ...action, pokemonId: peer.pokemon.fields.id } }), /INVALID_PREPARATION_OWNER/);
    // A completed free reward/ready does not disable the original personal shop.
    const ready = structuredClone(c); ready.decision.players[0].rewardResolved = true; ready.decision.players[0].ready = true;
    const after = (await h.request('native-prepare-action', { checkpoint: ready, seat: 0, action })).checkpoint;
    assert.equal(after.decision.players[0].rewardResolved, true); assert.equal(after.decision.players[0].ready, false);
  } finally { await h.close(); }
});

test('native original multirow shop maps indices on both rows to the original PP callbacks', async () => {
  const { h, c: initial } = await prep('potion-d');
  try {
    // Explicit synthetic later-wave original menu, not a natural reached wave.
    for (const catalogId of ['ELIXIR', 'MAX_ETHER']) {
      const c = structuredClone(initial); c.battle.waveIndex = 61; c.players[0].money = 100000;
      const runtime = api.createOriginalRuntime('potion-d', { trainerId: 1, secretId: 2 });
      runtime.scene.currentBattle = { waveIndex: 61 };
      c.decision.players[0].shop = api.getPlayerShopModifierTypeOptionsForWave(61, runtime.scene.getWaveMoneyAmount(1)).map((option, index) => {
        const id = Object.keys(api.modifierTypes).find(id => {
          const type = api.modifierTypes[id](); return type.constructor === option.type.constructor && type.name === option.type.name;
        });
        option.type.id = id;
        return { id: `shop-${index}`, cost: option.cost, type: api.captureModifierTypeState(option.type) };
      });
      assert.ok(c.decision.players[0].shop.length > 6);
      const option = c.decision.players[0].shop.find(option => option.type.catalogId === catalogId); assert.ok(option);
      const target = c.roster.entries.find(entry => entry.owner === 0), pokemon = api.restorePokemonState(target.pokemon);
      pokemon.getMoveset().forEach(move => { move.ppUsed = 2; }); target.pokemon = api.capturePokemonState(pokemon);
      const action = { kind: 'preparation', operation: 'buy', optionId: option.id, pokemonId: pokemon.id,
        moveIndex: catalogId === 'MAX_ETHER' ? 0 : null, fusionId: null };
      const next = (await h.request('native-prepare-action', { checkpoint: c, seat: 0, action })).checkpoint;
      assert.equal(next.players[0].money, c.players[0].money - option.cost);
      const after = api.restorePokemonState(next.roster.entries.find(entry => entry.pokemon.fields.id === pokemon.id).pokemon);
      assert.equal(after.getMoveset()[0].ppUsed, 0);
      assert.deepEqual(next.players[1], c.players[1]);
    }
  } finally { await h.close(); }
});

test('native consecutive original rerolls preserve count/price/RNG and JSON restoration without starting the old menu again', async () => {
  const { h, c: initial } = await prep('potion-d'); let c = initial;
  try {
    c.players[0].money = 10000;
    for (let n = 0; n < 3; n++) {
      const action = { kind: 'preparation', operation: 'reroll' }, before = canonical(c);
      await h.request('native-validate-preparation', { checkpoint: c, seat: 0, action }); assert.equal(canonical(c), before);
      const result = await h.request('native-prepare-action', { checkpoint: c, seat: 0, action });
      const repeat = await h.request('native-prepare-action', { checkpoint: structuredClone(c), seat: 0, action });
      assert.equal(canonical(result), canonical(repeat));
      assert.equal(result.checkpoint.players[0].money, c.players[0].money - c.decision.players[0].rerollCost);
      assert.equal(result.checkpoint.decision.players[0].rerollCount, n + 1);
      assert.ok(result.checkpoint.decision.players[0].rewards.every(option => !['LURE','SUPER_LURE','MAX_LURE'].includes(option.type.catalogId)));
      assert.equal(canonical(result.checkpoint.players[1]), canonical(c.players[1]));
      c = result.checkpoint;
    }
  } finally { await h.close(); }
});

test('original updateInfo rejection cannot be swallowed by allSettled or publish a consumed purchase', async () => {
  const { h, c } = await prep('potion-d');
  const prototype = api.PlayerPokemon.prototype, descriptor = Object.getOwnPropertyDescriptor(prototype, 'updateInfo');
  try {
    c.players[0].money = 3000;
    const target = c.roster.entries.find(entry => entry.owner === 0); target.pokemon.fields.hp = 1;
    const option = c.decision.players[0].shop.find(option => option.type.catalogId === 'POTION');
    const action = { kind: 'preparation', operation: 'buy', optionId: option.id, pokemonId: target.pokemon.fields.id,
      moveIndex: null, fusionId: null }, before = canonical(c);
    Object.defineProperty(prototype, 'updateInfo', { configurable: true, writable: true, value: () => Promise.reject(Error('TEST_NATIVE_UPDATE_FAILED')) });
    const runtime = api.createOriginalRuntime('potion-d', { trainerId: 1, secretId: 2 });
    await assert.rejects(api.executeRuntimeOperation(runtime, 'native-prepare-action', { checkpoint: c, seat: 0, action }), /TEST_NATIVE_UPDATE_FAILED/);
    assert.equal(canonical(c), before);
  } finally {
    if (descriptor) Object.defineProperty(prototype, 'updateInfo', descriptor); else delete prototype.updateInfo;
    await h.close();
  }
});
