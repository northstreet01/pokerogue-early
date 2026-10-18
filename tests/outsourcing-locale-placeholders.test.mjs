import test from 'node:test';
import assert from 'node:assert/strict';

import { comparePlaceholderStrings, extractPlaceholders } from '../scripts/outsourcing/check-locale-placeholders.mjs';

// Fixed samples from the OUT-02A task book. Expected values are written out
// here on purpose and never produced by the implementation under test.
const fixedCases = [
  ['', [], false],
  ['普通文本 $t(menu:newGame)', [], false],
  ['{{name}}', ['name'], false],
  ['{{ name }} {{- name}}', ['name'], false],
  ['{{count, number}}', ['count'], false],
  ['{{b}} {{a}} {{b}}', ['a', 'b'], false],
  ['{{user.name}} {{item_id}}', ['item_id', 'user.name'], false],
  ['{{Name}} {{name}}', ['Name', 'name'], false],
  ['{{name', [], true],
  ['name}}', [], true],
  ['{{}}', [], true],
  ['{{two words}}', [], true],
  ['{{ok}} {{broken', ['ok'], true],
];

for (const [input, variables, malformed] of fixedCases) {
  test(`fixed sample ${JSON.stringify(input)}`, () => {
    assert.deepEqual(extractPlaceholders(input), { variables, malformed });
  });
}

test('non-string input throws TypeError instead of being coerced', () => {
  for (const value of [null, undefined, 0, {}, []]) {
    assert.throws(() => extractPlaceholders(value), TypeError);
  }
});

test('repeated and interleaved calls are deterministic and isolated', () => {
  const input = '{{b}} {{a}} {{b}}';
  const first = extractPlaceholders(input);

  assert.deepEqual(extractPlaceholders(input), first);

  // A malformed call in between must not leave a regex cursor behind.
  extractPlaceholders('{{x}} {{broken');

  const second = extractPlaceholders(input);
  assert.deepEqual(second, first);
  assert.notStrictEqual(second.variables, first.variables);

  // Mutating one result must not affect later calls.
  second.variables.push('mutated');
  assert.deepEqual(extractPlaceholders(input), { variables: ['a', 'b'], malformed: false });
});

// OUT-02B1 fixed samples: compare two strings while reusing extractPlaceholders.
// A's 15 tests above are kept unchanged; expected values are written out here.
test('B1: same placeholder in different sentences', () => {
  assert.deepEqual(comparePlaceholderStrings('Hi {{name}}', '你好{{name}}'), []);
});

test('B1: order and repetition differences are ignored', () => {
  assert.deepEqual(comparePlaceholderStrings('{{b}} {{a}} {{b}}', '{{a}}{{b}}'), []);
});

test('B1: formatted and unescaped-prefix forms match', () => {
  assert.deepEqual(comparePlaceholderStrings('{{count, number}}', '{{- count}}'), []);
});

test('B1: plain text without placeholders matches', () => {
  assert.deepEqual(comparePlaceholderStrings('Hello there.', '你好，旅行者。'), []);
});

test('B1: different variable names report one mismatch', () => {
  assert.deepEqual(comparePlaceholderStrings('{{name}}', '{{pokemonName}}'), [
    { code: 'PLACEHOLDER_MISMATCH', expectedVariables: ['name'], actualVariables: ['pokemonName'] },
  ]);
});

test('B1: variable case is significant', () => {
  assert.deepEqual(comparePlaceholderStrings('{{Name}}', '{{name}}'), [
    { code: 'PLACEHOLDER_MISMATCH', expectedVariables: ['Name'], actualVariables: ['name'] },
  ]);
});

test('B1: a missing variable reports sorted expected and actual', () => {
  assert.deepEqual(comparePlaceholderStrings('{{z}} {{x}}', '{{x}}'), [
    { code: 'PLACEHOLDER_MISMATCH', expectedVariables: ['x', 'z'], actualVariables: ['x'] },
  ]);
});

test('B1: empty english against a chinese placeholder', () => {
  assert.deepEqual(comparePlaceholderStrings('', '{{x}}'), [
    { code: 'PLACEHOLDER_MISMATCH', expectedVariables: [], actualVariables: ['x'] },
  ]);
});

test('B1: malformed english suppresses the variable comparison', () => {
  assert.deepEqual(comparePlaceholderStrings('{{bad', '{{other}}'), [
    { code: 'UNPARSED_INTERPOLATION', language: 'en' },
  ]);
});

test('B1: malformed chinese suppresses the variable comparison', () => {
  assert.deepEqual(comparePlaceholderStrings('{{name}}', 'name}}'), [
    { code: 'UNPARSED_INTERPOLATION', language: 'zh-Hans' },
  ]);
});

test('B1: both malformed keeps en before zh-Hans and reports no mismatch', () => {
  assert.deepEqual(comparePlaceholderStrings('{{}}', '{{bad'), [
    { code: 'UNPARSED_INTERPOLATION', language: 'en' },
    { code: 'UNPARSED_INTERPOLATION', language: 'zh-Hans' },
  ]);
});

test('B1: non-string input on either side throws TypeError', () => {
  for (const value of [null, undefined, 0, {}, []]) {
    assert.throws(() => comparePlaceholderStrings(value, '{{x}}'), TypeError);
    assert.throws(() => comparePlaceholderStrings('{{x}}', value), TypeError);
  }
  assert.throws(() => comparePlaceholderStrings(null, undefined), TypeError);
});

test('B1: results are deterministic and isolated', () => {
  const first = comparePlaceholderStrings('{{name}}', '{{pokemonName}}');
  comparePlaceholderStrings('{{a}}', '{{b}}');
  const second = comparePlaceholderStrings('{{name}}', '{{pokemonName}}');

  assert.deepEqual(second, first);
  assert.notStrictEqual(second, first);
  assert.notStrictEqual(second[0], first[0]);
  assert.notStrictEqual(second[0].expectedVariables, first[0].expectedVariables);
  assert.notStrictEqual(second[0].actualVariables, first[0].actualVariables);

  second[0].expectedVariables.push('mutated');
  second[0].actualVariables[0] = 'changed';
  second[0].code = 'CHANGED';
  second.push({ code: 'EXTRA' });

  assert.deepEqual(first, [
    { code: 'PLACEHOLDER_MISMATCH', expectedVariables: ['name'], actualVariables: ['pokemonName'] },
  ]);
  assert.deepEqual(comparePlaceholderStrings('{{name}}', '{{pokemonName}}'), [
    { code: 'PLACEHOLDER_MISMATCH', expectedVariables: ['name'], actualVariables: ['pokemonName'] },
  ]);

  const malformedFirst = comparePlaceholderStrings('{{bad', '{{other}}');
  const malformedSecond = comparePlaceholderStrings('{{bad', '{{other}}');
  assert.notStrictEqual(malformedSecond, malformedFirst);
  assert.notStrictEqual(malformedSecond[0], malformedFirst[0]);

  malformedSecond[0].language = 'xx';
  assert.deepEqual(malformedFirst, [{ code: 'UNPARSED_INTERPOLATION', language: 'en' }]);
  assert.deepEqual(comparePlaceholderStrings('{{bad', '{{other}}'), [
    { code: 'UNPARSED_INTERPOLATION', language: 'en' },
  ]);
});
