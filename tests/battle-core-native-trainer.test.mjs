import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {createOriginalRuleHost} from '../server/original-rule-host.mjs';
import {defaultTrainerRoute,defaultTrainerVictory,progressDefault} from './helpers/native-default-trainer.mjs';
import {owned} from './helpers/native-natural-learning.mjs';
import {trainerReserveFixture} from './helpers/native-trainer-reserve.mjs';

before(()=>buildCoopRuntime());

test('natural trainer prize persists owned original phases and cannot regrant seat zero after a phase restart',async()=>{
  const route=await defaultTrainerVictory();let h=route.h;
  try{
    const startingMoney=route.beforeVictory.players.map(p=>p.money),awardedMoney=startingMoney.map(money=>money+55);
    assert.deepEqual(route.c.players.map(p=>p.money),awardedMoney);
    let c=(await progressDefault(h,route.beforeVictory)).checkpoint,sawHalf=false,events=[];
    for(let n=0;n<160;n++){
      const front=c.continuation.phaseQueuePrepend.at(-1)??c.continuation.phaseQueue[0];
      if(front?.phase.type==='SelectModifierPhase')break;
      await h.close();h=await createOriginalRuleHost(route.config);
      const result=await h.request('native-step',c);c=result.checkpoint;events.push(...result.events);
      if(c.players[0].money===awardedMoney[0]&&c.players[1].money===startingMoney[1]){
        sawHalf=true;
        const remaining=[...c.continuation.phaseQueue,...c.continuation.phaseQueuePrepend].filter(d=>d.phase.type==='MoneyRewardPhase');
        assert.equal(remaining.length,1);assert.equal(remaining[0].phase.scope,1);
      }
    }
    assert.ok(sawHalf,'checkpoint after the first owned original award');
    assert.deepEqual(c.players.map(p=>p.money),awardedMoney);
    assert.equal(events.filter(e=>e.kind==='phase-start'&&e.phase==='MoneyRewardPhase').length,2);
    const normalize=value=>{const s=structuredClone(value);for(const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'])for(const d of s.continuation[key])delete d.phaseId;return s;};
    assert.deepEqual(normalize(c),normalize(route.c));
  }finally{await h.close();}
});

test('synthetic original boss victory preserves the unconfirmed voucher guard',async()=>{
  const {h,c}=await trainerReserveFixture({trainerType:200}); // original Brock config, not boss gameplay acceptance
  try{
    c.decision={id:'native-5-901',kind:'continuing',requiredSeats:[],reason:'effects'};
    c.continuation={currentPhase:null,standbyPhase:null,phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,
      phaseQueue:[{kind:'original-phase',phaseId:901,remaining:'start',phase:{version:1,type:'TrainerVictoryPhase',scope:null,presentation:{},fields:{}}}]};
    const before=structuredClone(c);
    await assert.rejects(h.request('native-run-to-boundary',c),/VOUCHER_POLICY_UNCONFIRMED/);
    assert.deepEqual(c,before);
  }finally{await h.close();}
});

test('synthetic unowned money phase cannot bypass the owned original award split',async()=>{
  const {h,c}=await trainerReserveFixture();
  try{
    c.decision={id:'native-5-902',kind:'continuing',requiredSeats:[],reason:'effects'};
    c.continuation={currentPhase:null,standbyPhase:null,phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,
      phaseQueue:[{kind:'original-phase',phaseId:902,remaining:'start',phase:{version:1,type:'MoneyRewardPhase',scope:null,presentation:{},
        fields:{moneyMultiplier:{presence:'value',value:0.5}}}}]};
    for(const operation of ['native-run-to-boundary','native-step'])await assert.rejects(h.request(operation,c),/INVALID_TRAINER_MONEY_SCOPE/);
  }finally{await h.close();}
});

for(const variant of [0,2])test(`original Breeder party restores enemy replacement and owner slots variant=${variant}`,async()=>{
  const route=await trainerReserveFixture({variant});let h=route.h;
  try{
    const before=route.c,inputs=(await progressDefault(h,before)).checkpoint;
    assert.equal(before.battle.enemyParty.length,4,'original Breeder template includes two reserves');
    const continuous=await h.request('native-run-to-boundary',inputs);
    assert.equal(continuous.checkpoint.decision.kind,'wait-actions');
    assert.ok(continuous.events.some(e=>e.kind==='phase-start'&&e.phase==='FaintPhase'));
    assert.ok(continuous.events.some(e=>e.kind==='phase-start'&&e.phase==='SwitchSummonPhase'));
    assert.ok(continuous.events.some(e=>e.kind==='phase-start'&&e.phase==='PostSummonPhase'));
    const replacements=continuous.checkpoint.roster.field.slice(2).filter(id=>!before.roster.field.includes(id));
    assert.ok(replacements.length>0);
    for(const id of replacements)assert.ok(before.battle.enemyParty.slice(2).includes(id));
    assert.deepEqual(continuous.checkpoint.roster.field.slice(0,2),before.roster.field.slice(0,2));
    assert.deepEqual(continuous.checkpoint.players,before.players);
    await h.close();h=await createOriginalRuleHost(route.config);
    const restored=await h.request('native-run-to-boundary',JSON.parse(JSON.stringify(inputs)));
    assert.deepEqual(restored,continuous);
    let stepped=inputs,phases=[];
    for(let n=0;n<120&&stepped.decision.kind==='continuing';n++){
      await h.close();h=await createOriginalRuleHost(route.config);
      const result=await h.request('native-step',stepped);stepped=result.checkpoint;phases.push(...result.events);
    }
    const semantic=value=>{
      const saved=structuredClone(value);
      for(const key of ['currentPhase','standbyPhase'])if(saved.continuation[key])delete saved.continuation[key].phaseId;
      for(const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'])for(const d of saved.continuation[key])delete d.phaseId;
      return saved;
    };
    // Fresh per-phase binding allocates local phase IDs after an empty queue;
    // compare all rule state, scope/queue order, decision ID and events exactly.
    assert.deepEqual(semantic(stepped),semantic(continuous.checkpoint),'fresh Worker at every original phase');
    assert.deepEqual(phases,continuous.events);
    assert.ok(phases.some(e=>e.kind==='phase-start'&&e.phase==='SwitchSummonPhase'));
  }finally{await h.close();}
});

test('two synthetic trainer faints cannot summon the last reserve twice or run dead post-summon abilities',async()=>{
  const {h,c}=await trainerReserveFixture({trainerType:10,template:1,frontHp:0});
  try{
    const fields=value=>Object.fromEntries(Object.entries(value).map(([key,value])=>[key,{presence:'value',value}]));
    const reserve=c.battle.enemyParty[2];
    c.decision={id:'native-5-900',kind:'continuing',requiredSeats:[],reason:'effects'};
    c.continuation={currentPhase:null,standbyPhase:null,phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,
      phaseQueue:[2,3].map((n,i)=>({kind:'original-phase',phaseId:900+i,remaining:'start',phase:{version:1,type:'FaintPhase',scope:null,presentation:{},
        fields:fields({battlerIndex:n,player:false,fieldIndex:n-2,preventEndure:true})}}))};
    const result=await h.request('native-run-to-boundary',c);
    assert.equal(result.checkpoint.decision.kind,'wait-actions');
    assert.equal(result.checkpoint.roster.field.filter(id=>id===reserve).length,1);
    assert.equal(result.events.filter(e=>e.kind==='phase-start'&&e.phase==='PostSummonPhase').length,1);
    assert.equal(result.events.filter(e=>e.kind==='enemy-switch-cancelled'&&e.reason==='no-reserve').length,1);
  }finally{await h.close();}
});

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
    assert.ok(entered.events.some(e=>e.kind==='dialogue'&&e.text));
    const view=await h.request('native-project',{checkpoint:entered.checkpoint,seat:0});
    assert.ok(view.shared.trainer.name);
    assert.equal(typeof view.shared.trainer.spriteKey,'string');
    assert.equal(Object.hasOwn(view.shared,'enemyParty'),false,'public projection must not leak the enemy party');
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
    const animation=round.events.find(e=>e.kind==='battle-animation');
    assert.ok(animation,'the round must expose a replayable animation event');
    assert.ok(animation.sourceId&&animation.targetId);
    assert.ok(animation.moveId!==undefined||animation.commonAnim!==undefined);
    const messages=round.events.filter(e=>e.kind==='message').map(e=>String(e.text));
    assert.ok(messages.every(text=>!text.includes('undefined')),'restored Pokemon display names must be rebuilt for original messages');
  }finally{await h.close();}
});

