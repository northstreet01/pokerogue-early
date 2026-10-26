import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
const args=process.argv.slice(2);
if(args.some(value=>!['--host'].includes(value)))throw Error('用法：npm run start:local [-- --host]');
if(!existsSync((process.env.COOP_DIST??'dist')+'/index.html')||!existsSync('build/coop-runtime/original-runtime.cjs'))throw Error('请先运行 npm run build:coop-runtime 和 npm run build');
// LAN listening is an explicit user action. No firewall, tunnel or virtual LAN
// is installed/configured here; the browser still uses its own local profile.
const child=spawn(process.execPath,['server/start.mjs'],{stdio:'inherit',env:{...process.env,
 COOP_PROFILE_LOBBY:'1',COOP_BIND:args.includes('--host')?'0.0.0.0':'127.0.0.1'}});
child.on('exit',code=>{process.exitCode=code??1;});
for(const name of ['SIGINT','SIGTERM'])process.on(name,()=>child.kill(name));
