import assert from 'node:assert/strict';
import {createOriginalCoopAdapter} from '../../server/original-coop-adapter.mjs';
import {formalFixture} from './formal-ws.mjs';
import {createSnapshotConsumer} from '../../src/battle-core/coop-client.mjs';
import {createOriginalClientModel} from '../../src/coop/original-client-model.mjs';

export async function until(predicate,label){
  for(let n=0;n<2400;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
  throw Error(`WAIT_TIMEOUT: ${label}`);
}
export async function openPreparationRoom({api,checkpoint,store,old=null,stage='preparation'}){
  const seed=checkpoint.scene.seed,identities=[{trainerId:1,secretId:2},{trainerId:3,secretId:4}];
  const provisioning={seed,identities,...(checkpoint.decision.shared?{sharedPreparation:true}:{})};
  const original=createOriginalCoopAdapter({fixture:{...provisioning,parties:[[909,7],[906,7]],eggState:{players:[[],[]]}}});
  // Explicit trusted checkpoint injection. Never claim this is a natural draw
  // or an end-to-end browser lobby; all subsequent effects use the real Worker.
  const failures=[],groups=[];
  const adapter={...original,async advanceToDecision(...args){try{return await original.advanceToDecision(...args);}catch(error){failures.push(error.code??error.message);throw error;}},
    createInitialContext:({runId})=>original.restoreCheckpoint({formatVersion:2,runId,stage,provisioning,lobby:null,nativeCheckpoint:structuredClone(checkpoint),intents:[]})};
  const server=await formalFixture(adapter,store);
  async function connectPair(tokens=null,holdSeat=null){
    const pair=[];groups.push(pair);
    for(const seat of [0,1]){
      const client=await server.client(),model=createOriginalClientModel(api);
      const state={...client,model,latest:null,ready:false,errors:[],identity:null,chain:Promise.resolve(),holdAck:seat===holdSeat,acks:[]};
      let epoch;
      const consumer=createSnapshotConsumer({versions:server.versions,adapter:model,isCurrent:value=>value===epoch,
        send:message=>state.holdAck?state.acks.push(message):client.send(message)});
      client.socket.on('message',data=>{
        const message=JSON.parse(data.toString());
        state.chain=state.chain.then(async()=>{
          if(message.type==='snapshot'){epoch=message.connectionEpoch;state.ready=false;assert.equal(await consumer(message),true);state.latest=message;}
          else if(message.type==='syncStatus'&&message.revision===state.latest?.revision)state.ready=!message.blocked;
          else if(message.type==='error')state.errors.push(message.code);
        }).catch(error=>state.errors.push(error.message));
      });
      if(tokens)client.send({type:'resumeSeat',roomId:tokens[seat].roomId,resumeToken:tokens[seat].resumeToken});
      else client.send(seat===0?{type:'createRoom',name:'persistent-owner'}:{type:'joinRoom',roomId:pair[0].identity.roomId,name:'persistent-peer'});
      state.identity=await client.wait(message=>message.type==='welcome'&&message.roomId||message.type==='error');
      assert.equal(state.identity.type,'welcome',state.identity.code);pair.push(state);
    }
    await until(()=>pair.every(client=>client.latest&&(holdSeat!==null||client.ready))||pair.some(c=>c.errors.length),'verified personal models');
    assert.deepEqual(pair.flatMap(c=>c.errors),[]);return pair;
  }
  const close=async()=>{await server.close();await original.closeAll();await Promise.all(groups.flat().map(client=>client.chain));};
  try{const pair=await connectPair(old);return {pair,server,adapter,failures,connectPair,close};}
  catch(error){await close();throw error;}
}
export function request(client,action){const s=client.latest;return {type:'submitAction',roomId:s.roomId,runId:s.runId,decisionId:s.decisionId,expectedRevision:s.revision,actionId:crypto.randomUUID(),action};}
export async function raw(client,action){const message=request(client,action);client.send(message);
  const receipt=await client.wait(reply=>reply.type==='actionReceipt'&&reply.actionId===message.actionId);assert.equal(receipt.accepted,true,receipt.code);return message;}
export async function advance(pair,seat,action){const revision=pair[seat].latest.revision,message=await raw(pair[seat],action);
  await until(()=>pair.every(client=>client.latest.revision>revision&&client.ready)||pair.some(c=>c.errors.length),'committed persistent effect');
  assert.deepEqual(pair.flatMap(c=>c.errors),[]);return message;}
