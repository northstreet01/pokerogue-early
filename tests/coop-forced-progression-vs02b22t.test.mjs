import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {forcedProgressionRoute} from './helpers/forced-progression-route.mjs';

before(()=>buildCoopRuntime());
for(const seed of ['learning-natural-2','steady-0'])test(`user-authorized forced combat completes original waves 1 through 55 with dual WS, disk restarts and model ACKs: ${seed}`,async()=>{
 const result=await forcedProgressionRoute({seed,output:`build/vs02b22t/final-${seed}`,onWave:step=>console.log('FORCED_WAVE',JSON.stringify({seed,...step}))});
 assert.equal(result.error,null,JSON.stringify(result.error));
 assert.equal(result.reachedWave,56);assert.equal(result.decision,'wait-actions');
 assert.deepEqual(result.restarts,[11,21,31,41,51,56]);
 for(const wave of [25,30,40,50,55])assert.ok(result.phases[wave].includes('VictoryPhase'),`wave ${wave} original victory`);
 for(const wave of [10,20,30,40,50])for(const phase of ['SwitchBiomePhase','NewBiomeEncounterPhase','PartyHealPhase'])assert.ok(result.phases[wave].includes(phase),`${wave} ${phase}`);
 const claims=result.pendingVouchers;
 assert.ok(claims.length>=4,'both original gym victories retain the two owned entitlements');
 assert.equal(new Set(claims.map(c=>c.id)).size,claims.length);
 for(const claim of claims){assert.equal(claim.status,'pending');assert.equal(claim.payload.resolve,'original-unlock-or-repeat');}
 for(const claim of claims.filter(c=>c.owner===0))assert.ok(claims.some(c=>c.owner===1&&c.payload.id===claim.payload.id));
});
