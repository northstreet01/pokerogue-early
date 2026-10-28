const {app,BrowserWindow,ipcMain,dialog,Menu,shell}=require('electron');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
let assets,hosts,window,storage,quitting=false,restoring=false,exitCode=0;
async function saveRenderer(){
  if(!window||window.isDestroyed())return true;
  let timer;try{return await Promise.race([window.webContents.executeJavaScript('globalThis.__desktopPrepareClose?.() ?? true'),
    new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);}catch{return false;}finally{clearTimeout(timer);}
}
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
    const {openDesktopStorage,STORAGE_SCOPES}=await import(pathToFileURL(join(__dirname,'storage.mjs')).href);
    storage=openDesktopStorage(join(dataRoot,'storage'));
    assets=await runtime.startAssetServer(join(app.getAppPath(),'dist'));
    hosts=runtime.createHostController({directory:join(dataRoot,'hosts','formal-rooms')});
    const trusted=event=>{
      if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame
        ||new URL(event.senderFrame.url).origin!==assets.origin)throw Error('UNTRUSTED_DESKTOP_CALL');
    };
    const result=async operation=>{try{return {ok:true,value:await operation()};}catch(error){return {ok:false,code:error.code??error.message};}};
    let migrationTicket=null;
    ipcMain.handle('desktop:storage-status',event=>{trusted(event);return result(()=>storage.status());});
    ipcMain.handle('desktop:storage-snapshot',(event,request)=>{trusted(event);return result(()=>storage.snapshot(request.scope,request.keys));});
    ipcMain.handle('desktop:storage-commit',(event,request)=>{trusted(event);return result(()=>storage.commit(request));});
    ipcMain.handle('desktop:storage-prepare',async(event,summary)=>{
      trusted(event);
      if(!summary||Object.keys(summary).length!==STORAGE_SCOPES.length||!STORAGE_SCOPES.every(scope=>Number.isSafeInteger(summary[scope])&&summary[scope]>=0))return {ok:false,code:'INVALID_STORAGE_SUMMARY'};
      const hasData=Object.values(summary).some(n=>n>0);
      const approved=!hasData||smoke||(await dialog.showMessageBox(window,{type:'question',buttons:['暂不迁移','确认迁移'],defaultId:0,cancelId:0,
        message:'发现旧桌面资料，是否迁移到本机存档数据库？',
        detail:'个人档案、单人进度、席位、待发行动和设置将一次提交。原IndexedDB保持不变。取消将停留在入口，不创建空档替代。'})).response===1;
      const ticket=require('node:crypto').randomUUID();migrationTicket=approved?{ticket,summary}:null;
      return {ok:true,value:{approved,ticket:approved?ticket:null}};
    });
    ipcMain.handle('desktop:storage-initialize',(event,request)=>{trusted(event);return result(()=>{
      if(!migrationTicket||migrationTicket.ticket!==request.ticket)throw Error('DESKTOP_MIGRATION_REQUIRED');
      const expected=migrationTicket.summary;migrationTicket=null;
      if(!STORAGE_SCOPES.every(scope=>Object.keys(request.bundle?.[scope]??{}).length===expected[scope]))throw Error('DESKTOP_MIGRATION_CHANGED');
      return storage.initialize(request.bundle,request.digest);
    });});
    ipcMain.on('desktop:preference',(event,request)=>{
      try{
        trusted(event);
        if(!request||!['settings','tutorials','prLang','coop-local-hosts-v1','coop-play-auto-resume-paused'].includes(request.key)||!['get','set','delete'].includes(request.action))throw Error('INVALID_PREFERENCE_KEY');
        if(request.action==='set'&&(typeof request.value!=='string'||request.value.length>65536))throw Error('INVALID_PREFERENCE_VALUE');
        if(!storage.status().initialized){event.returnValue={ok:true,value:{initialized:false}};return;}
        const snapshot=storage.snapshot('preferences',[request.key]);
        if(request.action!=='get')storage.commit({scope:'preferences',keys:[request.key],expectedRevision:snapshot.revision,changes:{[request.key]:request.action==='delete'?null:request.value}});
        event.returnValue={ok:true,value:{initialized:true,value:snapshot.records[request.key]}};
      }catch(error){event.returnValue={ok:false,code:error.code??error.message};}
    });
    ipcMain.handle('desktop:host-state',event=>{trusted(event);return result(()=>hosts.state());});
    let discoveryTask=null;
    ipcMain.handle('desktop:host-discover',event=>{trusted(event);return result(()=>{
      // A fixed, bounded scan; the renderer cannot request arbitrary UDP traffic.
      return discoveryTask??=(runtime.discoverLanHosts().finally(()=>{discoveryTask=null;}));
    });});
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
    const local=url=>runtime.isAppDocument(url,assets.origin);
    window.webContents.on('will-navigate',(event,url)=>{if(!local(url))event.preventDefault();});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.on('close',event=>{if(!quitting){event.preventDefault();app.quit();}});
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'程序',submenu:[
      {label:'打开本机数据目录',click:()=>shell.openPath(dataRoot)},
      {label:'备份个人存档数据库',click:async()=>{try{const path=storage.backup();await dialog.showMessageBox(window,{message:'个人存档数据库备份完成',detail:path+'\n此备份包含本人档案和私有席位，不包含房主合作房间。'});}catch(error){dialog.showErrorBox('备份失败',error.message);}}},
      {label:'恢复个人存档数据库',click:async()=>{
        const chosen=await dialog.showOpenDialog(window,{title:'选择个人存档数据库备份',properties:['openFile'],filters:[{name:'个人数据库',extensions:['sqlite']}]});
        if(chosen.canceled)return;
        const answer=await dialog.showMessageBox(window,{type:'warning',buttons:['取消','确认整份恢复并重启'],defaultId:0,cancelId:0,
          message:'恢复整份个人数据库会回到备份时的档案、余额和席位状态。',detail:'当前数据库会先留保护备份。房主房间不回滚，未对账成果仍需原协议核对。'});
        if(answer.response!==1)return;
        if(!await saveRenderer()){dialog.showErrorBox('恢复已取消','尚未确认当前存档保存，请返回游戏重试。');return;}
        restoring=true;
        try{window.destroy();await hosts.stop();storage.restore(chosen.filePaths[0]);app.relaunch();}
        catch(error){dialog.showErrorBox('恢复失败，原数据库保留',error.message);}
        finally{restoring=false;app.quit();}
      }},
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
        const saved=await saveRenderer();
        if(!saved&&!smoke){
          const answer=await dialog.showMessageBox(window,{type:'warning',buttons:['返回游戏','仍然退出'],defaultId:0,cancelId:0,
            message:'尚未确认本机存档写入完成。返回游戏重试，或退出并从最近已保存节点恢复。'});
          if(answer.response!==1){quitting=false;return false;}
        }
        window.destroy();
      }
      await hosts?.stop();await assets?.close();storage?.close();return true;
    }).then(done=>{if(done)app.exit(exitCode);}).catch(error=>{console.error('DESKTOP_SHUTDOWN_FAILED',error.message);app.exit(1);});
  });
  app.on('window-all-closed',()=>{if(!restoring)app.quit();});
}
