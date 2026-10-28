import {open,mkdtemp,mkdir,rename,rm,stat,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const runFile=promisify(execFile);

// Electron's sandbox must read the installed program. A build made inside an
// AppContainer can inherit a package-specific ACE without the general read ACE.
// Add read/execute only, on the bounded candidate; never touch userData or use
// /reset, ownership changes, write grants, or an unbounded recursive ACL edit.
async function prepareWindowsPackageAccess(candidate){
  if(process.platform!=='win32')return;
  if(relative(candidate,await realpath(candidate)))throw Error('UNSAFE_PACKAGE_PATH');
  await stat(join(candidate,'PokeRogue-LAN.exe'));
  await runFile('icacls.exe',[candidate,'/grant','*S-1-15-2-1:(OI)(CI)(RX)','/Q'],{windowsHide:true});
}

export function ownedPackagePath(root,path) {
  const value=resolve(path),part=relative(resolve(root),value);
  if(!part||part.startsWith('..')||isAbsolute(part))throw Error('UNSAFE_PACKAGE_PATH');
  return value;
}
async function exists(path){try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

// Install a fully prepared directory, preserving the previous package if the
// promotion fails. Importing this module performs no filesystem operations.
export async function publishDesktopPackage({output,staged}) {
  const root=resolve(output),candidate=ownedPackagePath(root,staged);
  const release=ownedPackagePath(root,join(root,'release/PokeRogue-LAN-win32-x64'));
  await mkdir(join(root,'release'),{recursive:true});
  let previousRoot,previous,handle;
  try {
    if(await exists(release)){
      // Probe a running executable before moving anything. Release the handle
      // before the directory rename: Windows also rejects moving an open child.
      if(process.platform==='win32'){
        try{handle=await open(join(release,'PokeRogue-LAN.exe'),'r+');await handle.close();handle=null;}
        catch(error){throw Error('目标发行包被占用或无法写入；请退出游戏并检查目录权限。现有文件未改动。',{cause:error});}
      }
      previousRoot=ownedPackagePath(root,await mkdtemp(join(root,'package-previous-')));
      previous=ownedPackagePath(root,join(previousRoot,'PokeRogue-LAN-win32-x64'));
      await rename(release,previous);
    }
    try { await prepareWindowsPackageAccess(candidate);await rename(candidate,release); }
    catch(error) { if(previous&&await exists(previous))await rename(previous,release);throw error; }
    await handle?.close();handle=null;
    if(previousRoot)await rm(ownedPackagePath(root,previousRoot),{recursive:true,force:true,maxRetries:3,retryDelay:100});
    return release;
  } finally {
    await handle?.close();
    // Never delete a backup left by a failed rollback.
    if(previousRoot&&!await exists(previous))await rm(ownedPackagePath(root,previousRoot),{recursive:true,force:true});
  }
}
