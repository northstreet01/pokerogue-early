import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {forcedProgressionRoute} from './helpers/forced-progression-route.mjs';
import {localizedEventAudit} from './helpers/localized-event-audit.mjs';
before(()=>buildCoopRuntime());
test('VS24 independent one-seed 1–200 forced route: both owners fight one original Boss throughout both stages',async()=>{
 const output=process.env.VS24_OUTPUT??'build/vs02b24/classic-final';
 const restarts=Array.from({length:20},(_,i)=>i*10+11).filter(w=>w<=200);
 const r=await forcedProgressionRoute({untilVictory:true,seed:'learning-natural-2',output,restartWaves:restarts,
  replayWaves:[55,95,100,145,180,190,195,200],onWave:step=>console.log('VS24_CLASSIC_WAVE',JSON.stringify(step))});
 assert.equal(r.error,null,JSON.stringify(r.error));assert.equal(r.startedWave,1);assert.equal(r.reachedWave,200);
 assert.equal(r.victory,true);assert.equal(r.decision,'ended');assert.equal(r.terminalRestored,true);assert.deepEqual(r.restarts,restarts);
 assert.ok(r.finalBoss.length>2);
 const id=r.finalBoss[0].enemies[0].id;
 for(const s of r.finalBoss){assert.equal(s.double,true);assert.deepEqual(s.enemyLevels,[200]);assert.equal(s.enemies.length,1);assert.equal(s.enemies[0].id,id);assert.equal(s.field[3],null);}
 const first=r.finalBoss.find(s=>s.kind==='wait-actions'&&s.enemies[0].form===0);
 const second=r.finalBoss.find(s=>s.kind==='wait-actions'&&s.enemies[0].form===1);
 for(const s of [first,second]){assert.ok(s);assert.deepEqual(s.requiredSeats,[0,1]);for(const e of s.owners)assert.equal(s.field[e.owner],e.id);}
 for(const name of ['QuietFormChangePhase','FaintPhase','VictoryPhase','GameOverPhase'])assert.ok(r.phases[200].includes(name),name);
 assert.deepEqual(r.pendingCompletion.map(c=>c.owner).sort(),[0,1]);
 const claims=r.pendingVouchers.filter(c=>c.payload.originalId==='CLASSIC_VICTORY'||c.payload.fallbackCatalogId==='VOUCHER_PREMIUM');
 assert.deepEqual(claims.map(c=>c.owner).sort(),[0,1]);for(const c of claims){assert.equal(c.status,'pending');assert.equal(c.payload.count,1);}
 const audit=await localizedEventAudit(output+'/events.jsonl');await fs.writeFile(output+'/text-audit.json',JSON.stringify(audit,null,2));
 assert.deepEqual(audit.missing,[]);assert.deepEqual(audit.raw,[]);assert.deepEqual(audit.finalBossStages,['encounter','firstStageWin','secondStageWin']);
});
