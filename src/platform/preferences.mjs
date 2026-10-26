const allowed=new Set(['settings','tutorials','prLang','coop-local-hosts-v1','coop-play-auto-resume-paused']);
export function deviceStorage(){
  const bridge=globalThis.pokerogueDesktop;
  if(bridge?.storageVersion!==1)return globalThis.localStorage;
  function call(action,key,value){
    if(!allowed.has(key))throw Error('INVALID_PREFERENCE_KEY');
    const reply=bridge.preference({action,key,...(value===undefined?{}:{value})});
    if(!reply?.ok)throw Error(reply?.code??'DESKTOP_STORAGE_FAILED');
    if(!reply.value.initialized){
      if(action==='get')return globalThis.localStorage?.getItem(key)??null;
      if(action==='set')globalThis.localStorage.setItem(key,value);else globalThis.localStorage.removeItem(key);
      return;
    }
    return reply.value.value;
  }
  return {getItem:key=>call('get',key),setItem:(key,value)=>call('set',key,String(value)),
    removeItem:key=>call('delete',key),hasOwnProperty:key=>call('get',key)!==null};
}
