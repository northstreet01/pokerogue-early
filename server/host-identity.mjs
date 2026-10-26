import {mkdir,readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
export async function loadHostIdentity(directory){
 await mkdir(directory,{recursive:true});const path=resolve(directory,'host-id.json');
 try{return validate(JSON.parse(await readFile(path,'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
 const value={format:'pokerogue-local-host',version:1,hostId:randomUUID()};
 try{const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}}
 catch(error){if(error.code!=='EEXIST')throw error;return validate(JSON.parse(await readFile(path,'utf8')));}
 return value;
}
function validate(value){if(value?.format!=='pokerogue-local-host'||value.version!==1||! /^[a-f0-9-]{36}$/i.test(value.hostId)||Object.keys(value).length!==3)throw Error('INVALID_HOST_ID');return value;}
export function clientOriginAllowed(origin,host,allowed=[]){
 if(!origin)return true; // Non-browser protocol clients still authenticate seats.
 try{const url=new URL(origin);if(url.origin!==origin||!['http:','https:'].includes(url.protocol))return false;
  if(url.host===host)return true;
  return allowed.includes(origin)||(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.protocol==='http:');
 }catch{return false;}
}
export function serveHostIdentity(request,response,identity,allowed=[]){
 if(new URL(request.url,'http://local').pathname!=='/coop/v1/host')return false;
 const origin=request.headers.origin;
 if(!clientOriginAllowed(origin,request.headers.host,allowed)){response.writeHead(403);response.end();return true;}
 if(origin){response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');}
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','application/json');
 if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return true;}
 response.end(request.method==='HEAD'?'':JSON.stringify(identity));return true;
}
