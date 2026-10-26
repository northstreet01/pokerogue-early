import {packager} from '@electron/packager';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {desktopOutput} from './desktop-output.mjs';
const pkg=JSON.parse(await readFile('node_modules/electron/package.json','utf8'));
const paths=await packager({dir:join(desktopOutput(),'app'),out:join(desktopOutput(),'release'),name:'PokeRogue-LAN',
  platform:'win32',arch:'x64',electronVersion:pkg.version,asar:false,overwrite:true,prune:false,
  executableName:'PokeRogue-LAN',
  win32metadata:{ProductName:'PokeRogue LAN',FileDescription:'Local LAN cooperative game'}});
console.log(paths.join('\n'));
