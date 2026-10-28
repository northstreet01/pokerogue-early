import dgram from 'node:dgram';
import {randomBytes} from 'node:crypto';
import {networkInterfaces} from 'node:os';

// Discovery only locates a TCP host. HTTP identity and the room protocol still
// authenticate the selected destination; no saves or room credentials use UDP.
export const DISCOVERY_PORT=18736;
const format='pokerogue-lan-discovery',id=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const noncePattern=/^[a-f\d]{32}$/;
function packet(bytes){try{return bytes.length<=512?JSON.parse(bytes.toString()):null;}catch{return null;}}
function bind(socket,port){return new Promise((resolve,reject)=>{
  socket.once('error',reject);socket.bind(port,'0.0.0.0',()=>{socket.off('error',reject);resolve();});
});}
function close(socket){try{socket.close();}catch{}}
export async function startDiscoveryResponder({hostId,port,discoveryPort=DISCOVERY_PORT}){
  const socket=dgram.createSocket({type:'udp4',reuseAddr:true}),recent=new Map();
  socket.on('error',()=>{});
  socket.on('message',(bytes,peer)=>{
    const query=packet(bytes);
    if(query?.format!==format||query.version!==1||query.kind!=='query'||!noncePattern.test(query.nonce))return;
    const now=Date.now();if(now-(recent.get(peer.address)??0)<100)return;
    if(recent.size>=64)recent.clear();recent.set(peer.address,now);
    const reply=Buffer.from(JSON.stringify({format,version:1,kind:'host',nonce:query.nonce,hostId,port}));
    socket.send(reply,peer.port,peer.address,()=>{});
  });
  try{await bind(socket,discoveryPort);}catch(error){close(socket);throw error;}
  return {close:()=>close(socket)};
}
function broadcastTargets(){
  const targets=new Set(['255.255.255.255','127.0.0.1']);
  for(const row of Object.values(networkInterfaces()).flat()){
    if(!row||row.internal||row.family!=='IPv4')continue;
    const address=row.address.split('.').map(Number),mask=row.netmask.split('.').map(Number);
    targets.add(address.map((part,index)=>(part|(~mask[index]&255))).join('.'));
  }
  return [...targets];
}
export async function discoverLanHosts({duration=1500,discoveryPort=DISCOVERY_PORT,targets=broadcastTargets()}={}){
  const socket=dgram.createSocket('udp4'),nonce=randomBytes(16).toString('hex'),found=new Map();
  socket.on('error',()=>{});
  socket.on('message',(bytes,peer)=>{
    const reply=packet(bytes);
    if(reply?.format!==format||reply.version!==1||reply.kind!=='host'||reply.nonce!==nonce
      ||!id.test(reply.hostId)||!Number.isInteger(reply.port)||reply.port<1024||reply.port>65535||found.size>=64)return;
    // Never trust an advertised URL: use the datagram source and bounded port.
    const endpoint=`http://${peer.address}:${reply.port}`;
    found.set(endpoint,{hostId:reply.hostId,endpoint});
  });
  try{
    await bind(socket,0);socket.setBroadcast(true);
    const query=Buffer.from(JSON.stringify({format,version:1,kind:'query',nonce}));
    for(const target of targets)socket.send(query,discoveryPort,target,()=>{});
    await new Promise(resolve=>setTimeout(resolve,duration));
    return [...found.values()].sort((a,b)=>a.endpoint.localeCompare(b.endpoint));
  }finally{close(socket);}
}
