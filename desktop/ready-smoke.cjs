// Opt-in synthetic UI audit. No player data or public debug bridge is used.
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {writeFile}=require('node:fs/promises');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({app,window,hosts,evaluate:execute,until,peer,peers,hello,report,evidence})=>{
  const evaluate=async code=>{try{return await execute(code);}catch(error){console.error('READY_EVALUATE',code.slice(0,160));throw error;}};
  const mark=step=>{report.readyStep=step;console.log('READY_QA',step);};
  // Hidden Electron windows need foreground emulation for Phaser's focus/timers.
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  await evaluate('window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"))');
  const debug=window.webContents.debugger;
  async function sceneDiagnostic(){
    const fn=await debug.sendCommand('Runtime.evaluate',{expression:'globalThis.__desktopPrepareClose'});
    const properties=await debug.sendCommand('Runtime.getProperties',{objectId:fn.result.objectId});
    const scopes=properties.internalProperties.find(p=>p.name==='[[Scopes]]')?.value;
    if(!scopes)return;
    const list=await debug.sendCommand('Runtime.getProperties',{objectId:scopes.objectId});
    for(const scope of list.result){
      if(!scope.value?.objectId||scope.value.description==='Global')continue;
      const bindings=await debug.sendCommand('Runtime.getProperties',{objectId:scope.value.objectId});
      for(const item of bindings.result){
        if(item.value?.type!=='object'||!item.value.objectId)continue;
        const match=await debug.sendCommand('Runtime.callFunctionOn',{objectId:item.value.objectId,
          functionDeclaration:'function(){return typeof this.getCurrentPhase==="function"}',returnByValue:true});
        if(match.result.value){
          await debug.sendCommand('Runtime.callFunctionOn',{objectId:item.value.objectId,functionDeclaration:'function(){globalThis.__readyScene=this}'});
          const state=await evaluate('({mode:__readyScene.ui.getMode(),paused:__readyScene.sys.game.isPaused,focus:__readyScene.sys.game.hasFocus,active:__readyScene.sys.isActive(),loop:__readyScene.sys.game.loop.running})');
          console.log('READY_SCENE',JSON.stringify(state));
          // Occluded windows can stop compositor-driven game frames despite visible
          // document state. Drive the real Phaser update/render clock for this QA.
          await evaluate(`(()=>{const game=__readyScene.sys.game;game.loop.stop();globalThis.__readyFrame=setInterval(()=>game.step(performance.now(),1000/60),1000/60)})()`);
          report.hiddenWindowManualFrames=true;return;
        }
      }
    }
  }
  mark('join');
  const room=await evaluate(`document.querySelector('.panel').textContent.match(/房间 ([A-Z0-9]{6})/)[1]`);
  const other=await peer(hosts.state().endpoint);peers.push(other);other.send(hello);await other.wait(m=>m.type==='welcome');
  other.send({type:'joinRoom',roomId:room,name:'准备页测试队友'});let snapshot=await other.wait(m=>m.type==='snapshot');
  const ack=s=>other.send({type:'stateAck',roomId:s.roomId,runId:s.runId,revision:s.revision,decisionId:s.decisionId,
    connectionEpoch:s.connectionEpoch,sharedHash:s.sharedHash,personalHash:s.personalHash});
  async function action(value){
    ack(snapshot);await other.wait(m=>m.type==='syncStatus'&&m.revision===snapshot.revision&&!m.blocked);
    const id=require('node:crypto').randomUUID();
    other.send({type:'submitAction',roomId:snapshot.roomId,runId:snapshot.runId,decisionId:snapshot.decisionId,
      expectedRevision:snapshot.revision,actionId:id,action:value});
    const receipt=await other.wait(m=>m.type==='actionReceipt'&&m.actionId===id);assert.equal(receipt.accepted,true,receipt.code);
    snapshot=await other.wait(m=>m.type==='snapshot'&&m.revision>snapshot.revision);ack(snapshot);
  }
  const runtime=require(join(app.getAppPath(),'build/coop-runtime/original-runtime.cjs'));
  runtime.describeOriginalCatalogs();
  const ids=[4,7],dexData=Object.fromEntries(ids.map(id=>[id,{ivs:[31,30,29,28,27,26],caughtAttr:149n,natureAttr:2,caughtCount:0,hatchedCount:0}]));
  const profile=runtime.captureProfile({trainerId:123,secretId:456,eggs:[],dexData,starterEggMoveData:{4:0,7:0}},
    ids.map(id=>({species:runtime.getPokemonSpecies(id),dexAttr:149n,nature:0,pokerus:false})));
  await action({kind:'profile-draft',profile,ready:false});await action({kind:'profile-ready',profile,ready:false});
  mark('preview');
  await until(`document.querySelectorAll('.coop-team-row')[1]?.textContent.includes('已选队')`);
  assert.equal(await evaluate(`document.querySelectorAll('.coop-team-row').length`),2);
  assert.equal(await evaluate(`document.querySelectorAll('.coop-team-row')[1].querySelectorAll('.coop-atlas-frame').length`),2);
  report.previewFrame=await evaluate(`({visibility:document.visibilityState,croppedImage:document.querySelector('.coop-atlas-frame')?.style.backgroundImage.startsWith('url("data:image/png')})`);
  assert.equal(report.previewFrame.croppedImage,true);
  console.log('READY_PREVIEW',JSON.stringify(report.previewFrame));
  await action({kind:'profile-ready',profile,ready:true});
  await until(`document.querySelectorAll('.coop-team-row')[1]?.textContent.includes('已准备')`);
  assert.equal(snapshot.personal.decision.kind,'lobby');
  // The protocol peer must also acknowledge unsolicited local draft revisions.
  other.socket.on('message',data=>{const next=JSON.parse(data);if(next.type==='snapshot'&&next.roomId===room)ack(next);});
  mark('selector');
  await until(`[...document.querySelectorAll('#coop-play-overlay button')].some(b=>b.textContent==='选择队伍'&&!b.disabled)`);
  await evaluate(`[...document.querySelectorAll('#coop-play-overlay button')].find(b=>b.textContent==='选择队伍').click()`);
  await until(`document.querySelector('#coop-play-overlay').classList.contains('selecting-team')`);
  await delay(1400);
  await sceneDiagnostic();
  await delay(1000);
  await until(`globalThis.__readyScene?.ui.getMode()===11&&__readyScene.getCurrentPhase().inputReady`);
  const press=async key=>{
    const code={Right:39,Enter:13,C:67}[key],name=key==='Right'?'ArrowRight':key;
    await evaluate('window.dispatchEvent(new KeyboardEvent("keydown",'+JSON.stringify({key:name,code:key==='C'?'KeyC':name,keyCode:code,which:code,bubbles:true})+'))');
    await delay(140);
    await evaluate('window.dispatchEvent(new KeyboardEvent("keyup",'+JSON.stringify({key:name,code:key==='C'?'KeyC':name,keyCode:code,which:code,bubbles:true})+'))');
    await delay(350);
  };
  await writeFile(join(evidence,'selector-before.png'),(await window.webContents.capturePage()).toPNG());
  await press('Right');await press('Enter');await delay(350);await press('Enter');
  await writeFile(join(evidence,'selector-after.png'),(await window.webContents.capturePage()).toPNG());
  await until(`document.querySelectorAll('.coop-team-row')[0].querySelectorAll('.coop-team-slot:not(.empty)').length===1`);
  await press('C');await delay(1500);
  for(let n=0;n<5&&await evaluate(`document.querySelector('#coop-play-overlay').classList.contains('selecting-team')`);n++){await press('Enter');await delay(700);}
  await until(`!document.querySelector('#coop-play-overlay').classList.contains('selecting-team')`);
  await until(`document.querySelectorAll('.coop-team-row')[0]?.textContent.includes('已选队')`);
  mark('confirmed-not-ready');
  assert.equal(await evaluate(`document.querySelector('#coop-play-overlay').classList.contains('room-lobby')`),true);
  assert.match(await evaluate(`document.querySelectorAll('.coop-team-row')[0].textContent`),/未准备/);
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await writeFile(join(evidence,'ready-teams.png'),(await window.webContents.capturePage()).toPNG());
  await until(`[...document.querySelectorAll('#coop-play-overlay button')].some(b=>b.textContent==='提交准备'&&!b.disabled)`);
  await evaluate(`[...document.querySelectorAll('#coop-play-overlay button')].find(b=>b.textContent==='提交准备'&&!b.disabled).click()`);
  snapshot=await other.wait(m=>m.type==='snapshot'&&m.personal.decision.kind!=='lobby');ack(snapshot);
  await until(`!document.querySelector('#coop-play-overlay').classList.contains('room-lobby')`);
  mark('battle');
  await until(`__readyScene.getCurrentPhase().latest?.personal.decision.kind==='wait-actions'&&__readyScene.getCurrentPhase().inputReady`);
  await delay(600);
  assert.equal(await evaluate(`document.querySelector('canvas').getBoundingClientRect().top>=document.querySelector('#coop-play-overlay').getBoundingClientRect().bottom-1`),true,'HUD reserves space above the game');
  assert.equal(await evaluate('document.querySelectorAll("canvas").length'),1);
  await writeFile(join(evidence,'ready-battle.png'),(await window.webContents.capturePage()).toPNG());
  // A named synthetic display fixture, not an earned item or a rule grant.
  mark('inventory-fixture');
  const owned=await evaluate('__readyScene.getCurrentPhase().model.applied.personal.party[0].id');
  const item=runtime.modifierTypes.LUCKY_EGG().withIdFromFunc(runtime.modifierTypes.LUCKY_EGG).newModifier({id:owned});item.stackCount=2;
  const state=runtime.captureModifierState(item);
  await evaluate(`(()=>{const p=__readyScene.getCurrentPhase();globalThis.__readyModelBefore=JSON.stringify(p.model.captureAppliedState());
    const s=structuredClone(p.latest);s.personal.resources.modifiers=[${JSON.stringify(state)}];p.model.applySnapshot(s);p.renderPersonalModifiers();
    document.querySelector('.coop-item').click();})()`);
  assert.match(await evaluate(`document.querySelector('.coop-item').getAttribute('aria-label')`),/幸运蛋 ×2/);
  await delay(600);
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await writeFile(join(evidence,'inventory-fixture.png'),(await window.webContents.capturePage()).toPNG());
  assert.equal(await evaluate(`(()=>{const p=__readyScene.getCurrentPhase();p.model.applySnapshot(p.latest);p.renderPersonalModifiers();return JSON.stringify(p.model.captureAppliedState())===__readyModelBefore})()`),true);
  report.checks.push('two-team-atlas-previews','peer-ready-alone-stays-lobby','original-selector-keyboard-confirm',
    'team-confirm-does-not-prepare','explicit-ready-enters-original-battle','synthetic-inventory-original-codec-display');
  await evaluate('clearInterval(globalThis.__readyFrame)');
};
