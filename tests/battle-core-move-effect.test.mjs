import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {moves,status,battler} from './helpers/original-model.mjs';
import {effectContext,runDamage,runEffect,advanceEffect,nativeEffectDriver,damageRules} from './helpers/move-effect-model.mjs';
import {moveRules} from './helpers/move-execution-model.mjs';
import {observeRulePromise,createRuleTaskTracker} from '../src/battle-core/rule-task-tracker.mjs';
import {advanceQueuedMoveEffect} from '../src/battle-core/move-effect-runner.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';

test('actual Pokemon damage matches frozen apply for physical/special/fixed/status/immunity/burn and either owner',()=>{
  let cases=0;
  for(const seat of [0,1])for(const move of [moves.Moves.TACKLE,moves.Moves.EMBER,moves.Moves.SONIC_BOOM,moves.Moves.GROWL])for(const targetType of [damageRules.Type.NORMAL,damageRules.Type.GRASS,damageRules.Type.GHOST])for(const burn of [false,true]){
    const c=effectContext(seat,move,`damage-${seat}-${move}-${targetType}-${burn}`),p=c.roster.entries[seat].pokemon;
    c.roster.entries[2].pokemon.summonData.types=[targetType];if(burn)p.status=new status.Status(status.StatusEffect.BURN);
    const r=codec.restore(codec.capture(c));assert.deepEqual(runDamage(r,seat),runDamage(c,seat,true));assert.deepEqual(codec.capture(r),codec.capture(c));cases++;
  }
  assert.equal(cases,48);
});

test('original asynchronous effect stage preserves history, counters, HP and actual queued classes after JSON restore',async()=>{
  for(const seat of [0,1])for(const move of [moves.Moves.TACKLE,moves.Moves.EMBER,moves.Moves.SONIC_BOOM,moves.Moves.GROWL]){
    const c=effectContext(seat,move,`effect-${seat}-${move}`),before=codec.capture(c);
    const a=await runEffect(codec.restore(before),{reference:true,clone:false}),b=await runEffect(codec.restore(JSON.parse(JSON.stringify(before))),{clone:false});
    assert.deepEqual(b.events,a.events);assert.deepEqual(codec.capture(b.context),codec.capture(a.context));assert.deepEqual(codec.capture(c),before);
  }
});

test('effect candidates reject missing/unfinished/late-failing drivers without changing prior HP or RNG',async()=>{
  const c=effectContext(),before=codec.capture(c);
  const result=await advanceEffect(c);assert.ok(result.context.roster.entries[2].pokemon.hp<c.roster.entries[2].pokemon.hp);assert.deepEqual(codec.capture(c),before);
  await assert.rejects(advanceQueuedMoveEffect(c,codec,null),/MOVE_EFFECT_DRIVER_UNAVAILABLE/);
  await assert.rejects(advanceQueuedMoveEffect(c,codec,{...nativeEffectDriver,async execute(){return {completed:true,pendingTasks:1,events:[],grants:[]};}}),/INCOMPLETE_MOVE_EFFECT/);
  await assert.rejects(advanceQueuedMoveEffect(c,codec,{...nativeEffectDriver,async execute(candidate){candidate.roster.entries[2].pokemon.hp=999;return {completed:true,pendingTasks:0,events:[],grants:[]};}}));
  await assert.rejects(advanceQueuedMoveEffect(c,codec,{...nativeEffectDriver,async execute(candidate){candidate.battle.randSeedInt(100);throw Error('late effect');}}),/late effect/);
  assert.deepEqual(codec.capture(c),before);
});

test('effect history keeps its mutable target identity with Battle commands through restore',async()=>{
  const c=(await advanceEffect(effectContext())).context,p=c.roster.entries[0].pokemon;
  assert.equal(p.battleSummonData.moveHistory[0].targets,c.battle.turnCommands[0].move.targets);
  const saved=codec.capture(c),r=codec.restore(saved);
  assert.equal(r.roster.entries[0].pokemon.battleSummonData.moveHistory[0].targets,r.battle.turnCommands[0].move.targets);
  for(const mutate of [s=>{s.commandTargetGroups[0][1].pokemonId=999;},s=>{s.commandTargetGroups[0].push(s.commandTargetGroups[0][0]);},
    s=>{s.commandTargetGroups[0][1].path=['scene'];},s=>{s.battle.turnCommands[0].object.move.object.targets.array[0].value=1;}]){
    const bad=copy(saved);mutate(bad);const input=copy(bad);assert.throws(()=>codec.restore(bad));assert.deepEqual(bad,input);assert.deepEqual(codec.capture(c),saved);
  }
  const legacy=copy(saved);legacy.version=5;delete legacy.commandTargetGroups;assert.throws(()=>codec.restore(legacy),/VERSION_MISMATCH/);
});

