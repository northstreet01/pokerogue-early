import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { species } from '../src/coop/catalog.mjs';
import { createRun, createMon, canonical, stateHash, clone, resolveRound, prepare, replaceFainted, activeMon, nextWave } from '../src/coop/engine.mjs';

export const team = [1, 4, 7].map(species => ({ species, nature: 0, ivs: [10,10,10,10,10,10], dexAttr: '149' }));
const run = () => createRun('test', 123, [team, team]);
const attack = target => ({ kind: 'move', move: 33, target });
test('canonical hash matches independent SHA256 and survives transport reconstruction', () => {
  const state = run();
  assert.equal(stateHash(state), createHash('sha256').update(canonical(state)).digest('hex'));
  assert.equal(stateHash(state), stateHash(JSON.parse(JSON.stringify(state))));
  const changed = clone(state); changed.players[1].money++; assert.notEqual(stateHash(state), stateHash(changed));
});
test('round simulation is independent of action object insertion order and does not mutate input', () => {
  const state = run(), before = stateHash(state);
  const a = resolveRound(state, { 0: attack(0), 1: attack(1) });
  const b = resolveRound(state, Object.fromEntries([['1', attack(1)], ['0', attack(0)]]));
  assert.equal(stateHash(a), stateHash(b)); assert.equal(stateHash(state), before);
});
test('all supported species have usable initial move data; new adventures reset run properties', () => {
  for (const row of Object.values(species)) assert.ok(createMon('mon', { ...team[0], species: row.id }).moves.length);
  const a = run(); a.players[0].money = 99; a.players[0].party[0].level = 10;
  const b = run(); assert.equal(b.players[0].money, 1000); assert.equal(b.players[0].party[0].level, 5);
});
test('captured enemy leaves its slot; later attacks consume neither unused PP nor another target', () => {
  const state = run(); state.enemies[0].catchRate = 255;
  state.enemies[0] = createMon('easy', { ...team[0], species: 10 }); state.enemies[0].hp = 1; state.enemies[0].stats[0] = 100000;
  const oldPP = activeMon(state.players[1]).moves.find(m => m.id === 33).pp;
  const next = resolveRound(state, { 0: { kind: 'capture', target: 'easy' }, 1: attack(0) });
  assert.equal(next.enemies[0].hp, 0); assert.equal(next.players[0].reserve.length, 1);
  assert.equal(activeMon(next.players[1])?.moves.find(m => m.id === 33).pp ?? next.players[1].party[0].moves.find(m => m.id === 33).pp, oldPP);
  assert.ok(next.events.some(text => text.includes('未消耗 PP')));
});
test('two captures of same enemy award once and preserve the second ball', () => {
  const state = run(); state.enemies[0] = createMon('easy', { ...team[0], species: 10 }); state.enemies[0].hp = 1; state.enemies[0].stats[0] = 100000;
  const next = resolveRound(state, { 0: { kind: 'capture', target: 'easy' }, 1: { kind: 'capture', target: 'easy' } });
  assert.equal(next.players.reduce((sum,p) => sum + p.reserve.length, 0), 1);
  assert.equal(next.players.reduce((sum,p) => sum + p.bag.ball, 0), 9);
  assert.equal(next.grants.filter(grant => grant.kind === 'caught').length, 1);
});
test('enemy attack hits replacement occupying the targeted player slot', () => {
  const state = run(); const mon = state.players[0].party[1]; mon.hp = 100; mon.stats[0] = 100;
  state.players[1].party.forEach(mon => { mon.hp = 0; }); state.players[1].active = null;
  state.enemies.forEach(mon => { mon.moves = [{ id: 33, pp: 35 }]; });
  const next = resolveRound(state, { 0: { kind: 'switch', mon: mon.id } });
  assert.equal(next.players[0].party[0].hp, state.players[0].party[0].hp);
  assert.ok(next.players[0].party[1].hp < 100);
});
test('partial team wipe continues and winning restores the knocked out player', () => {
  const state = run(); state.players[1].party.forEach(mon => { mon.hp = 0; }); state.players[1].active = null;
  state.enemies[0].hp = 1; state.enemies[1].hp = 0; state.players[0].party[0].stats[5] = 1000;
  const next = resolveRound(state, { 0: attack(0) });
  assert.equal(next.phase, 'prep'); assert.equal(next.players[1].party[0].hp, Math.ceil(next.players[1].party[0].stats[0] / 2));
});
test('faint replacement is mandatory and respects ownership', () => {
  const state = run(); state.phase = 'replace'; state.players[0].party[0].hp = 0;
  assert.throws(() => replaceFainted(state, { 0: state.players[1].party[1].id }));
  assert.equal(replaceFainted(state, { 0: state.players[0].party[1].id }).phase, 'input');
});
test('personal shop/reward/reserve operations are isolated, ready requires independent reward', () => {
  const state = run(); state.phase = 'prep'; const other = canonical(state.players[1]);
  const bought = prepare(state, 0, { kind: 'buy', item: 'ball' });
  assert.equal(bought.players[0].money, 800); assert.equal(bought.players[0].bag.ball, 6); assert.equal(canonical(bought.players[1]), other);
  assert.throws(() => prepare(bought, 0, { kind: 'ready' }));
  const rewarded = prepare(bought, 0, { kind: 'reward', item: 'potion' });
  assert.throws(() => prepare(rewarded, 0, { kind: 'reward', item: 'ball' }));
  const ready = prepare(rewarded, 0, { kind: 'ready' });
  assert.throws(() => prepare(ready, 0, { kind: 'buy', item: 'ball' })); assert.throws(() => nextWave(ready));
});
