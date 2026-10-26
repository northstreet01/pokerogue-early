import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {desktopOutput} from './desktop-output.mjs';
import {ownedPackagePath,publishDesktopPackage} from './desktop-package.mjs';

async function packageDesktop(){
  const {packager}=await import('@electron/packager');
  const output=desktopOutput();await mkdir(output,{recursive:true});
  const staging=ownedPackagePath(output,await mkdtemp(join(output,'package-staging-')));
  try {
    const pkg=JSON.parse(await readFile('node_modules/electron/package.json','utf8'));
    const paths=await packager({dir:join(output,'app'),out:staging,name:'PokeRogue-LAN',
      platform:'win32',arch:'x64',electronVersion:pkg.version,asar:false,overwrite:false,prune:false,
      executableName:'PokeRogue-LAN',
      win32metadata:{ProductName:'PokeRogue LAN',FileDescription:'Local LAN cooperative game'}});
    console.log(await publishDesktopPackage({output,staged:paths[0]}));
  } finally { await rm(ownedPackagePath(output,staging),{recursive:true,force:true,maxRetries:3,retryDelay:100}); }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await packageDesktop();
