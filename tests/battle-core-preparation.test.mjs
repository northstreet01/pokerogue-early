import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationContext,openMenus,referenceMenus,choosePreparation,atPreparationEnd,projectPreparation,restorePreparation} from './helpers/preparation-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {types} from './helpers/modifier-model.mjs';
import {coopRewardExclusions} from '../src/battle-core/preparation-runner.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import ts from 'typescript';
import {parse} from './helpers/original-model.mjs';
import {preparationDriver} from './helpers/preparation-model.mjs';
const saved=c=>copy(codec.capture(c)),act=operation=>({kind:'preparation',operation});
for(const options of [{},{emptySeat:0},{emptySeat:1},{rows:[[8],[9]]}])
test(`original personal reward menus equal frozen start and restore without redrawing ${JSON.stringify(options)}`,async()=>{
  const c=await preparationContext(options),before=saved(c),expected=await referenceMenus(codec.restore(before)),calls=[];
  const {context:r}=await openMenus(c,{onStart:seat=>calls.push(seat)});assert.deepEqual(saved(r),saved(expected));assert.deepEqual(calls,[0,1]);
  assert.deepEqual(saved(c),before);assert.equal(r.decision.kind,'preparation');assert.equal(r.pendingEffects.length,2);
  for(const seat of [0,1]){assert.equal(r.pendingEffects[seat].phase.constructor,originalPhases.SelectModifierPhase);
    assert.equal(saved(r).pendingEffects[seat].phase.scope,seat);assert.equal(r.decision.players[seat].rewards.length,3);
    for(const option of r.decision.players[seat].rewards){assert.ok(!coopRewardExclusions.includes(option.type.catalogId));assert.doesNotThrow(()=>types.restoreModifierTypeState(option.type));}}
  const roundtrip=codec.restore(saved(r));assert.deepEqual(saved(roundtrip),saved(r));
  await assert.rejects(openMenus(roundtrip,{onStart:()=>calls.push(9)}),/UNSAFE_PREPARATION_BOUNDARY/);assert.deepEqual(calls,[0,1]);
  assert.equal(r.continuation.phaseQueue[0].phase.constructor,originalPhases.NewBattlePhase);
});
test('personal skip and readiness reuse M2, keep partner flags and retain the original next battle queue',async()=>{
  let c=(await openMenus(await preparationContext())).context;const baseline=saved(c),rng=baseline.sceneRandom,queue=baseline.continuation;
  await assert.rejects(async()=>choosePreparation(c,0,act('ready')),/UNRESOLVED_PREPARATION/);
  c=(await choosePreparation(c,0,act('skip-reward'))).context;c=(await choosePreparation(c,0,act('ready'))).context;
  assert.equal(c.decision.players[1].rewardResolved,false);assert.equal(c.decision.players[0].ready,true);
  c=codec.restore(saved(c));c=(await choosePreparation(c,0,act('unready'))).context;
  c=(await choosePreparation(c,1,act('skip-reward'))).context;c=(await choosePreparation(c,1,act('ready'))).context;
  assert.equal(c.decision.kind,'preparation');c=(await choosePreparation(c,0,act('ready'))).context;
  assert.ok(atPreparationEnd(c));assert.equal(c.pendingEffects.length,0);assert.deepEqual(saved(c).continuation,queue);
  assert.equal(saved(c).sceneRandom,rng);assert.deepEqual(saved(c).players,baseline.players);assert.deepEqual(saved(c).eggState,baseline.eggState);
});
test('reward, shopping and reroll effects are explicitly unavailable and do not use M2 test handlers',async()=>{
  const c=(await openMenus(await preparationContext())).context;c.players[0].money=1000;
  const before=saved(c),p=c.decision.players[0];
  for(const a of [act('reroll'),{kind:'preparation',operation:'reward',optionId:p.rewards[0].id,pokemonId:null,moveIndex:null,fusionId:null},
    {kind:'preparation',operation:'buy',optionId:p.shop[0].id,pokemonId:100,moveIndex:null,fusionId:null}]){
    await assert.rejects(async()=>choosePreparation(c,0,a),/PREPARATION_EFFECT_UNAVAILABLE/);assert.deepEqual(saved(c),before);
  }
});
test('personal menu private view restores own original options while hiding peer choices',async()=>{
  const c=(await openMenus(await preparationContext())).context;
  for(const seat of [0,1]){const view=projectPreparation(c,seat),model=restorePreparation({...copy(view),seat});
    assert.deepEqual(copy(projectPreparation(model,seat)),copy(view));
    assert.equal(view.shared.battle.decision.players[1-seat].rewards.length,0);
    assert.deepEqual(model.context.decision.players[seat],c.decision.players[seat]);
    assert.equal(model.context.decision.players[1-seat].rewards.length,0);
  }
});
test('second menu failure or inventory mutation keeps both menus, RNG, pools and old queue unpublished',async()=>{
  const c=await preparationContext(),before=saved(c);
  for(const onMenuBind of [(_c,_p,_b,tasks,{seat})=>{if(seat===1)tasks.add(Promise.reject(Error('second menu')));},
    c=>{c.players[0].money++;},c=>{c.players[0].pokeballCounts[0]++;}]){
    await assert.rejects(openMenus(c,{onMenuBind}));assert.deepEqual(saved(c),before);
  }
});
test('coop excludes all three double-encounter lures before drawing while the original solo weights remain',async()=>{
  const source=parse('modifier/modifier-type.ts'),pool=source.statements.find(n=>ts.isVariableStatement(n)
    &&n.declarationList.declarations.some(d=>d.name.getText()==='modifierPool')).declarationList.declarations[0].initializer;
  const indexes=pool.properties.flatMap((p,tier)=>p.initializer.expression.expression.elements.flatMap((item,index)=>{
    const id=item.arguments[0].getText().split('.').at(-1);return coopRewardExclusions.includes(id)?[{tier,index,id}]:[];
  }));assert.equal(indexes.length,3);
  const c=await preparationContext();await preparationDriver({exclusions:[]}).openPersonalMenu(c,null,{seat:0});
  const solo=copy(c.modifierPools),{context:coop}=await openMenus(await preparationContext());
  for(const {tier,index}of indexes){assert.ok(!solo.ignoredPoolIndexes[tier].includes(index));
    assert.ok(Object.values(solo.modifierPoolThresholds[tier]).includes(index));
    assert.ok(coop.modifierPools.ignoredPoolIndexes[tier].includes(index));
    assert.ok(!Object.values(coop.modifierPools.modifierPoolThresholds[tier]).includes(index));}
});
test('a queued hatch or missing NewBattle cannot be skipped by the preparation bridge',async()=>{
  const hatch=await preparationContext({rows:[[1],[]]}),before=saved(hatch);
  await assert.rejects(openMenus(hatch),/UNSUPPORTED_PREPARATION_PHASE/);assert.deepEqual(saved(hatch),before);
  let c=(await openMenus(await preparationContext())).context;
  for(const seat of [0,1])c=(await choosePreparation(c,seat,act('skip-reward'))).context;
  c=(await choosePreparation(c,0,act('ready'))).context;c.continuation.phaseQueue=[];const broken=saved(c);
  await assert.rejects(choosePreparation(c,1,act('ready')),/NEXT_BATTLE_PHASE_MISSING/);assert.deepEqual(saved(c),broken);
});
