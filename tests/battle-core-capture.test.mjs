import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';

const parties = [[1, 4, 7], [906, 909, 912]];
const eggState = { players: [[], []] };
const front = c => (c.continuation.phaseQueuePrepend.at(-1) ?? c.continuation.phaseQueue[0])?.phase?.type;

async function open(seed = 'vs02b09-capture') {
  const h = await createOriginalRuleHost({ seed, identity: { trainerId: 1, secretId: 2 } });
  let c = (await h.request('native-open-to-input', { parties, eggState })).checkpoint;
  for (let turn = 0; turn < 10; turn++) {
    if (c.decision.kind === 'wait-actions' && c.decision.options[0].some(o => o.kind === 'ball')) break;
    if (c.decision.kind !== 'wait-actions') break;
    const o = c.decision.options;
    c = (await h.request('native-submit', { checkpoint: c, inputs: {
      0: o[0].find(x => x.kind === 'fight' && (x.target === null || x.target >= 2)),
      1: o[1].find(x => x.kind === 'fight' && (x.target === null || x.target >= 2)),
    } })).checkpoint;
    c = (await h.request('native-run-to-boundary', c)).checkpoint;
  }
  return { h, c };
}

test('native capture joins the catcher party below six and is durably clear', async () => {
  const { h, c } = await open();
  try {
    const targetId = c.decision.options[0].find(o => o.kind === 'ball').targetId;
    // The public fixture only starts with regular balls; a synthetic master ball
    // makes the original capture branch deterministic. This is a test initial
    // state, not a production shortcut.
    c.players[0].pokeballCounts[4] = 1;
    c.roster.retiredIds.push(4294967295); // Allocation must stay uint32, even after retiring its maximum ID.
    const action = { kind: 'ball', pokeballType: 4, targetId };
    c.decision.options[0].push(action);
    const fight = c.decision.options[1].find(o => o.kind === 'fight' && (o.target === null || o.target >= 2));
    const peerBalls = JSON.stringify(c.players[1].pokeballCounts);
    await h.request('native-validate', { checkpoint: c, seat: 0, action });
    const sub = (await h.request('native-submit', { checkpoint: c, inputs: { 0: action, 1: fight } })).checkpoint;
    let run = sub, guard = 0;
    while (run.decision.kind === 'continuing' && guard++ < 10) {
      if (front(run) === 'SelectModifierPhase') {
        run = (await h.request('native-preparation', run)).checkpoint;
        break;
      }
      run = (await h.request('native-run-to-boundary', run)).checkpoint;
    }
    const reserve = run.roster.entries.filter(e => e.owner === 0 && e.group === 'party' && e.pokemon.fields.id === 0);
    assert.equal(run.roster.entries.filter(e => e.owner === 0 && e.group === 'party').length,4);
    assert.equal(run.roster.entries.filter(e => e.group === 'reserve').length,0);
    assert.equal(reserve.length, 1);
    assert.equal(reserve[0].pokemon.fields.species, c.roster.entries.find(e => e.pokemon.fields.id === targetId).pokemon.fields.species);
    assert.equal(reserve[0].pokemon.fields.hp, c.roster.entries.find(e => e.pokemon.fields.id === targetId).pokemon.fields.hp);
    const source = c.roster.entries.find(e => e.pokemon.fields.id === targetId).pokemon.fields;
    for (const key of ['level', 'status', 'moveset', 'ivs', 'nature', 'gender', 'abilityIndex', 'formIndex', 'shiny'])
      assert.deepEqual(reserve[0].pokemon.fields[key], source[key], `original conversion preserves ${key}`);
    assert.equal(run.players[0].pokeballCounts[4], 0);
    assert.equal(JSON.stringify(run.players[1].pokeballCounts), peerBalls);
    const shared = await h.request('native-project', { checkpoint: run, seat: 1 });
    assert.equal(shared.shared.field.includes(targetId), false, 'captured instance left the shared field');
    assert.ok(['preparation', 'wait-actions', 'continuing', 'ended'].includes(run.decision.kind));
    const projected = await h.request('native-project', { checkpoint: run, seat: 0 });
    assert.equal(projected.personal.reserve.length, 0);
    const projectedCapture=projected.personal.party.find(e=>e.id===reserve[0].pokemon.fields.id);
    assert.ok(projectedCapture);
    assert.equal(JSON.stringify(projectedCapture.pokemon), JSON.stringify(reserve[0].pokemon));
  } finally { await h.close(); }
});

