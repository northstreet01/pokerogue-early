import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {defaultTrainerRoute} from './native-default-trainer.mjs';
import {steadyInput} from './native-steady-progression.mjs';
import {forcedProgressionHost} from './forced-progression-host.mjs';
import {openPreparationRoom,request,until} from './native-preparation-ws.mjs';
import {FormalRoomStore} from '../../server/formal-coop-service.mjs';

// Full formal persistence/dual WS/model ACK route, with explicitly altered
// damage in a test-only Worker. No claim of normal combat or browser visuals.
export async function forcedProgressionRoute({untilWave=56,seed='learning-natural-2',output='build/vs02b22t',onWave=()=>{}}={}){
 const api=createRequire(import.meta.url)('../../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();
 await fs.mkdir(output,{recursive:true});
 const directory=await fs.mkdtemp(join(resolve(output),'isolated-rooms-'));
 const initial=await defaultTrainerRoute({seed});await initial.h.close();
 const provisioning={seed,identities:initial.profiles.map(p=>p.trainer),sharedPreparation:true};
 const fixture={api,checkpoint:initial.initial,stage:'battle',provisioning,hostFactory:forcedProgressionHost};
 let env=await openPreparationRoom({...fixture,store:new FormalRoomStore(directory)});
 let pair=env.pair,lastWave=0,saved,error=null;
 const trace=[],restarts=[],phases=new Map();
 try{
  for(let n=0;n<4000;n++){
   const room=env.server.rooms.get(pair[0].identity.roomId);saved=structuredClone(room.checkpoint);
   const c=saved.nativeCheckpoint,wave=c.battle.waveIndex;
   const step={step:n,wave,kind:c.decision.kind,revision:room.revision};trace.push(step);
   if(wave!==lastWave){lastWave=wave;onWave(step);await fs.writeFile(join(output,`wave-${wave}.json`),JSON.stringify(saved));}
   if(c.decision.kind==='ended')throw Error('UNEXPECTED_ACCELERATED_DEFEAT');
   if([11,21,31,41,51,untilWave].includes(wave)&&!restarts.includes(wave)){
    const tokens=pair.map(client=>client.identity),before=structuredClone(saved);
    await env.close();env=await openPreparationRoom({...fixture,store:new FormalRoomStore(directory),old:tokens});pair=env.pair;
    assert.deepEqual(env.server.rooms.get(pair[0].identity.roomId).checkpoint,before,'restart preserves the exact checkpoint and pending entitlements');
    restarts.push(wave);
   }
   if(wave>=untilWave&&c.decision.kind==='wait-actions')break;
   const inputs=steadyInput(api,c);assert.ok(Object.keys(inputs).length>0,'formal service must expose a legal choice');
   const revision=pair[0].latest.revision;
   const actions=Object.entries(inputs).map(([seat,action])=>({seat:Number(seat),message:request(pair[seat],action)}));
   actions.forEach(({seat,message})=>pair[seat].send(message));
   for(const {seat,message}of actions){const receipt=await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId);assert.equal(receipt.accepted,true,receipt.code);}
   await until(()=>pair.some(client=>client.errors.length)||pair.every(client=>client.ready&&client.latest.revision>revision),'next durable action and both model ACKs');
   assert.deepEqual(pair.flatMap(client=>client.errors),[]);
   const events=pair.flatMap(client=>client.latest.events);
   const names=[...new Set(events.filter(e=>e.kind==='phase-start').map(e=>e.phase))];step.phases=names;
   if(!phases.has(wave))phases.set(wave,new Set());for(const name of names)phases.get(wave).add(name);
   // Re-send a committed action at milestone fights: no reward or RNG replay.
   if([25,30,40,50,55].includes(wave)){
    const committed=structuredClone(env.server.rooms.get(pair[0].identity.roomId).checkpoint);
    for(const {seat,message}of actions){pair[seat].send(message);const receipt=await pair[seat].wait(m=>m.type==='actionReceipt'&&m.actionId===message.actionId);assert.equal(receipt.accepted,true,receipt.code);}
    assert.deepEqual(env.server.rooms.get(pair[0].identity.roomId).checkpoint,committed);
   }
   assert.ok(n<3999,'forced route budget');
  }
 }catch(cause){error={message:cause.message,code:cause.code??null,detail:cause.detail??cause.stack};}
 finally{await env.close();}
 const result={seed,mode:'TEST_ONLY enemy lethal damage amount + player damage zero; original segment handling retained',
  startedWave:1,reachedWave:saved?.nativeCheckpoint.battle.waveIndex,decision:saved?.nativeCheckpoint.decision.kind,
  error,restarts,trace,phases:Object.fromEntries([...phases].map(([wave,names])=>[wave,[...names]])),
  pendingVouchers:saved?.intents.filter(i=>i.type==='voucher-pending').map(i=>({id:i.id,owner:i.owner,status:i.status,payload:i.payload})),
  realBrowser:false,realUserRoomModified:false};
 await fs.writeFile(join(output,'last-checkpoint.json'),JSON.stringify(saved));
 await fs.writeFile(join(output,'result.json'),JSON.stringify(result,null,2));
 return result;
}
