import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import{spawn}from'node:child_process';import{resolve}from'node:path';
test('remote static assets revalidate unchanged images while hashed builds cache and changed HTML remains fresh',async()=>{
 const root=await fs.mkdtemp(resolve('build/remote-static-'));await fs.mkdir(root+'/assets');await fs.mkdir(root+'/images');
 await fs.writeFile(root+'/index.html','initial');await fs.writeFile(root+'/images/sample.png','image');await fs.writeFile(root+'/assets/main-1234abcd.js','module');
 const child=spawn(process.execPath,['server/start.mjs'],{env:{...process.env,PORT:'0',COOP_PROFILE_LOBBY:'0',COOP_DIST:root,COOP_DATA:root+'/experimental',COOP_FORMAL_DATA:root+'/formal'},stdio:['ignore','pipe','pipe']});
 try{const port=await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('server timeout')),10000);let output='';child.stdout.on('data',b=>{output+=b;const match=output.match(/localhost:(\d+)/);if(match){clearTimeout(timer);ok(Number(match[1]));}});child.on('exit',code=>{clearTimeout(timer);bad(Error('server exit '+code));});});
 const base='http://127.0.0.1:'+port;const image=await fetch(base+'/images/sample.png');assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'no-cache');
 assert.ok(image.headers.get('etag').startsWith('W/"'));assert.ok(!image.headers.get('etag').includes(String.fromCharCode(92)));assert.equal((await fetch(base+'/images/sample.png',{headers:{'if-none-match':image.headers.get('etag')}})).status,304);
 const hashed=await fetch(base+'/assets/main-1234abcd.js');assert.match(hashed.headers.get('cache-control'),/immutable/);
 const html=await fetch(base+'/');const tag=html.headers.get('etag');await fs.writeFile(root+'/index.html','changed HTML');
 const changed=await fetch(base+'/',{headers:{'if-none-match':tag}});assert.equal(changed.status,200);assert.equal(await changed.text(),'changed HTML');
 }finally{child.kill();}
});
