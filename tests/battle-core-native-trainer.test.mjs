import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {createOriginalRuleHost} from '../server/original-rule-host.mjs';
import {defaultTrainerRoute,progressDefault} from './helpers/native-default-trainer.mjs';
import {owned} from './helpers/native-natural-learning.mjs';

before(()=>buildCoopRuntime());

test('fresh default collection reaches original wave five, restores Trainer callbacks and resumes both summons',async()=>{
  const route=await defaultTrainerRoute();let h=route.h;
  try{
    const before=structuredClone(route.c);
    const entered=await h.request('native-next',route.c);
    assert.deepEqual(route.c,before,'candidate does not mutate its source checkpoint');
    assert.equal(entered.checkpoint.battle.waveIndex,5);
    assert.equal(entered.checkpoint.battle.battleType,1);
    assert.equal(entered.checkpoint.battle.double,true);
    assert.deepEqual(entered.checkpoint.players,before.players);
    assert.deepEqual(entered.checkpoint.eggState,before.eggState);
    assert.deepEqual(entered.checkpoint.roster.field.slice(0,2),[null,null],'original Return awaits original Summon');
    const names=entered.events.filter(e=>e.kind==='phase-start').map(e=>e.phase);
    for(const name of ['NewBattlePhase','ReturnPhase','ShowTrainerPhase','NextEncounterPhase'])assert.ok(names.includes(name),name);
    await h.close();h=await createOriginalRuleHost(route.config);
    const restored=await h.request('native-next',JSON.parse(JSON.stringify(before)));
    assert.deepEqual(restored,entered,'same original trainer, variant, enemy party and RNG after restart');
    let c=(await h.request('native-run-to-boundary',entered.checkpoint)).checkpoint;
    assert.equal(c.decision.kind,'wait-actions');assert.deepEqual(c.decision.requiredSeats,[0,1]);
    assert.deepEqual(c.roster.field.slice(0,2),before.roster.field.slice(0,2));
    assert.ok(c.roster.field.slice(2).every(Number.isSafeInteger));
    assert.deepEqual(c.players,before.players);
    for(const seat of [0,1]){
      assert.ok(c.decision.options[seat].every(o=>o.kind!=='ball'));
      const frozen=structuredClone(c);
      await assert.rejects(h.request('native-validate',{checkpoint:c,seat,action:{kind:'ball',pokeballType:0,targetId:c.roster.field[2]}}),/INVALID_ACTION/);
      assert.deepEqual(c,frozen);
    }
    const inputs={};
    for(const seat of [0,1]){
      const moves=owned(c,seat)[0].pokemon.fields.moveset;
      inputs[seat]=c.decision.options[seat].find(o=>o.kind==='fight'&&[43,39,45].includes(moves[o.cursor]?.fields.moveId)
        &&(o.target===null||o.target>=2));
      assert.ok(inputs[seat],'original default status move keeps this test before the unsupported trainer faint boundary');
    }
    const pp=[0,1].map(seat=>owned(c,seat)[0].pokemon.fields.moveset[inputs[seat].cursor].fields.ppUsed);
    c=(await h.request('native-submit',{checkpoint:c,inputs})).checkpoint;
    const round=await h.request('native-run-to-boundary',c);c=round.checkpoint;
    assert.equal(c.decision.kind,'wait-actions');
    for(const seat of [0,1])assert.equal(owned(c,seat)[0].pokemon.fields.moveset[inputs[seat].cursor].fields.ppUsed,pp[seat]+1);
    assert.ok(round.events.some(e=>e.kind==='phase-start'&&e.phase==='EnemyCommandPhase'));
    assert.ok(round.events.some(e=>e.kind==='phase-start'&&e.phase==='MoveEffectPhase'));
  }finally{await h.close();}
});

test('default route resumes after a real trainer enemy faint without committing a failed candidate',async()=>{
  const {h,c:source}=await defaultTrainerRoute();
  try{
    let c=(await h.request('native-next',source)).checkpoint;
    c=(await h.request('native-run-to-boundary',c)).checkpoint;
    let sawFaint=false;
    for(let round=0;round<12;round++){
      const result=await progressDefault(h,c);
      const phases=result.events.filter(e=>e.kind==='phase-start').map(e=>e.phase);
      if(phases.includes('FaintPhase'))sawFaint=true;
      c=result.checkpoint;
      if(sawFaint&&c.decision.kind==='continuing')
        c=(await h.request('native-run-to-boundary',c)).checkpoint;
      if(sawFaint&&c.decision.kind==='wait-actions')break;
    }
    assert.ok(sawFaint,'ordinary trainer attacks must produce a real enemy faint');
    assert.equal(c.decision.kind,'wait-actions');
    assert.equal(c.battle.battleType,1);
  }finally{await h.close();}
});
