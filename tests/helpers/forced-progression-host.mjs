import {Worker} from 'node:worker_threads';

/** Explicit opt-in diagnostic host; never installed in a production service. */
export async function forcedProgressionHost(config){
 const worker=new Worker(new URL('../fixtures/forced-progression-worker.mjs',import.meta.url),{
  workerData:config,execArgv:[],stdout:true,stderr:true});
 worker.stdout.resume();worker.stderr.resume();
 const pending=new Map();let sequence=0,closed=false;
 let readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const rejectAll=error=>{readyReject(error);for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();};
 worker.on('error',rejectAll);worker.on('exit',code=>{if(!closed)rejectAll(Error('FORCED_WORKER_EXIT_'+code));});
 worker.on('message',message=>{
  if(message.type==='ready'){readyResolve();return;}
  const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);
  if(message.error)p.reject(Object.assign(Error(message.error),{code:message.error,detail:message.detail}));else p.resolve(message.value);
 });
 await ready;
 return {request(operation,payload){return new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('FORCED_OPERATION_TIMEOUT_'+operation));},30000);
  pending.set(id,{resolve,reject,timer});worker.postMessage({id,operation,payload});
 });},async close(){closed=true;rejectAll(Error('FORCED_HOST_CLOSED'));await worker.terminate();}};
}
