import {build} from 'vite';
import {resolve,join} from 'node:path';
import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';
import {buildCoopRuntime} from './build-coop-runtime.mjs';
import {desktopOutput} from './desktop-output.mjs';
import {spawnSync} from 'node:child_process';
// Refuse stale entry points or unresolved imports before constructing a release.
const review=spawnSync(process.execPath,['scripts/review-code.mjs'],{stdio:'inherit'});
if(review.status!==0)throw Error('CODE_REVIEW_FAILED');
const root=join(desktopOutput(),'app');
await mkdir(root,{recursive:true});
// Never overwrite dist/runtime belonging to an active browser service.
await buildCoopRuntime({outDir:join(root,'build/coop-runtime')});
await build({build:{outDir:join(root,'dist'),emptyOutDir:true}});
await cp('desktop',join(root,'desktop'),{recursive:true});
await mkdir(join(root,'server'),{recursive:true});
for(const name of ['formal-coop-service.mjs','host-identity.mjs','original-coop-adapter.mjs','original-rule-host.mjs','original-rule-worker.mjs'])
  await cp(join('server',name),join(root,'server',name));
await mkdir(join(root,'src/battle-core'),{recursive:true});
await cp('src/battle-core/coop-contract.mjs',join(root,'src/battle-core/coop-contract.mjs'));
await mkdir(join(root,'src/local-meta'),{recursive:true});
await cp('src/local-meta/codec.mjs',join(root,'src/local-meta/codec.mjs'));
await cp('src/app-navigation.mjs',join(root,'src/app-navigation.mjs'));
await mkdir(join(root,'node_modules'),{recursive:true});
await cp('node_modules/ws',join(root,'node_modules/ws'),{recursive:true});
const pkg=JSON.parse(await readFile('package.json','utf8'));
await writeFile(join(root,'package.json'),JSON.stringify({name:'pokerogue-lan',productName:'PokeRogue LAN',
  version:pkg.version,type:'module',main:'desktop/main.cjs',private:true},null,2));
await cp('LICENSE',join(root,'LICENSE'));
await cp('README.md',join(root,'使用说明.md'));
console.log('Desktop application prepared:',root);