test('capture validation rejects foreign, absent and wrong-ball targets without mutating the checkpoint', async () => {
  const { h, c } = await open();
  try {
    const before = JSON.stringify(c);
    const targetId = c.decision.options[0].find(o => o.kind === 'ball').targetId;
    await assert.rejects(h.request('native-validate', { checkpoint: c, seat: 0,
      action: { kind: 'ball', pokeballType: 0, targetId: 999999999 } }), error => error.code === 'INVALID_ACTION');
    c.players[0].pokeballCounts[0] = 0;
    await assert.rejects(h.request('native-validate', { checkpoint: c, seat: 0,
      action: { kind: 'ball', pokeballType: 0, targetId } }), error => error.code === 'NO_POKEBALL');
    c.players[0].pokeballCounts[0] = 5;
    await assert.rejects(h.request('native-validate', { checkpoint: c, seat: 0,
      action: { kind: 'ball', pokeballType: 0, targetId, extra: true } }), error => error.code === 'INVALID_ACTION');
    assert.equal(JSON.stringify(c), before);
  } finally { await h.close(); }
});

test('JSON restoration preserves submitted capture commands before rule execution', async () => {
  const { h, c } = await open();
  try {
    const targetId = c.decision.options[0].find(o => o.kind === 'ball').targetId;
    c.players[0].pokeballCounts[4] = 1;
    c.decision.options[0].push({ kind: 'ball', pokeballType: 4, targetId });
    const action = c.decision.options[0].find(o => o.kind === 'ball' && o.pokeballType === 4);
    const fight = c.decision.options[1].find(o => o.kind === 'fight' && (o.target === null || o.target >= 2));
    const first = (await h.request('native-submit', { checkpoint: JSON.parse(JSON.stringify(c)), inputs: { 0: action, 1: fight } })).checkpoint;
    const second = (await h.request('native-submit', { checkpoint: JSON.parse(JSON.stringify(c)), inputs: { 0: action, 1: fight } })).checkpoint;
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  } finally { await h.close(); }
});

const offensive = (c, seat) => c.decision.options[seat].find(o => o.kind === 'fight' && (o.target === null || o.target >= 2));
// These fixed fixtures allocate stable ID 0 to the first converted individual.
const captures = c => c.roster.entries.filter(e => e.owner !== null && e.group === 'party' && e.pokemon.fields.id === 0);
const reserves = c => c.roster.entries.filter(e => e.group === 'reserve');
const pp = (c, seat) => c.roster.entries.find(e => e.pokemon.fields.id === c.roster.field[seat]).pokemon.fields.moveset;

test('ordinary failed seat-1 capture preserves the ally FIGHT and spends only its own ball', async () => {
  const { h, c } = await open();
  try {
    const ball = c.decision.options[1].find(o => o.kind === 'ball' && o.pokeballType === 0);
    const action = offensive(c, 0), before = structuredClone(pp(c, 0));
    const submitted = (await h.request('native-submit', { checkpoint: c, inputs: { 0: action, 1: ball } })).checkpoint;
    assert.notEqual(submitted.battle.turnCommands[0].skip, true);
    const result = await h.request('native-run-to-boundary', submitted);
    const after = result.checkpoint;
    assert.equal(after.decision.kind, 'wait-actions');
    assert.equal(reserves(after).length, 0);
    assert.equal(after.players[1].pokeballCounts[0], c.players[1].pokeballCounts[0] - 1);
    assert.deepEqual(after.players[0].pokeballCounts, c.players[0].pokeballCounts);
    assert.equal(pp(after, 0)[action.cursor].fields.ppUsed, before[action.cursor].fields.ppUsed + 1);
    assert.equal(result.intents.some(i => i.kind === 'capture-pending'), false);
  } finally { await h.close(); }
});

