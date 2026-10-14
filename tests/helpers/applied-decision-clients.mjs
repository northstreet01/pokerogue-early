import {codec} from './decision-model.mjs';
import {copy} from '../../src/battle-core/coop-contract.mjs';
import {createSnapshotConsumer} from '../../src/battle-core/coop-client.mjs';

// Reuses the native-switch dual-client applied-model harness. ACKs are held so
// tests can restart the service before each actual-model confirmation barrier.
export async function appliedDecisionClients(f,adapter,identities){
  const pair=[];
  for(const seat of [0,1]){
    const c=await f.client();pair.push(c);
    c.send(identities?{type:'resumeSeat',roomId:identities[seat].roomId,resumeToken:identities[seat].resumeToken}
      :seat===0?{type:'createRoom',name:'A'}:{type:'joinRoom',name:'B',roomId:pair[0].identity.roomId});
    c.identity=await c.wait(m=>m.type==='welcome');c.acks=[];
    c.consume=createSnapshotConsumer({versions:f.versions,isCurrent:e=>e===c.identity.connectionEpoch,send:m=>c.acks.push(m),adapter:{
      applySnapshot(s){const saved=copy(s.shared),r=s.personal.resources;
        saved.players[seat]={money:r.money,pokeballCounts:copy(r.pokeballCounts),modifiers:r.modifiers.map(state=>{const id=saved.components.length;saved.components.push({kind:'modifier',state});return id;})};
        c.model=codec.restore(saved);
      },captureAppliedState:()=>adapter.projectSnapshot(c.model,seat),async applyGrantsTransaction(g){if(g.length)throw Error('Fixture has no grants');}
    }});
  }
  for(const c of pair){c.snapshot=await c.wait(m=>m.type==='snapshot');await c.consume(c.snapshot);}
  return pair;
}
