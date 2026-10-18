// OUT-02A: pure extractor for i18next-style interpolation placeholders.
// OUT-02B1: pure comparison of the placeholder sets of two strings.
// JSON scanning, reporting and the CLI belong to later stages.

const VARIABLE_NAME = '[A-Za-z_][A-Za-z0-9_.]*';
const FORMAT_NAME = '[A-Za-z_][A-Za-z0-9_]*';

function createPlaceholderPattern() {
  return new RegExp(
    `\\{\\{\\s*-?\\s*(${VARIABLE_NAME})\\s*(?:,\\s*(${FORMAT_NAME})\\s*)?\\}\\}`,
    'y',
  );
}

/**
 * Extract interpolation variable names from a raw string.
 *
 * Supported forms: `{{name}}`, `{{ name }}`, `{{- name}}`, `{{count, number}}`.
 * Whitespace may vary and the optional format name is not a variable. A `{{` or
 * `}}` that is not consumed by a legal placeholder marks the text as malformed
 * while still returning every variable that was recognized.
 *
 * @param {string} text raw text; non-string values are rejected, never coerced
 * @returns {{ variables: string[], malformed: boolean }}
 */
export function extractPlaceholders(text) {
  if (typeof text !== 'string') {
    throw new TypeError('extractPlaceholders expects a string');
  }

  const pattern = createPlaceholderPattern();
  const variables = new Set();
  let malformed = false;
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf('{{', index);
    const close = text.indexOf('}}', index);

    if (open === -1 && close === -1) break;

    // A closing pair that appears before the next opening pair is stray.
    if (open === -1 || (close !== -1 && close < open)) {
      malformed = true;
      index = close + 2;
      continue;
    }

    pattern.lastIndex = open;
    const match = pattern.exec(text);

    if (match === null) {
      malformed = true;
      index = open + 2;
      continue;
    }

    variables.add(match[1]);
    index = pattern.lastIndex;
  }

  return { variables: [...variables].sort(), malformed };
}

/**
 * Compare the placeholder sets of an English and a Chinese string.
 *
 * Both arguments must be primitive strings. Malformed expressions suppress the
 * set comparison and report the affected side; otherwise a different set yields
 * exactly one mismatch whose `expectedVariables` come from English and
 * `actualVariables` from Chinese. Sentence content and occurrence counts are
 * not compared and no file or key path is attached.
 *
 * @param {string} english English source text
 * @param {string} chinese Chinese translation text
 * @returns {Array<object>} independent problem objects; empty when sets match
 */
export function comparePlaceholderStrings(english, chinese) {
  if (typeof english !== 'string' || typeof chinese !== 'string') {
    throw new TypeError('comparePlaceholderStrings expects two strings');
  }

  const source = extractPlaceholders(english);
  const translation = extractPlaceholders(chinese);
  const problems = [];

  if (source.malformed) problems.push({ code: 'UNPARSED_INTERPOLATION', language: 'en' });
  if (translation.malformed) problems.push({ code: 'UNPARSED_INTERPOLATION', language: 'zh-Hans' });
  if (problems.length > 0) return problems;

  const sameLength = source.variables.length === translation.variables.length;
  const sameVariables = sameLength
    && source.variables.every((name, index) => name === translation.variables[index]);
  if (sameVariables) return [];

  return [{
    code: 'PLACEHOLDER_MISMATCH',
    expectedVariables: [...source.variables],
    actualVariables: [...translation.variables],
  }];
}
