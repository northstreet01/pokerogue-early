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

test('native capture converts the wild individual into the catcher reserve and is durably clear', async () => {
  const { h, c } = await open();
  try {
    const targetId = c.decision.options[0].find(o => o.kind === 'ball').targetId;
    // The public fixture only starts with regular balls; a synthetic master ball
    // makes the original capture branch deterministic. This is a test initial
    // state, not a production shortcut.
    c.players[0].pokeballCounts[4] = 1;
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
    const reserve = run.roster.entries.filter(e => e.owner === 0 && e.group === 'reserve');
    assert.equal(reserve.length, 1);
    assert.equal(reserve[0].pokemon.fields.species, c.roster.entries.find(e => e.pokemon.fields.id === targetId).pokemon.fields.species);
    assert.equal(reserve[0].pokemon.fields.hp, c.roster.entries.find(e => e.pokemon.fields.id === targetId).pokemon.fields.hp);
    assert.equal(run.players[0].pokeballCounts[4], 0);
    assert.equal(JSON.stringify(run.players[1].pokeballCounts), peerBalls);
    const shared = await h.request('native-project', { checkpoint: run, seat: 1 });
    assert.equal(shared.shared.field.includes(targetId), false, 'captured instance left the shared field');
    assert.ok(['preparation', 'wait-actions', 'continuing', 'ended'].includes(run.decision.kind));
    const projected = await h.request('native-project', { checkpoint: run, seat: 0 });
    assert.equal(projected.personal.reserve.length, 1);
    assert.equal(projected.personal.reserve[0].id, reserve[0].pokemon.fields.id);
    assert.equal(JSON.stringify(projected.personal.reserve[0].pokemon), JSON.stringify(reserve[0].pokemon));
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

test('a capturable JSON-restored checkpoint produces the same reserve and resource result', async () => {
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
