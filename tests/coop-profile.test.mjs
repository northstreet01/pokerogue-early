import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { indexedDB } from 'fake-indexeddb';
function load(path, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText;
  const exports = {}; vm.runInNewContext(code,{exports,indexedDB,console,require:name => dependencies[name]}); return exports;
}
const saves = load('../src/system/local-save-store.ts');
const coop = load('../src/coop/local-profile.ts',{'../system/local-save-store':saves});
const profile = () => ({ dexData: { 10: { seenAttr:0,caughtAttr:0,natureAttr:0,seenCount:0,caughtCount:0,hatchedCount:0,ivs:[0,0,0,0,0,0] } }, gameStats:{}, eggs:[{id:'keep'}], voucherCounts:{0:3}, timestamp:1 });
const grant = { id:'run:wave:enemy:caught',kind:'caught',mon:{species:10,dexAttr:'149',nature:4,ivs:[10,20,30,1,2,3]} };
async function setup() {
  await coop.releaseProfile('owner');
  await saves.writeLocalSave('data',JSON.stringify(profile()));
  await saves.deleteLocalSave('coop-experiment-data'); await saves.deleteLocalSave('coop-experiment-grants');
  await coop.acquireProfile('owner'); await coop.prepareExperimentalProfile('owner');
}
test('collection update and receipt commit atomically; retries after reload never double count',async () => {
  await setup(); const original = await saves.readLocalSave('data');
  await coop.applyCollectionGrants('owner',[grant]);
  const loaded = load('../src/coop/local-profile.ts',{'../system/local-save-store':load('../src/system/local-save-store.ts')});
  await loaded.applyCollectionGrants('owner',[grant]);
  const result = JSON.parse(await saves.readLocalSave('coop-experiment-data'));
  assert.equal(await saves.readLocalSave('data'),original, 'experimental grants must not change the original collection');
  assert.equal(result.dexData[10].caughtCount,1); assert.equal(result.gameStats.pokemonCaught,1);
  assert.deepEqual(result.dexData[10].ivs,[10,20,30,1,2,3]); assert.equal(result.dexData[10].natureAttr,32);
  assert.deepEqual(result.eggs,[{id:'keep'}]); assert.equal(result.voucherCounts[0],3);
  assert.deepEqual(JSON.parse(await saves.readLocalSave('coop-experiment-grants')).ids,[grant.id]);
  await coop.releaseProfile('owner');
});
test('invalid batch rolls back collection and ledger together',async () => {
  await setup();
  const before = await saves.readLocalSave('coop-experiment-data');
  await assert.rejects(coop.applyCollectionGrants('owner',[grant,{...grant,id:'bad',mon:{...grant.mon,species:99999}}]));
  assert.equal(await saves.readLocalSave('coop-experiment-data'),before);
  assert.deepEqual(JSON.parse(await saves.readLocalSave('coop-experiment-grants')).ids,[]);
  await coop.releaseProfile('owner');
});
test('active coop lease prevents another tab, stale solo overwrite and restore overwrite',async () => {
  await coop.acquireProfile('owner');
  await assert.rejects(coop.acquireProfile('other'));
  await assert.rejects(saves.writeLocalSave('data',JSON.stringify(profile())));
  await assert.rejects(saves.restoreLocalSaves({data:JSON.stringify(profile())}));
  await coop.releaseProfile('owner');
  await saves.writeLocalSave('data',JSON.stringify(profile()));
});
test('a stale solo snapshot cannot overwrite another original-game save',async () => {
  const original=JSON.stringify(profile()); await saves.writeLocalSave('data',original);
  await saves.writeLocalSave('data',JSON.stringify({...profile(),timestamp:2}),original);
  const collected=await saves.readLocalSave('data');
  await assert.rejects(saves.writeLocalSave('data',original,original));
  assert.equal(await saves.readLocalSave('data'),collected);
  const fresh=JSON.stringify({...JSON.parse(collected),timestamp:100});
  await saves.writeLocalSave('data',fresh,collected); assert.equal(await saves.readLocalSave('data'),fresh);
});

test('experimental initialization preserves existing progress and refuses a different trainer',async () => {
  await setup(); await coop.applyCollectionGrants('owner',[grant]);
  assert.equal((await coop.prepareExperimentalProfile('owner')).dexData[10].caughtCount,1);
  await coop.releaseProfile('owner');
  const experiment = await saves.readLocalSave('coop-experiment-data');
  await saves.writeLocalSave('data',JSON.stringify({...profile(),trainerId:9,secretId:10}));
  await coop.acquireProfile('owner'); await assert.rejects(coop.prepareExperimentalProfile('owner'),/不匹配/);
  assert.equal(await saves.readLocalSave('coop-experiment-data'),experiment);
  await coop.releaseProfile('owner');
});

test('experimental save and receipt survive backup restore together',async () => {
  await setup(); await coop.applyCollectionGrants('owner',[grant]); await coop.releaseProfile('owner');
  const records = {};
  for (const key of ['data','coop-experiment-data','coop-experiment-grants']) records[key] = await saves.readLocalSave(key);
  await saves.restoreLocalSaves(records); await coop.acquireProfile('owner');
  await coop.applyCollectionGrants('owner',[grant]);
  assert.equal(await saves.readLocalSave('data'),records.data);
  assert.equal(JSON.parse(await saves.readLocalSave('coop-experiment-data')).dexData[10].caughtCount,1);
  await coop.releaseProfile('owner');
});

test('invalid IV and nature grants cannot poison the experimental snapshot',async () => {
  await setup(); const before = await saves.readLocalSave('coop-experiment-data');
  for (const mon of [{...grant.mon,nature:25},{...grant.mon,ivs:[32,0,0,0,0,0]}])
    await assert.rejects(coop.applyCollectionGrants('owner',[{...grant,mon}]));
  assert.equal(await saves.readLocalSave('coop-experiment-data'),before);
  await coop.releaseProfile('owner');
});