test('ordinary successful seat-1 capture retains original score and linked durable dex/capture facts', async () => {
  const { h, c } = await open('capture-review-5');
  try {
    const ball = c.decision.options[1].find(o => o.kind === 'ball' && o.pokeballType === 0);
    const submitted = (await h.request('native-submit', { checkpoint: c, inputs: { 0: offensive(c, 0), 1: ball } })).checkpoint;
    const result = await h.request('native-run-to-boundary', submitted);
    const [caught] = captures(result.checkpoint);
    assert.equal(caught.owner, 1);
    assert.equal(captures(result.checkpoint).length, 1);
    assert.equal(reserves(result.checkpoint).length, 0);
    assert.ok(result.checkpoint.scene.score > c.scene.score, 'original capture score reaches shared BattleEnd');
    const pending = result.intents.find(i => i.kind === 'capture-pending');
    assert.equal(pending.pokemonId, caught.pokemon.fields.id);
    assert.equal(pending.sourcePokemonId, ball.targetId);
    assert.match(pending.dexAttr, /^\d+$/);
    assert.deepEqual(pending.pokemon, caught.pokemon);
    assert.equal(result.intents.find(i => i.kind === 'dex-ivs').pokemonId, pending.pokemonId);
    assert.deepEqual(result.checkpoint.players[0].pokeballCounts, c.players[0].pokeballCounts);
    assert.equal(result.checkpoint.players[1].pokeballCounts[0], c.players[1].pokeballCounts[0] - 1);
  } finally { await h.close(); }
});

test('two same-instance captures persist separate phase owners; a departed target costs no second ball', async () => {
  const { h, c } = await open();
  try {
    const targetId = c.decision.options[0].find(o => o.kind === 'ball').targetId;
    const inputs = {};
    for (const seat of [0, 1]) {
      c.players[seat].pokeballCounts[4] = 1; // Explicit synthetic master-ball initial inventory.
      inputs[seat] = { kind: 'ball', pokeballType: 4, targetId };
      c.decision.options[seat].push(inputs[seat]);
    }
    const sub = (await h.request('native-submit', { checkpoint: c, inputs })).checkpoint;
    const expected = (await h.request('native-run-to-boundary', sub)).checkpoint;
    assert.equal(captures(expected).length, 1);
    assert.equal(reserves(expected).length, 0);
    const owner = captures(expected)[0].owner;
    assert.equal(expected.players[owner].pokeballCounts[4], 0);
    assert.equal(expected.players[1 - owner].pokeballCounts[4], 1);
    let restored = sub;
    for (let guard = 0; guard < 90 && restored.decision.kind === 'continuing' && front(restored) !== 'SelectModifierPhase'; guard++) {
      const fresh = await createOriginalRuleHost({ seed: c.scene.seed, identity: { trainerId: 1, secretId: 2 } });
      try { restored = (await fresh.request('native-step', JSON.parse(JSON.stringify(restored)))).checkpoint; }
      finally { await fresh.close(); }
    }
    const semantic = c => {
      const copy = structuredClone(c); delete copy.decision.id;
      for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue'])
        for (const d of copy.continuation[key]) delete d.phaseId;
      return copy;
    };
    assert.deepEqual(semantic(restored), semantic(expected));
  } finally { await h.close(); }
});

test('a queued capture cannot retarget a replacement instance or spend a ball after its bound target left', async () => {
  const { h, c } = await open();
  try {
    const ball = c.decision.options[0].find(o => o.kind === 'ball');
    let state = (await h.request('native-submit', { checkpoint: c, inputs: { 0: ball, 1: offensive(c, 1) } })).checkpoint;
    for (let guard = 0; guard < 8 && front(state) !== 'AttemptCapturePhase'; guard++)
      state = (await h.request('native-step', state)).checkpoint;
    assert.equal(front(state), 'AttemptCapturePhase');
    // Synthetic recovery boundary: this phase's bound instance left and its
    // former field position now contains another ID. Never a browser shortcut.
    const phase = state.continuation.phaseQueuePrepend.at(-1) ?? state.continuation.phaseQueue[0];
    phase.phase.fields.coopTargetId.value = 4294967295;
    const before = structuredClone(state);
    const result = await h.request('native-step', state);
    assert.ok(result.events.some(e => e.kind === 'capture-cancelled' && e.reason === 'target-left'));
    assert.deepEqual(result.checkpoint.players, before.players);
    assert.deepEqual(result.checkpoint.roster, before.roster);
    assert.deepEqual(result.checkpoint.battle.random, before.battle.random);
    assert.deepEqual(result.checkpoint.sceneRandom, before.sceneRandom);
    assert.equal(reserves(result.checkpoint).length, 0);
  } finally { await h.close(); }
});
