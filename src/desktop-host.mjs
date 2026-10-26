// Optional platform port: browsers retain the original connection flow.
export function desktopHost(){return globalThis.pokerogueDesktop?.version===1?globalThis.pokerogueDesktop:null;}
export async function startDesktopHost(port){
  const bridge=desktopHost();if(!bridge)throw Error('DESKTOP_HOST_UNAVAILABLE');
  const reply=await bridge.startHost(port);if(!reply?.ok)throw Error(reply?.code??'HOST_START_FAILED');
  return reply.value;
}
