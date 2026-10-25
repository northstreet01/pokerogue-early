import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {createOriginalRuleHost} from '../server/original-rule-host.mjs';
import {finalBossFixture,finalBossConfig,finalBossTrace} from './helpers/native-final-boss.mjs';
import {steadyInput} from './helpers/native-steady-progression.mjs';
let api,fixture,second;
before(async()=>{
 await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();
 fixture=await finalBossFixture(api);const trace=await finalBossTrace(api,fixture.checkpoint);
 second=trace.boundaries.find(c=>c.decision.kind==='wait-actions'&&c.roster.entries.find(e=>e.owner===null).pokemon.fields.formIndex===1);
});
for(const stage of ['first','second'])test(`VS24 normal original damage diagnosis at synthetic final Boss ${stage} stage, no immunity or lethal-damage host`,async()=>{
 let c=stage==='first'?fixture.checkpoint:second;assert.ok(c);
 const h=await createOriginalRuleHost(finalBossConfig),events=[],trace=[],id=c.battle.enemyParty[0];
 try{
  for(let n=0;n<100&&c.decision.kind!=='ended';n++){
   const inputs=steadyInput(api,c),kind=c.decision.kind;
   const op=kind==='continuing'?'native-run-to-boundary':['wait-actions','wait-target'].includes(kind)?'native-submit'
    :['learn-move','evolution'].includes(kind)?'native-progression':'native-switch';
   const payload=kind==='continuing'?c:op==='native-progression'?{checkpoint:c,seat:c.decision.requiredSeats[0],action:inputs[c.decision.requiredSeats[0]]}:{checkpoint:c,inputs};
   const r=await h.request(op,payload);events.push(...r.events);c=r.checkpoint;
   trace.push({step:n,kind:c.decision.kind,field:c.roster.field,hp:c.roster.entries.map(e=>({owner:e.owner,id:e.pokemon.fields.id,hp:e.pokemon.fields.hp}))});
   assert.deepEqual(c.battle.enemyParty,[id]);assert.equal(c.roster.field[3],null);
  }
  assert.equal(c.decision.kind,'ended');assert.equal(c.decision.reason,'defeat');assert.equal(c.decision.victory,false);
  assert.ok(events.some(e=>e.kind==='damage-display'&&e.amount>0));
  await fs.mkdir('build/vs02b24/normal-final',{recursive:true});
  await fs.writeFile(`build/vs02b24/normal-final/${stage}.json`,JSON.stringify({
   mode:'original damage, synthetic level-5 player teams at final encounter; not normal 1–200 difficulty proof',
   prefix:stage==='second'?'test-only accelerated first stage':'synthetic won-wave-199 boundary then original generation',
   realBrowser:false,realUserRoomModified:false,trace,events,terminal:c},null,2));
 }finally{await h.close();}
});