test('synthetic original CommonAnimPhase exports its real commonAnim and stable Pokemon ids',async()=>{
  const h=await createOriginalRuleHost({seed:'review-common-animation',identity:{trainerId:1,secretId:2}});
  try{
    const c=(await h.request('native-open-to-input',{parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}})).checkpoint;
    const value=value=>({presence:'value',value});
    c.decision={id:'native-1-901',kind:'continuing',requiredSeats:[],reason:'effects'};
    c.continuation={currentPhase:null,standbyPhase:null,phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,
      phaseQueue:[{kind:'original-phase',phaseId:901,remaining:'start',phase:{version:1,type:'CommonAnimPhase',scope:null,presentation:{},
        fields:{anim:value(0),targetIndex:value(0),battlerIndex:value(0),player:value(true),fieldIndex:value(0)}}}]};
    const result=await h.request('native-step',c);
    const event=result.events.find(e=>e.kind==='battle-animation');
    assert.equal(event.animation,'CommonBattleAnim');assert.equal(event.commonAnim,0);
    assert.equal(event.sourceId,c.roster.field[0]);assert.equal(event.targetId,c.roster.field[2]);
    assert.deepEqual(result.checkpoint.players,c.players);
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

test('default route splits the original trainer prize, prepares and naturally fights the following wild encounter',async()=>{
  const {h,c:source}=await defaultTrainerRoute();
  try{
    const awardedMoney=source.players.map(p=>p.money+55);
    let c=(await h.request('native-next',source)).checkpoint;
    c=(await h.request('native-run-to-boundary',c)).checkpoint;
    const events=[];
    for(let boundary=0;boundary<45;boundary++){
      const result=await progressDefault(h,c);events.push(...result.events);c=result.checkpoint;
      if(c.battle.waveIndex===6&&c.decision.kind==='wait-actions')break;
    }
    assert.equal(c.battle.waveIndex,6);assert.equal(c.battle.battleType,0);
    assert.deepEqual(c.players.map(p=>p.money),awardedMoney);
    assert.equal(events.filter(e=>e.kind==='phase-start'&&e.phase==='MoneyRewardPhase').length,2);
    // Personal switch/EXP/level messages now also have their correct owner.
    // Count the two original money awards by their original localization key.
    assert.equal(events.filter(e=>e.kind==='message'&&e.scope===0&&e.presentation?.key==='battle:moneyWon').length,1);
    assert.equal(events.filter(e=>e.kind==='message'&&e.scope===1&&e.presentation?.key==='battle:moneyWon').length,1);
    const submitted=(await progressDefault(h,c)).checkpoint;
    const round=await h.request('native-run-to-boundary',submitted);
    assert.ok(round.events.some(e=>e.kind==='phase-start'&&e.phase==='MoveEffectPhase'));
    assert.deepEqual(round.checkpoint.players.map(p=>p.money),awardedMoney);
  }finally{await h.close();}
});
