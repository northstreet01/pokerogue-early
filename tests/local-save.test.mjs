import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { indexedDB } from 'fake-indexeddb';

const source = fs.readFileSync(new URL('../src/system/local-save-store.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load() {
  const exports = {};
  vm.runInNewContext(code, { exports, indexedDB, console });
  return exports;
}
const saves = load();

test('collection snapshot survives reopening and preserves Chinese and large dex attributes', async () => {
  const profile = JSON.stringify({ nickname: '妙蛙种子', dexData: { 1: { caughtAttr: '18446744073709551616' } },
    voucherCounts: [3, 0, 0, 0], eggs: [{ id: 12 }] });
  await saves.writeLocalSave('collection-test', profile);
  assert.equal(await load().readLocalSave('collection-test'), profile);
});
test('collection and voucher consumption plus awarded eggs commit as one snapshot, with previous backup', async () => {
  const before = JSON.stringify({ vouchers: 1, eggs: [] });
  const after = JSON.stringify({ vouchers: 0, eggs: [{ id: 'egg-1' }] });
  await saves.writeLocalSave('gacha-test', before);
  await saves.writeLocalSave('gacha-test', after);
  assert.equal(await saves.readLocalSave('gacha-test'), after);
  assert.equal(await saves.readLocalSave('gacha-test:backup'), before);
});
test('slot writes and deletes remain isolated and retain a recovery backup', async () => {
  for (let slot = 0; slot < 3; slot++) await saves.writeLocalSave(saves.sessionSaveKey(slot), JSON.stringify({ wave: slot + 1 }));
  await saves.deleteLocalSave(saves.sessionSaveKey(1));
  assert.equal(await saves.readLocalSave('sessionData1'), null);
  assert.equal(await saves.readLocalSave('sessionData'), '{"wave":1}');
  assert.equal(await saves.readLocalSave('sessionData2'), '{"wave":3}');
  assert.equal(await saves.readLocalSave('sessionData1:backup'), '{"wave":2}');
});
test('malformed JSON cannot replace a valid save', async () => {
  await saves.writeLocalSave('invalid-test', '{"valid":true}');
  await assert.rejects(saves.writeLocalSave('invalid-test', '{broken'));
  assert.equal(await saves.readLocalSave('invalid-test'), '{"valid":true}');
});
test('invalid slots are refused and missing saves return null', async () => {
  for (const slot of [-1, 3, 0.5, NaN]) assert.throws(() => saves.sessionSaveKey(slot));
  assert.equal(await saves.readLocalSave('missing-test'), null);
});
test('archive restore validates every record before replacing anything and retains previous data', async () => {
  await saves.writeLocalSave('data', '{"original":true}');
  await assert.rejects(saves.restoreLocalSaves({ data: '{"replacement":true}', sessionData: 'broken' }));
  assert.equal(await saves.readLocalSave('data'), '{"original":true}');
  await saves.restoreLocalSaves({ data: '{"replacement":true}', sessionData: '{"wave":9}' });
  assert.equal(await saves.readLocalSave('data'), '{"replacement":true}');
  assert.equal(await saves.readLocalSave('data:backup'), '{"original":true}');
  assert.equal(await saves.readLocalSave('sessionData'), '{"wave":9}');
  assert.equal(await saves.readLocalSave('sessionData2'), null);
  assert.equal(await saves.readLocalSave('sessionData2:backup'), '{"wave":3}');
});
