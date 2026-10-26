import {deviceStorage} from '../platform/preferences.mjs';
const HOSTS_KEY='coop-local-hosts-v1';
const localBase=()=>globalThis.location?.href??`${globalThis.location?.origin??'http://localhost'}/`;
export function normalizeEndpoint(value,base=localBase()){
 const url=new URL(value||new URL(base).origin,base);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('INVALID_HOST_ENDPOINT');
 if(new URL(base).protocol==='https:'&&url.protocol!=='https:')throw Error('HOST_HTTPS_REQUIRED');
 return url.origin;
}
export function hostScope(origin,hostId,profileId=null){if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(hostId))throw Error('INVALID_HOST_ID');return `${origin}::host:${hostId}${profileId?'::profile:'+encodeURIComponent(profileId):''}`;}
export function readHosts(storage=deviceStorage()){
 if(!storage)return {selected:null,hosts:[]};
 const raw=storage.getItem(HOSTS_KEY);if(!raw)return {selected:null,hosts:[]};
 const value=JSON.parse(raw);if(value?.version!==1||!Array.isArray(value.hosts))throw Error('INVALID_HOST_DIRECTORY');
 for(const row of value.hosts) {hostScope('local',row.hostId);normalizeEndpoint(row.endpoint);}
 return value;
}
export function rememberHost(host,storage=deviceStorage()){
 const old=readHosts(storage);const value={version:1,selected:host.endpoint,
  hosts:[{hostId:host.hostId,endpoint:host.endpoint},...old.hosts.filter(row=>row.hostId!==host.hostId)].slice(0,20)};
 storage.setItem(HOSTS_KEY,JSON.stringify(value));return value;
}
export async function identifyHost(value,{base=localBase(),fetcher=globalThis.fetch,expectedHostId=null,signal}={}){
 const endpoint=normalizeEndpoint(value,base),controller=new AbortController();
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
 const timeout=setTimeout(abort,8000);
 try{
  const response=await fetcher(`${endpoint}/coop/v1/host`,{cache:'no-store',credentials:'omit',signal:controller.signal});
  // Only an old same-origin service may retain its existing legacy namespace.
  if(response.status===404&&endpoint===new URL(base).origin&&!expectedHostId)return {endpoint,hostId:null,legacy:true};
  if(!response.ok)throw Error('HOST_UNAVAILABLE');const value=await response.json();
  if(value?.format!=='pokerogue-local-host'||value.version!==1||Object.keys(value).length!==3)throw Error('INVALID_HOST_ID');
  hostScope(new URL(base).origin,value.hostId);
  if(expectedHostId&&value.hostId!==expectedHostId)throw Error('HOST_ID_CHANGED');
  return {endpoint,hostId:value.hostId,legacy:false};
 }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
export function hostSocketUrl(endpoint){const url=new URL('/coop/v1/ws',endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';return url.href;}
export function hostConnectionError(error){
 const messages={INVALID_HOST_ENDPOINT:'请输入有效的房主 HTTP 地址，不要附加路径、密码或查询参数。',HOST_HTTPS_REQUIRED:'当前页面使用 HTTPS，房主地址也需要 HTTPS；本地局域网测试可从自己的本机 HTTP 入口启动。',
  HOST_ID_CHANGED:'这个地址已属于另一台房主，已停止恢复，原席位与待发行动仍保留。',HOST_UNAVAILABLE:'房主服务不可用，请检查地址和端口。',INVALID_HOST_ID:'房主身份资料无效，无法安全恢复。',INVALID_HOST_DIRECTORY:'本机房主地址记录损坏，请保留记录后检查，个人收藏没有被替换。'};
 return messages[error?.message]??null;
}
