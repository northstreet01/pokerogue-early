import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {publishDesktopPackage} from '../scripts/desktop-package.mjs';

test('package promotion swaps a complete directory and removes the superseded package',async()=>{
 await mkdir('build/code-review',{recursive:true});const output=await mkdtemp(resolve('build/code-review/package-test-'));
 try {
  const release=join(output,'release/PokeRogue-LAN-win32-x64'),staged=join(output,'staging');
  await mkdir(release,{recursive:true});await mkdir(staged);await writeFile(join(release,'PokeRogue-LAN.exe'),'old');
  await writeFile(join(staged,'PokeRogue-LAN.exe'),'new');await writeFile(join(staged,'assets-ready'),'complete');
  assert.equal(await publishDesktopPackage({output,staged}),release);
  assert.equal(await readFile(join(release,'PokeRogue-LAN.exe'),'utf8'),'new');
  assert.equal(await readFile(join(release,'assets-ready'),'utf8'),'complete');assert.deepEqual(await readdir(output),['release']);
 }finally{await rm(output,{recursive:true,force:true});}
});

test('failed package promotion restores the previous complete package instead of leaving a partial update',async()=>{
 await mkdir('build/code-review',{recursive:true});const output=await mkdtemp(resolve('build/code-review/package-test-'));
 try {
  const release=join(output,'release/PokeRogue-LAN-win32-x64'),staged=join(output,'missing-candidate');
  await mkdir(release,{recursive:true});await writeFile(join(release,'PokeRogue-LAN.exe'),'old');await writeFile(join(release,'old-assets'),'complete');
  await assert.rejects(publishDesktopPackage({output,staged}),/ENOENT/);
  assert.equal(await readFile(join(release,'PokeRogue-LAN.exe'),'utf8'),'old');
  assert.equal(await readFile(join(release,'old-assets'),'utf8'),'complete');assert.deepEqual(await readdir(output),['release']);
  await assert.rejects(publishDesktopPackage({output,staged:resolve(output,'..','outside')}),/UNSAFE_PACKAGE_PATH/);
 }finally{await rm(output,{recursive:true,force:true});}
});
