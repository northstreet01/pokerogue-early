import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {forcedProgressionRoute} from './helpers/forced-progression-route.mjs';
import fs from 'node:fs/promises';
import {localizedEventAudit} from './helpers/localized-event-audit.mjs';

before(()=>buildCoopRuntime());
test('one user-authorized forced route completes original Classic waves 1–200 and the final victory',async()=>{
 const restarts=Array.from({length:20},(_,i)=>i*10+11).filter(w=>w<=200);
 const output=process.env.VS22U_OUTPUT??'build/vs02b22u/classic-final';
 const result=await forcedProgressionRoute({untilVictory:true,seed:'learning-natural-2',output,
  restartWaves:restarts,replayWaves:[55,95,100,145,180,190,195,200],
  onWave:async step=>{
   console.log('FORCED_CLASSIC_WAVE',JSON.stringify(step));
   if(step.wave%10===1){const audit=await localizedEventAudit(output+'/events.jsonl');assert.deepEqual(audit.missing,[]);assert.deepEqual(audit.raw,[]);}
  }});
 assert.equal(result.error,null,JSON.stringify(result.error));
 assert.equal(result.reachedWave,200);
 assert.equal(result.decision,'ended');assert.equal(result.victory,true);
 assert.equal(result.terminalRestored,true);
 assert.deepEqual(result.restarts,restarts);
 for(const wave of [55,95,145,180,190,195,200])assert.ok(result.phases[wave]?.includes('VictoryPhase'),`${wave} original victory`);
 assert.ok(result.phases[200]?.includes('GameOverPhase'),'original final game-over rules');
 assert.ok(result.phases[200]?.includes('QuietFormChangePhase'),'original final Boss second stage');
 assert.deepEqual(result.pendingCompletion.map(c=>c.owner).sort(),[0,1]);
 assert.equal(new Set(result.pendingVouchers.map(c=>c.id)).size,result.pendingVouchers.length);
 for(const claim of result.pendingVouchers){assert.equal(claim.status,'pending');assert.equal(claim.payload.resolve,'original-unlock-or-repeat');}
 const audit=await localizedEventAudit(output+'/events.jsonl');
 await fs.writeFile(output+'/text-audit.json',JSON.stringify(audit,null,2));
 assert.deepEqual(audit.missing,[]);assert.deepEqual(audit.raw,[]);
 assert.deepEqual(audit.finalBossStages,['encounter','firstStageWin','secondStageWin']);
 assert.ok(audit.forms.some(form=>form.wave===200&&form.species===890&&form.formIndex===1));
});