test('original protection/miss/departed target/faint and first multi-hit retain the same pending rule phases',async()=>{
  const scenarios=[c=>{c.roster.entries[2].pokemon.summonData.tags.push(battler.getBattlerTag('PROTECTED',1));},
    c=>{c.roster.field[2]=null;},c=>{c.roster.entries[2].pokemon.hp=1;}];
  for(const setup of scenarios){
    const c=effectContext();setup(c);const saved=codec.capture(c);
    const a=await runEffect(codec.restore(saved),{reference:true}),b=await runEffect(codec.restore(saved));
    assert.deepEqual(b.events,a.events);assert.deepEqual(codec.capture(b.context),codec.capture(a.context));
  }
  const onBind=(_c,p)=>Object.defineProperty(p,'hitCheck',{value:()=>false,configurable:true});
  const a=await runEffect(effectContext(),{reference:true,onBind}),b=await runEffect(effectContext(),{onBind});
  assert.deepEqual(b.events,a.events);assert.deepEqual(codec.capture(b.context),codec.capture(a.context));
  const x=await runEffect(effectContext(0,moves.Moves.DOUBLE_SLAP),{reference:true}),y=await runEffect(effectContext(0,moves.Moves.DOUBLE_SLAP));
  assert.deepEqual(y.events,x.events);assert.deepEqual(codec.capture(y.context),codec.capture(x.context));
  assert.ok(y.context.continuation.phaseQueuePrepend.some(d=>d.phase.constructor.name==='MoveEffectPhase'));
});

test('effect candidates wait for returned rule tasks after Phase.end and interleaved rooms keep separate work',async()=>{
  const controls=[];
  const runs=[0,1].map(seat=>{
    let release,ended;const gate=new Promise(resolve=>{release=resolve;}),end=new Promise(resolve=>{ended=resolve;});
    const control={release,end,done:false};controls.push(control);
    return runEffect(effectContext(seat),{onBind(c,_p,b){
      b.scene.ruleTasks.add(gate.then(()=>{c.players[seat].money-=1;}));
      const finish=b.scene.shiftPhase;b.scene.shiftPhase=()=>{finish();ended();};
    }}).then(result=>{control.done=true;return result;});
  });
  await Promise.all(controls.map(c=>c.end));assert.deepEqual(controls.map(c=>c.done),[false,false]);
  controls[0].release();const a=await runs[0];assert.equal(a.context.players[0].money,99);assert.equal(controls[1].done,false);
  controls[1].release();const b=await runs[1];assert.equal(b.context.players[1].money,100);
});

test('a rejected actual move attribute cannot be hidden by allSettled or commit its partial target mutation',async()=>{
  const c=effectContext(),before=codec.capture(c),attrs=moveRules.allMoves[moves.Moves.TACKLE].attrs;
  const attr=new moveRules.MoveEffectAttr(false,moveRules.MoveEffectTrigger.POST_APPLY);
  attr.apply=(_user,target)=>{target.hp-=1;return Promise.reject(Error('attribute promise failed'));};
  attrs.push(attr);
  try{await assert.rejects(advanceEffect(c),/attribute promise failed/);assert.deepEqual(codec.capture(c),before);}
  finally{attrs.splice(attrs.indexOf(attr),1);}
});

test('unregistered single-player scene keeps original promise identity and trackers detach after a candidate',async()=>{
  const scene={},promise=Promise.resolve(1);assert.equal(observeRulePromise(scene,promise),promise);
  const tracker=createRuleTaskTracker(scene);assert.notEqual(observeRulePromise(scene,promise),promise);
  await tracker.drain();assert.equal(tracker.pendingTasks,0);tracker.close();assert.equal(observeRulePromise(scene,promise),promise);
});
