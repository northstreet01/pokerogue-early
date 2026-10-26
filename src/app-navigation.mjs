// One Phaser.Game and its decoded caches survive local mode changes. Each new
// scene owns its own phases, timers, inputs and profile IO; old scenes are removed.
// Shared by the renderer and local servers. Historical HTML tools are not app
// documents, even if an old build directory still happens to contain them.
export function isAppDocument(value, base) {
  try {
    const url = new URL(value, base);
    return url.origin === new URL(base).origin && ['/', '/index.html', '/coop-play.html'].includes(url.pathname);
  } catch { return false; }
}
export function appRoute(value, base) {
  const url=new URL(value,base);
  if(url.origin!==new URL(base).origin||!['/','/coop-play.html'].includes(url.pathname))throw Error('INVALID_APP_ROUTE');
  return url;
}
export function createAppNavigation({base,close,replace,start}) {
  let pending=null;
  return function navigate(scene,value,{discard=false}={}) {
    if(pending)return pending;
    const url=appRoute(value,base);
    pending=(async()=>{
      await close(scene,discard);
      replace(url);
      await start(scene,url);
    })().finally(()=>{pending=null;});
    return pending;
  };
}

// A failed save never becomes implicit permission to abandon the live scene.
// Explicit discard is reserved for the existing unsaved-return/recovery flow.
export async function closeAppScene(scene, discard = false) {
  const saved = await scene.prepareAppLeave?.();
  if (saved === false && !discard) throw Error('APP_SAVE_UNCONFIRMED');
  if (discard) scene.gameData?.invalidateProfile();
  else await scene.gameData?.closeProfile();
}

export function bindAppNavigationControls(doc, navigate, onError) {
  const click = event => {
    const control = event.target.closest?.('[data-app-route]');
    if (!control) return;
    event.preventDefault();
    control.blur();
    void Promise.resolve().then(() => navigate(control.getAttribute('data-app-route'))).catch(onError);
  };
  doc.addEventListener('click', click);
  const key = event => {
    if (event.target.closest?.('[data-app-route]')) event.stopPropagation();
  };
  doc.addEventListener('keydown', key);doc.addEventListener('keyup', key);
  return () => {
    doc.removeEventListener('click', click);
    doc.removeEventListener('keydown', key);doc.removeEventListener('keyup', key);
  };
}
