import {packager} from '@electron/packager';
import {readFile} from 'node:fs/promises';
const pkg=JSON.parse(await readFile('node_modules/electron/package.json','utf8'));
const paths=await packager({dir:'build/desktop/app',out:'build/desktop/release',name:'PokeRogue-LAN',
  platform:'win32',arch:'x64',electronVersion:pkg.version,asar:false,overwrite:true,prune:false,
  executableName:'PokeRogue-LAN',
  win32metadata:{ProductName:'PokeRogue LAN',FileDescription:'Local LAN cooperative game'}});
console.log(paths.join('\n'));
