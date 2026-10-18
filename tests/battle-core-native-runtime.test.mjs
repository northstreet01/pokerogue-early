import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoopRuntime } from '../scripts/build-coop-runtime.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { restoreTurnCommands } from '../src/battle-core/command-state.mjs';

const config = { seed: 'mvp-native-entry', identity: { trainerId: 1, secretId: 2 } };
const selection = { parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } };
let initial, won, preparation, next, transcript;
const phase = c => (c.continuation.phaseQueuePrepend.at(-1) ?? c.continuation.phaseQueue[0])?.phase.type;
const inputs = c => Object.fromEntries([0, 1].map(s => [s, c.decision.options[s].find(a => a.target >= 2) ?? c.decision.options[s][0]]));
const choose = (h, checkpoint, seat, operation) => h.request('native-prepare-action', { checkpoint, seat, action: { kind: 'preparation', operation } });
const semantic = c => {
  const saved = structuredClone(c); delete saved.decision.id;
  for (const key of ['currentPhase', 'standbyPhase']) if (saved.continuation[key]) delete saved.continuation[key].phaseId;
  for (const key of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue'])
    for (const d of saved.continuation[key]) delete d.phaseId;
  return saved;
};
async function host(t, options = {}) {
  const h = await createOriginalRuleHost({ ...config, ...options }); t.after(() => h.close()); return h;
}

before(async () => {
  await buildCoopRuntime();
  const h = await createOriginalRuleHost(config);
  try {
    initial = (await h.request('native-open-to-input', selection)).checkpoint;
    let c = initial; transcript = [];
    for (let turn = 0; turn < 10; turn++) {
      const submitted = await h.request('native-submit', { checkpoint: c, inputs: inputs(c) });
      const r = await h.request('native-run-to-boundary', submitted.checkpoint);
      transcript.push({ before: c, submitted: submitted.checkpoint, after: r.checkpoint, events: r.events });
      c = r.checkpoint;
      if (phase(c) === 'SelectModifierPhase') break;
      assert.equal(c.decision.kind, 'wait-actions');
    }
    assert.equal(phase(c), 'SelectModifierPhase'); won = c;
    preparation = (await h.request('native-preparation', won)).checkpoint;
    c = preparation;
    for (const seat of [0, 1]) for (const operation of ['skip-reward', 'ready']) c = (await choose(h, c, seat, operation)).checkpoint;
    assert.equal(c.decision.reason, 'next-battle');
    next = (await h.request('native-next', c)).checkpoint;
  } finally { await h.close(); }
});

test('full original entry agrees with per-phase worker restart, preserving both field seats', async t => {
  let h = await host(t), r = await h.request('native-start', selection), c = r.checkpoint;
  const events = [...r.events];
  for (let index = 0; c.decision.kind !== 'wait-actions'; index++) {
    assert.ok(index < 30); await h.close(); h = await host(t);
    r = await h.request('native-step', c); c = r.checkpoint; events.push(...r.events);
  }
  assert.deepEqual(semantic(c), semantic(initial));
  for (const seat of [0, 1]) {
    const own = c.roster.entries.find(e => e.owner === seat && e.index === 0);
    assert.equal(c.roster.field[seat], own.pokemon.fields.id);
    assert.equal(c.continuation.phaseQueue[seat].phase.scope, seat);
    assert.ok(c.decision.options[seat].every(a => a.pokemonId === own.pokemon.fields.id));
  }
  assert.deepEqual(events.filter(e => e.kind === 'phase-start').map(e => e.phase),
    ['NewBattlePhase', 'EncounterPhase', 'PostSummonPhase', 'PostSummonPhase', 'SummonPhase',
      'ToggleDoublePositionPhase', 'SummonPhase', 'PostSummonPhase', 'PostSummonPhase', 'TurnInitPhase']);
});

test('original continuous fight/victory/experience/aftermath equals checkpoint recovery at every phase', async t => {
  let h = await host(t); const seen = new Set();
  for (const turn of transcript) {
    let c = turn.submitted; const events = [];
    for (let index = 0; ; index++) {
      assert.ok(index < 150);
      if (c.decision.kind === 'wait-actions' || phase(c) === 'SelectModifierPhase') break;
      const kind = phase(c); seen.add(kind);
      // Kill the actual worker at each model-mutating boundary. Every other
      // phase still roundtrips the complete M2 codec inside native-step.
      if (['MoveEffectPhase', 'DamagePhase', 'VictoryPhase', 'ExpPhase', 'BattleEndPhase', 'EggLapsePhase'].includes(kind)) {
        await h.close(); h = await host(t);
      }
      const r = await h.request('native-step', c); c = r.checkpoint; events.push(...r.events);
    }
    assert.deepEqual(semantic(c), semantic(turn.after));
    assert.deepEqual(events, turn.events);
  }
  for (const kind of ['EnemyCommandPhase', 'MoveEffectPhase', 'DamagePhase', 'FaintPhase', 'VictoryPhase', 'ExpPhase', 'BattleEndPhase', 'EggLapsePhase'])
    assert.ok(seen.has(kind), `ordinary branch must actually execute ${kind}`);
  assert.ok(won.roster.entries.filter(e => e.owner === null).every(e => e.pokemon.fields.hp === 0));
  for (const seat of [0, 1]) {
    const old = initial.roster.entries.find(e => e.owner === seat && e.index === 0).pokemon.fields;
    const now = won.roster.entries.find(e => e.owner === seat && e.index === 0).pokemon.fields;
    assert.ok(now.exp > old.exp, `seat ${seat} keeps original experience`);
  }
});

test('real reward draws survive worker restart and explicit independent skip/ready leads to original next battle', async t => {
  let h = await host(t); let c = (await h.request('native-preparation', won)).checkpoint;
  assert.deepEqual(c, preparation);
  const menus = c.decision.players.map(p => structuredClone(p.rewards));
  for (const seat of [0, 1]) {
    assert.ok(menus[seat].length > 0);
    assert.ok(menus[seat].every(o => !['LURE', 'SUPER_LURE', 'MAX_LURE'].includes(o.type.catalogId)));
    const before = structuredClone(c); await h.close(); h = await host(t);
    c = (await choose(h, c, seat, 'skip-reward')).checkpoint;
    assert.deepEqual(c.sceneRandom, before.sceneRandom);
    assert.deepEqual(c.players, before.players);
    c = (await choose(h, c, seat, 'ready')).checkpoint;
    if (seat === 0) {
      assert.equal(c.decision.kind, 'preparation');
      assert.deepEqual(c.decision.players[1].rewards, menus[1]);
      await assert.rejects(choose(h, c, seat, 'skip-reward'));
    }
  }
  const r = await h.request('native-next', c); assert.deepEqual(r.checkpoint, next);
  assert.equal(next.battle.waveIndex, 2); assert.equal(next.battle.double, true);
  assert.notDeepEqual(next.battle.enemyParty, won.battle.enemyParty);
  assert.deepEqual(r.events.filter(e => e.kind === 'phase-start').map(e => e.phase), ['NewBattlePhase', 'NextEncounterPhase']);
  assert.ok(r.intents.some(i => i.kind === 'seen'));
  assert.ok(r.intents.every(i => !['caught', 'hatch-commit'].includes(i.kind)));
});

for (const branch of ['decline', 'cancel', 'switch']) test(`original next encounter ${branch} reaches genuine second-wave action input after restart`, async t => {
  let h = await host(t), c = structuredClone(next), choices = 0;
  const actors = initial.roster.field.slice(0, 2);
  for (let index = 0; c.decision.kind !== 'wait-actions'; index++) {
    assert.ok(index < 60);
    if (['switch-confirm', 'switch-select'].includes(c.decision.kind)) {
      const seat = c.decision.requiredSeats[0], kind = c.decision.kind;
      const chosen = c.roster.entries.find(e => e.owner === seat && e.index === 1).pokemon.fields.id;
      const action = kind === 'switch-confirm' ? { kind, pokemonId: c.roster.field[seat], accept: branch !== 'decline' }
        : { kind, pokemonId: branch === 'switch' ? chosen : null };
      if (kind === 'switch-select' && branch === 'switch') actors[seat] = chosen;
      const before = structuredClone(c);
      await h.close(); h = await host(t);
      const r = await h.request('native-switch', { checkpoint: c, inputs: { [seat]: action } });
      assert.deepEqual(r, await h.request('native-switch', { checkpoint: before, inputs: { [seat]: action } }));
      assert.deepEqual(r.checkpoint.sceneRandom, before.sceneRandom);
      c = r.checkpoint; choices++;
    } else c = (await h.request('native-step', c)).checkpoint;
  }
  assert.equal(choices, branch === 'decline' ? 2 : 4);
  assert.equal(c.battle.waveIndex, 2); assert.deepEqual(c.roster.field.slice(0, 2), actors);
  for (const seat of [0, 1]) assert.ok(c.decision.options[seat].every(a => a.pokemonId === actors[seat]));
  // These are usable real commands, not a fabricated decision descriptor.
  const r = await h.request('native-submit', { checkpoint: c, inputs: inputs(c) });
  const commands = restoreTurnCommands(r.checkpoint.battle.turnCommands);
  assert.equal(commands[0].command, 0); assert.equal(commands[1].command, 0);
});

test('native input validation is pure, rejects foreign actors, and deterministic retry never consumes committed RNG', async t => {
  const h = await host(t), c = structuredClone(initial), before = structuredClone(c), actions = inputs(c);
  const workerState = await h.request('state');
  for (const seat of [0, 1]) for (let repeat = 0; repeat < 3; repeat++)
    await h.request('native-validate', { checkpoint: c, seat, action: actions[seat] });
  await assert.rejects(h.request('native-validate', { checkpoint: c, seat: 0, action: actions[1] }));
  await assert.rejects(h.request('native-submit', { checkpoint: c, inputs: { 0: actions[0] } }));
  const a = await h.request('native-submit', { checkpoint: c, inputs: actions });
  assert.deepEqual(a, await h.request('native-submit', { checkpoint: before, inputs: actions }));
  assert.deepEqual(c, before); assert.deepEqual(await h.request('state'), workerState);
  assert.equal(phase(a.checkpoint), 'EnemyCommandPhase');
});

test('two native room workers isolate queues, rule RNG, parties and reward draws', async t => {
  const a = await host(t), b = await host(t), other = await host(t, { seed: 'other-native-room' });
  const c = (await b.request('native-open-to-input', selection)).checkpoint;
  assert.deepEqual(c, initial);
  const different = (await other.request('native-open-to-input', selection)).checkpoint;
  assert.notDeepEqual(different.sceneRandom, c.sceneRandom);
  await a.request('native-run-to-boundary', transcript[0].submitted);
  assert.deepEqual(await b.request('native-submit', { checkpoint: c, inputs: inputs(c) }),
    await a.request('native-submit', { checkpoint: c, inputs: inputs(c) }));
  assert.deepEqual((await b.request('native-preparation', won)).checkpoint, preparation);
});

test('v6 native entry keeps absent eggs and refuses to invent personal inventories at lapse', async t => {
  const h = await host(t);
  const c = (await h.request('native-open-to-input', { parties: selection.parties })).checkpoint;
  assert.equal(c.version, 6); assert.equal(Object.hasOwn(c, 'eggState'), false);
  // The existing original EggLapse must not be replayed against fabricated []:
  // use the real pre-lapse saved phase from the winning turn.
  let p = transcript.at(-1).submitted;
  while (phase(p) !== 'EggLapsePhase') p = (await h.request('native-step', p)).checkpoint;
  const candidate = structuredClone(p); delete candidate.eggState; candidate.version = 6;
  await assert.rejects(h.request('native-step', candidate), { code: 'EGG_INVENTORY_REQUIRED' });
  assert.equal(Object.hasOwn(candidate, 'eggState'), false);
});

test('original owned egg lapse advances both holders once and retries the same candidate without consumption', async t => {
  const h = await host(t); let c = transcript.at(-1).submitted;
  while (phase(c) !== 'EggLapsePhase') c = (await h.request('native-step', c)).checkpoint;
  c.eggState = { players: [[{ id: 10000, gachaType: 0, hatchWaves: 3, timestamp: 1000 }],
    [{ id: 10100, gachaType: 1, hatchWaves: 7, timestamp: 1001 }]] };
  const before = structuredClone(c), a = await h.request('native-step', c);
  assert.deepEqual(a, await h.request('native-step', before)); assert.deepEqual(c, before);
  assert.deepEqual(a.checkpoint.eggState.players.map(row => row[0].hatchWaves), [2, 6]);
  assert.deepEqual(a.checkpoint.eggState.players.map(row => row[0].id), [10000, 10100]);
  assert.equal(a.checkpoint.version, 7);
});

test('unknown queued production phase fails closed and encounter IO remains an explicit pending intent', async t => {
  const h = await host(t), c = structuredClone(won), before = structuredClone(c);
  await assert.rejects(h.request('native-step', c), { code: 'UNSUPPORTED_RULE_PHASE' });
  assert.deepEqual(c, before);
  const r = await h.request('native-start', selection);
  assert.equal(r.intents.filter(i => i.kind === 'encounter-persistence-pending').length, 1);
  assert.ok(!r.intents.some(i => ['save-system', 'save-session', 'caught', 'hatch-commit'].includes(i.kind)));
});

test('real Worker Growl masks are display-only; original StatChange survives phase-by-phase restart', async t => {
  const h = await host(t);
  const c = (await h.request('native-open-to-input', selection)).checkpoint;
  const own = c.roster.entries.find(e => e.pokemon.fields.id === c.roster.field[0]).pokemon.fields;
  const cursor = own.moveset.findIndex(m => m.fields.moveId === 45); // Original Moves.GROWL.
  assert.ok(cursor >= 0, 'fixture must really have Growl');
  const actions = inputs(c);
  actions[0] = c.decision.options[0].find(a => a.cursor === cursor);
  assert.ok(actions[0]);
  const before = structuredClone(c);
  const submitted = await h.request('native-submit', { checkpoint: c, inputs: actions });
  const continuous = await h.request('native-run-to-boundary', submitted.checkpoint);
  assert.deepEqual(c, before);
  assert.ok(continuous.events.some(e => e.kind === 'stat-change-display'));
  assert.equal(continuous.checkpoint.decision.kind, 'wait-actions');
  let recovered = submitted.checkpoint, changes = 0, restarted;
  const events = [];
  for (let n = 0; recovered.decision.kind !== 'wait-actions'; n++) {
    assert.ok(n < 150);
    if (phase(recovered) === 'StatChangePhase') {
      changes++;
      await restarted?.close(); restarted = await host(t);
    }
    const result = await (restarted ?? h).request('native-step', JSON.parse(JSON.stringify(recovered)));
    recovered = result.checkpoint; events.push(...result.events);
  }
  assert.ok(changes > 0);
  assert.deepEqual(semantic(recovered), semantic(continuous.checkpoint));
  assert.deepEqual(events, continuous.events);
});
