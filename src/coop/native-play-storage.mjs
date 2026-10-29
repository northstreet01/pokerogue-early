import {createNativeStore} from '../platform/native-storage.mjs';
const seatKey=(origin,roomId,seat)=>`${origin}|${roomId}|${seat}`;
const actionKey=(origin,roomId,seat,id)=>`${seatKey(origin,roomId,seat)}|${id}`;
export function createNativePlayStorage(bridge){
  const seats=createNativeStore('seats',bridge),outbox=createNativeStore('outbox',bridge);
  const owned=(r,origin,session)=>session.isCurrent()&&r[`active:${origin}`]?.sessionId===session.id&&!r[`active:${origin}`].paused;
  const selected=(r,origin)=>Object.entries(r).filter(([key])=>key.startsWith(origin+'|'));
  return Object.freeze({
    async listSeats(origin){return selected(await seats.read(null),origin).map(([,v])=>v).filter(v=>/^[A-Z0-9]{6}$/i.test(v?.roomId)&&[0,1].includes(v.seat)&&typeof v.token==='string'&&v.token)
      .map(v=>({roomId:v.roomId,seat:v.seat,...(v.profileId?{profileId:v.profileId}:{}),...(typeof v.runId==='string'?{runId:v.runId}:{}),...(v.hostId?{hostId:v.hostId,endpoint:v.endpoint}:{}),...(v.summary?{summary:v.summary}:{}),...(typeof v.displayName==='string'?{displayName:v.displayName}:{})}));},
    async deleteSeat(origin,roomId,seat){
      const key=seatKey(origin,roomId,seat),active=`active:${origin}`;
      await seats.transact([key,active],r=>({changes:{[key]:null,
        ...(r[active]===key||r[active]?.key===key?{[active]:{key:null,paused:true}}:{})}}));
      // Delete the credential first. If cleanup fails, orphaned outbox rows
      // cannot restore/replay a seat; retrying this operation is idempotent.
      await outbox.transact(null,r=>({changes:Object.fromEntries(Object.keys(r).filter(k=>k.startsWith(key+'|')).map(k=>[k,null]))}));
      return true;
    },
    resumeSession(origin,session,roomId,seat){
      const key=seatKey(origin,roomId,seat),active=`active:${origin}`;
      return seats.transact([key,active],r=>{
        const value=r[key];if(!session.isCurrent()||value?.roomId!==roomId||value?.seat!==seat||!value?.token)return {changes:{},result:null};
        return {changes:{[active]:{sessionId:session.id,key,paused:false}},result:value};
      });
    },
    async loadSeat(origin){
      const r=await seats.read(null),active=r[`active:${origin}`];
      if(active&&typeof active==='object')return active.paused||!active.key?null:r[active.key]??null;
      if(active)return r[active]??null;const rows=selected(r,origin);return rows.length===1?rows[0][1]:null;
    },
    beginSession(origin,session,resume=false){
      return seats.transact(null,r=>{
        if(!session.isCurrent())return {changes:{},result:null};
        const active=r[`active:${origin}`];let key=null,value=null;
        if(resume){
          if(active&&typeof active==='object'&&(active.paused||!active.key))return {changes:{},result:null};
          key=typeof active==='string'?active:active?.key;
          if(key)value=r[key]??null;
          else{const rows=selected(r,origin);if(rows.length!==1)return {changes:{},result:null};[key,value]=rows[0];}
        }
        return {changes:{[`active:${origin}`]:{sessionId:session.id,key,paused:false}},result:value};
      });
    },
    pauseSession(origin,session){const active=`active:${origin}`;return seats.transact([active],r=>{
      if(r[active]?.paused)return {changes:{},result:true};
      if(r[active]?.sessionId&&r[active].sessionId!==session.id)return {changes:{},result:false};
      return {changes:{[active]:{sessionId:session.id,key:null,paused:true}},result:true};
    });},
    saveSeat(origin,value,session=null){const key=seatKey(origin,value.roomId,value.seat),active=`active:${origin}`;return seats.transact([key,active],r=>{
      if(session&&!owned(r,origin,session))return {changes:{},result:false};
      return {changes:{[key]:value,[active]:session?{sessionId:session.id,key,paused:false}:key},result:true};
    });},
    saveAction(origin,seat,message){const key=actionKey(origin,message.roomId,seat,message.actionId);return outbox.transact([key],()=>({changes:{[key]:message}}));},
    deleteAction(origin,roomId,seat,id){const key=actionKey(origin,roomId,seat,id);return outbox.transact([key],()=>({changes:{[key]:null}}));},
    async pendingActions(origin,roomId,seat){const prefix=seatKey(origin,roomId,seat)+'|';return Object.entries(await outbox.read(null)).filter(([key])=>key.startsWith(prefix)).map(([,v])=>v).sort((a,b)=>a.expectedRevision-b.expectedRevision);}
  });
}
