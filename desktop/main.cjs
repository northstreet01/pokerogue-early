const {app,BrowserWindow,ipcMain,dialog,Menu,shell}=require('electron');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
let assets,hosts,window,quitting=false,exitCode=0;
app.setName('PokeRogue LAN');
// QA mode uses a separate directory, even when testing a packaged executable.
const smoke=process.env.POKEROGUE_DESKTOP_SMOKE==='1';
const dataRoot=smoke?join(app.getPath('temp'),'pokerogue-desktop-smoke'):join(app.getPath('appData'),'PokeRogue-LAN');
app.setPath('userData',dataRoot);app.setPath('sessionData',dataRoot);
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(async()=>{
    const runtime=await import(pathToFileURL(join(__dirname,'runtime.mjs')).href);
    assets=await runtime.startAssetServer(join(app.getAppPath(),'dist'));
    hosts=runtime.createHostController({directory:join(dataRoot,'hosts','formal-rooms')});
    const trusted=event=>{
      if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame
        ||new URL(event.senderFrame.url).origin!==assets.origin)throw Error('UNTRUSTED_DESKTOP_CALL');
    };
    const result=async operation=>{try{return {ok:true,value:await operation()};}catch(error){return {ok:false,code:error.code??error.message};}};
    ipcMain.handle('desktop:host-state',event=>{trusted(event);return result(()=>hosts.state());});
    ipcMain.handle('desktop:host-start',(event,options)=>{
      trusted(event);
      if(!options||Object.keys(options).join(',')!=='port')throw Error('INVALID_HOST_OPTIONS');
      return result(()=>hosts.start(options));
    });
    async function stopHost(){
      if(!hosts.state().running)return {ok:true,value:{running:false}};
      const answer=await dialog.showMessageBox(window,{type:'question',buttons:['取消','保存并停止房主'],defaultId:0,cancelId:0,
        message:'停止后队友会断线，已保存的合作进度保留在本机，稍后可重新启动并恢复。'});
      return answer.response===1?result(()=>hosts.stop()):{ok:true,value:hosts.state()};
    }
    ipcMain.handle('desktop:host-stop',event=>{trusted(event);return stopHost();});
    window=new BrowserWindow({width:1280,height:850,minWidth:800,minHeight:600,show:!smoke,
      backgroundColor:'#111b2b',title:'宝可梦肉鸽 · 局域网版',webPreferences:{
        preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    const local=url=>{try{return new URL(url).origin===assets.origin;}catch{return false;}};
    window.webContents.on('will-navigate',(event,url)=>{if(!local(url))event.preventDefault();});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.on('close',event=>{if(!quitting){event.preventDefault();app.quit();}});
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'程序',submenu:[
      {label:'打开本机数据目录',click:()=>shell.openPath(dataRoot)},
      {label:'房主连接信息',click:()=>{const state=hosts.state();dialog.showMessageBox(window,{message:state.running
        ?`房主端口：${state.port}\n本机：${state.endpoint}\n队友可尝试：${state.addresses.join('\n')}\n远程玩家自行映射此TCP端口。`:'尚未启动本机房主。请进入联机冒险，点击启动本机房主。'});}},
      {label:'停止本机房主',click:()=>{void stopHost();}},
      {type:'separator'},{role:'quit',label:'退出程序'}]}]));
    await window.loadURL(assets.origin+'/');
    if(smoke)await require('./smoke.cjs')({app,window,hosts,origin:assets.origin,dataRoot});
  }).catch(error=>{
    if(smoke)console.error(error);
    else dialog.showErrorBox('程序启动失败',error.code==='EADDRINUSE'
      ?'本机入口端口18734已被占用。请关闭另一个实例或占用程序后重试；不会切换地址创建另一份存档。':String(error.message));
    exitCode=1;app.quit();
  });
  app.on('before-quit',event=>{
    if(quitting)return;event.preventDefault();quitting=true;
    Promise.resolve().then(async()=>{
      if(window&&!window.isDestroyed()){
        let timer,saved=false;
        try{saved=await Promise.race([window.webContents.executeJavaScript('globalThis.__desktopPrepareClose?.() ?? true'),
          new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);}
        catch{}finally{clearTimeout(timer);}
        if(!saved&&!smoke){
          const answer=await dialog.showMessageBox(window,{type:'warning',buttons:['返回游戏','仍然退出'],defaultId:0,cancelId:0,
            message:'尚未确认本机存档写入完成。返回游戏重试，或退出并从最近已保存节点恢复。'});
          if(answer.response!==1){quitting=false;return false;}
        }
        window.destroy();
      }
      await hosts?.stop();await assets?.close();return true;
    }).then(done=>{if(done)app.exit(exitCode);}).catch(error=>{console.error('DESKTOP_SHUTDOWN_FAILED',error.message);app.exit(1);});
  });
  app.on('window-all-closed',()=>app.quit());
}
