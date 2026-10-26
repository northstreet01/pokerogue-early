// One Phaser.Game and its decoded caches survive local mode changes. Each new
// scene owns its own phases, timers, inputs and profile IO; old scenes are removed.
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
