// Opt-in QA against synthetic application data, never the player's directory.
const assert=require('node:assert/strict');
const {writeFile,mkdir}=require('node:fs/promises');
const {join}=require('node:path');
const {WebSocket}=require('ws');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({app,window,hosts,origin,dataRoot})=>{
  const evidence=join(dataRoot,'evidence');await mkdir(evidence,{recursive:true});
  const report={packaged:app.isPackaged,origin,dataRoot,errors:[],checks:[]};
  window.webContents.on('render-process-gone',(_event,details)=>report.errors.push(details.reason));
  const evaluate=code=>window.webContents.executeJavaScript(code);
  async function until(code){for(let i=0;i<180;i++){if(await evaluate(code))return;await delay(500);}throw Error('DESKTOP_UI_TIMEOUT');}
  async function peer(endpoint){
    const socket=new WebSocket(endpoint.replace('http:','ws:')+'/coop/v1/ws',{origin});
    const messages=[];socket.on('message',data=>messages.push(JSON.parse(data)));
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    return {socket,messages,send:v=>socket.send(JSON.stringify(v)),wait:async predicate=>{
      for(let i=0;i<600;i++){const found=messages.find(predicate);if(found)return found;await delay(50);}
      throw Error('DESKTOP_WS_TIMEOUT');
    }};
  }
  const peers=[];
  try{
    await until(`document.querySelector('#app')?.dataset.sceneMode==='home'`);
    assert.equal(await evaluate('typeof require'),'undefined');
    assert.equal(await evaluate('typeof pokerogueDesktop.startHost'),'function');
    assert.equal((await evaluate('pokerogueDesktop.hostState()')).value.running,false);
    assert.equal(await evaluate('document.querySelectorAll("canvas").length'),1);
    report.checks.push('local-home','sandboxed-renderer','no-auto-host','single-canvas');
    const status=await evaluate('pokerogueDesktop.storageStatus()');
    assert.equal(status.ok,true,status.code);assert.equal(status.value.initialized,true);
    report.nativeLaunches=await evaluate(`(async()=>{
      const before=await pokerogueDesktop.storageSnapshot({scope:'legacy',keys:['desktop-smoke-marker']});
      if(!before.ok)throw Error(before.code);
      const count=JSON.parse(before.value.records['desktop-smoke-marker']?.value??'0')+1;
      const reply=await pokerogueDesktop.storageCommit({scope:'legacy',keys:['desktop-smoke-marker'],expectedRevision:before.value.revision,
        changes:{'desktop-smoke-marker':{schema:1,value:JSON.stringify(count),updatedAt:Date.now()}}});
      if(!reply.ok)throw Error(reply.code);return count;
    })()`);
    assert.equal(await evaluate(`pokerogueDesktop.preference({action:'set',key:'prLang',value:'zh-Hans'}).ok`),true);
    assert.equal(await evaluate(`pokerogueDesktop.preference({action:'get',key:'prLang'}).value.value`),'zh-Hans');
    report.checks.push('native-sqlite-initialized','native-save-persistence','native-preferences-ipc');
    report.persistedLaunches=await evaluate(`new Promise((resolve,reject)=>{
      const req=indexedDB.open('desktop-smoke-persistence',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('records');
      req.onerror=()=>reject(req.error);req.onsuccess=()=>{
        const db=req.result,tx=db.transaction('records','readwrite'),store=tx.objectStore('records');let count;
        store.get('launches').onsuccess=event=>{count=(event.target.result??0)+1;store.put(count,'launches');};
        tx.oncomplete=()=>{db.close();resolve(count);};tx.onabort=()=>reject(tx.error);
      };
    })`);
    const reply=await evaluate('pokerogueDesktop.startHost(18735)');assert.equal(reply.ok,true,reply.code);
    const state=reply.value;
    assert.equal((await (await fetch(state.endpoint+'/coop/v1/host')).json()).hostId,state.hostId);
    assert.equal((await fetch(state.endpoint+'/images/pokemon/1.png')).status,404);
    report.checks.push('native-host-ipc','formal-identity','lan-no-assets');
    const hello={type:'hello',protocolVersion:1,checkpointVersion:1,rulesVersion:'early-vs02',contentHash:'vs02-original-coop'};
    const a=await peer(state.endpoint);peers.push(a);a.send(hello);await a.wait(m=>m.type==='welcome');
    a.send({type:'createRoom',name:'桌面测试甲'});const first=await a.wait(m=>m.type==='snapshot');
    const welcome=await a.wait(m=>m.type==='welcome'&&m.roomId===first.roomId);
    const b=await peer(state.endpoint);peers.push(b);b.send(hello);await b.wait(m=>m.type==='welcome');
    b.send({type:'joinRoom',roomId:first.roomId,name:'桌面测试乙'});await b.wait(m=>m.type==='snapshot');
    await hosts.stop();await hosts.start({port:18735});
    assert.equal(hosts.state().hostId,state.hostId);
    const resumed=await peer(state.endpoint);peers.push(resumed);resumed.send(hello);await resumed.wait(m=>m.type==='welcome');
    resumed.send({type:'resumeSeat',roomId:first.roomId,resumeToken:welcome.resumeToken});
    const restored=await resumed.wait(m=>m.type==='snapshot');assert.equal(restored.runId,first.runId);assert.equal(restored.seat,0);
    report.checks.push('original-worker-room','two-websockets','host-restart','same-run-seat');
    await evaluate(`document.querySelector('#desktopControls a[href^="/coop-play.html"]').click()`);
    await until(`!!document.querySelector('input[aria-label="本机房主端口"]')`);
    assert.equal(await evaluate('document.querySelectorAll("canvas").length'),1);
    await evaluate(`[...document.querySelectorAll('#coop-play-overlay button')].find(b=>b.textContent==='启动本机房主').click()`);
    await until(`[...document.querySelectorAll('#coop-play-overlay button')].some(b=>b.textContent==='创建房间'&&!b.disabled)`);
    await evaluate(`[...document.querySelectorAll('#coop-play-overlay button')].find(b=>b.textContent==='创建房间').click()`);
    await until(`!!document.querySelector('#coop-waiting-room')`);
    const foreign=await evaluate(`performance.getEntriesByType('resource').map(e=>e.name).filter(u=>!u.startsWith(location.origin+'/')&&!u.startsWith('blob:')&&!u.startsWith('data:'))`);
    assert.deepEqual(foreign,[]);
    report.checks.push('same-game-coop-entry','native-host-controls','original-ui-create-room','resources-local-only');
    // DOM readiness precedes compositor presentation, particularly in a hidden window.
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await delay(150);
    report.roomView=await evaluate(`({waiting:!!document.querySelector('#coop-waiting-room'),
      presence:document.querySelector('.room-players')?.textContent,canvas:document.querySelectorAll('canvas').length})`);
    await writeFile(join(evidence,'desktop.png'),(await window.webContents.capturePage()).toPNG());
    assert.equal(report.errors.length,0);report.ok=true;
  }finally{
    for(const p of peers)p.socket.terminate();
    await hosts.stop();await writeFile(join(evidence,'result.json'),JSON.stringify(report,null,2));
  }
  console.log('DESKTOP_SMOKE',JSON.stringify(report));app.quit();
};
