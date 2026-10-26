const {contextBridge,ipcRenderer}=require('electron');
// Do not expose generic IPC, Node, shell commands, paths or filesystem methods.
contextBridge.exposeInMainWorld('pokerogueDesktop',Object.freeze({
  version:1,
  hostState:()=>ipcRenderer.invoke('desktop:host-state'),
  startHost:port=>ipcRenderer.invoke('desktop:host-start',{port}),
  stopHost:()=>ipcRenderer.invoke('desktop:host-stop')
}));
