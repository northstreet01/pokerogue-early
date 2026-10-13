import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { SceneRandom } from '../src/battle-core/decision-state.mjs';
import { RandomDataGenerator, withSeedOffset } from '../src/battle-core/random.mjs';
import * as context from '../src/battle-core/random-context.mjs';
import { withOriginalRandom } from '../server/original-random-context.mjs';

function utils(random, text) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => { assert.equal(name, './battle-core/random-context.mjs'); return context; }, Phaser: { Math: { RND: random } } });
  return exports;
}
const fullSource = fs.readFileSync(new URL('../src/utils.ts', import.meta.url), 'utf8');
const source = fullSource.slice(0, fullSource.indexOf('export function getSunday'));
const { source: original } = JSON.parse(fs.readFileSync(new URL('./fixtures/early-random-utils-reference.json', import.meta.url), 'utf8'));
const sequence = u => [u.randSeedInt(1), u.randSeedInt(73, -7), u.randSeedGauss(4), u.randSeedItem([2,5,9]), u.randSeedWeightedItem([2,5,9]), u.randomString(12, true)];
const room = seed => new SceneRandom(new RandomDataGenerator([seed]).state());

test('all original utility draws keep browser consumption and room streams survive async interleaving and restore', async () => {
  const browser = new RandomDataGenerator(['browser']), oldBrowser = new RandomDataGenerator(['browser']);
  const actual = utils(browser, source), oracle = utils(oldBrowser, original);
  assert.deepEqual(sequence(actual), sequence(oracle));
  assert.equal(browser.state(), oldBrowser.state());
  const ambient = browser.state(), a = room('A'), b = room('B');
  const expected = seed => { const random = new RandomDataGenerator([seed]); return { random, u: utils(random, original) }; };
  const ea = expected('A'), eb = expected('B');
  await Promise.all([[a,ea],[b,eb]].map(([r,e]) => withOriginalRandom(r, async () => {
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(sequence(actual), sequence(e.u));
      assert.equal(r.capture(), e.random.state());
    }
    const saved = r.capture();
    const next = sequence(actual);
    assert.deepEqual(withOriginalRandom(new SceneRandom(saved), () => sequence(actual)), next);
  })));
  assert.equal(browser.state(), ambient);
  assert.throws(() => actual.randSeedInt(20), /RANDOM_CONTEXT_REQUIRED/);
  assert.throws(() => withOriginalRandom(a, () => actual.randInt(20)), /UNSEEDED_RULE_RANDOM/);
});

test('nested original seed scopes keep parent state across await, exceptions and competing rooms', async () => {
  const r = room('outer'), other = room('other'), outer = r.capture();
  const u = utils(new RandomDataGenerator(['unused']), source);
  await withOriginalRandom(r, async () => {
    await assert.rejects(context.ruleSeedOffset(() => assert.fail('fallback'), 'seed', 7, async () => {
      const reference = new RandomDataGenerator(['parent']);
      let expected;
      withSeedOffset(reference, 'seed', 7, () => { expected = sequence(utils(reference, original)); });
      await withOriginalRandom(other, async () => { await Promise.resolve(); sequence(u); });
      assert.deepEqual(sequence(u), expected);
      throw new Error('scope failure');
    }), /scope failure/);
    assert.equal(r.capture(), outer);
  });
});

test('global seeded access is limited to the browser fallback and render-only palette quantizer', () => {
  const root = new URL('../src/', import.meta.url), found = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name, path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(path, name + '/');
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        const text = fs.readFileSync(path, 'utf8');
        for (const match of text.matchAll(/Phaser\.Math\.RND/g)) found.push(name);
      }
    }
  };
  walk(root);
  assert.deepEqual(found.sort(), ['field/pokemon.ts', 'utils.ts']);
});

test('detached random callbacks cannot consume a room stream after its execution scope has closed', async () => {
  const r = room('closed'), before = r.capture();
  let late;
  withOriginalRandom(r, () => {
    late = new Promise(resolve => setImmediate(() => {
      assert.throws(() => context.ruleRandom(() => assert.fail()), /RANDOM_CONTEXT_EXPIRED/);
      resolve();
    }));
  });
  await late;
  assert.equal(r.capture(), before);
});
