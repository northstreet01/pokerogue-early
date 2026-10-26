import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import http from 'node:http';

const get=url=>new Promise((resolve,reject)=>{
 const request=http.get(url,response=>{let body='';response.on('data',part=>body+=part);response.on('end',()=>resolve({status:response.statusCode,body}));});
 request.on('error',reject);
});

test('standalone entry serves only current documents, confines real paths and rejects the retired websocket',async()=>{
 await mkdir('build/code-review',{recursive:true});const root=await mkdtemp(resolve('build/code-review/server-test-'));
 let child;
 try{
  const dist=join(root,'dist'),outside=join(root,'private');await mkdir(dist);await mkdir(outside);
  await writeFile(join(dist,'index.html'),'current');await writeFile(join(dist,'save-tools.html'),'obsolete');
  await writeFile(join(outside,'secret.txt'),'must stay private');await symlink(outside,join(dist,'escape'),'junction');
  child=spawn(process.execPath,['server/start.mjs'],{env:{...process.env,PORT:'0',COOP_BIND:'127.0.0.1',COOP_PROFILE_LOBBY:'0',COOP_DIST:dist,COOP_FORMAL_DATA:join(root,'rooms')},stdio:['ignore','pipe','pipe']});
  let output='';const endpoint=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('SERVER_START_TIMEOUT')),10000);
   child.on('error',error=>{clearTimeout(timer);reject(error);});
   child.stdout.on('data',part=>{output+=part;const match=output.match(/localhost:(\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});
   child.once('exit',code=>{clearTimeout(timer);reject(Error('SERVER_EXIT '+code));});
  });
  assert.equal((await get(endpoint)).body,'current');
  assert.equal((await get(endpoint+'/save-tools.html')).status,404);
  assert.equal((await get(endpoint+'/escape/secret.txt')).status,404);
  assert.equal((await get(endpoint+'/coop/v1/host')).status,200);
  const socket=new WebSocket(endpoint.replace('http:','ws:')+'/coop/ws');
  await new Promise((resolve,reject)=>{socket.once('error',resolve);socket.once('open',()=>{socket.terminate();reject(Error('RETIRED_ENDPOINT_OPEN'));});});
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await rm(root,{recursive:true,force:true});}
});
