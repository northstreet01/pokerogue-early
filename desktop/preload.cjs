const {contextBridge,ipcRenderer}=require('electron');
// Do not expose generic IPC, Node, shell commands, paths or filesystem methods.
contextBridge.exposeInMainWorld('pokerogueDesktop',Object.freeze({
  version:1,
  storageVersion:1,
  storageStatus:()=>ipcRenderer.invoke('desktop:storage-status'),
  storagePrepare:summary=>ipcRenderer.invoke('desktop:storage-prepare',summary),
  storageInitialize:request=>ipcRenderer.invoke('desktop:storage-initialize',request),
  storageSnapshot:request=>ipcRenderer.invoke('desktop:storage-snapshot',request),
  storageCommit:request=>ipcRenderer.invoke('desktop:storage-commit',request),
  preference:request=>ipcRenderer.sendSync('desktop:preference',request),
  hostState:()=>ipcRenderer.invoke('desktop:host-state'),
  startHost:port=>ipcRenderer.invoke('desktop:host-start',{port}),
  stopHost:()=>ipcRenderer.invoke('desktop:host-stop')
}));
