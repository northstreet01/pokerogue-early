import test from 'node:test';
import assert from 'node:assert/strict';
import {nextBattleContext,createNextBattle,advanceEntry,referenceNextBattle,referenceEntry,advanceCycle,nextPostPhase} from './helpers/next-battle-model.mjs';
import {chooseCycleInputs} from './helpers/command-cycle-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import fs from 'node:fs';
import {parse} from './helpers/original-model.mjs';
const saved=c=>copy(codec.capture(c));
test('original encounter changes consist only of observing and returning the existing Promise chain',()=>{
  const frozen=JSON.parse(fs.readFileSync(new URL('./fixtures/early-next-battle-reference.json',import.meta.url),'utf8'));
  const current=parse('phases.ts').statements.find(n=>n.name?.text==='EncounterPhase').members.find(n=>n.name?.getText()==='start').getText();
  const restored=current.replace('observeRulePromise(this.scene, Promise.all(loadEnemyAssets).then','Promise.all(loadEnemyAssets).then')
    .replace('return this.scene.ui.setMode(Mode.MESSAGE).then','this.scene.ui.setMode(Mode.MESSAGE).then')
    .replace('return this.scene.gameData.saveSystem().then','this.scene.gameData.saveSystem().then')
    .replace('return this.scene.gameData.saveSession(this.scene, true).then','this.scene.gameData.saveSession(this.scene, true).then')
    .replace(/\}\)\);\s*\}$/, '});\n  }');
  const normalize=s=>s.replace(/\r\n/g,'\n').trim();assert.equal(normalize(restored),normalize(frozen.phases.EncounterPhase.start));
  const scene=parse('battle-scene.ts').statements.find(n=>n.name?.text==='BattleScene');
  for(const [name,body]of Object.entries(frozen.scene))assert.equal(normalize(scene.members.find(n=>n.name?.getText()===name).getText()),normalize(body));
});
for(const wave of [1,2,3])test(`original NewBattle/encounter/entry wave ${wave+1} equals continuous frozen execution across JSON restores`,async()=>{
  const start=await nextBattleContext({wave}),before=saved(start),ref=await referenceNextBattle(codec.restore(before));
  let current=await createNextBattle(start);assert.deepEqual(current.events,ref.events);assert.deepEqual(saved(current.context),saved(ref.context));
  assert.deepEqual(saved(start),before);let c=codec.restore(saved(current.context)),r=ref.context;
  assert.equal(c.battle.enemyParty.length,2);assert.equal(c.battle.double,true);assert.equal(c.battle.turn,1);
  assert.equal(c.battle.playerParticipantIds.size,0);assert.equal(c.battle.seenEnemyPartyMemberIds.size,2);
  assert.ok(c.roster.retiredIds.includes(102));
  const seen=[];
  while(c.decision.kind==='continuing'){
    seen.push(nextPostPhase(c).constructor.name);const expected=await referenceEntry(r),actual=await advanceEntry(c);
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(saved(actual.context),saved(expected.context));
    c=codec.restore(saved(actual.context));r=expected.context;assert.ok(seen.length<12);
  }
  assert.deepEqual(seen,['PostSummonPhase','PostSummonPhase','ToggleDoublePositionPhase','CheckSwitchPhase','CheckSwitchPhase','TurnInitPhase']);
  assert.equal(c.decision.kind,'wait-actions');assert.deepEqual(c.decision.requiredSeats,[0,1]);
  assert.ok(c.decision.options[0].every(a=>a.pokemonId===100));assert.ok(c.decision.options[1].every(a=>a.pokemonId===101));
  assert.deepEqual([...c.battle.playerParticipantIds],[100,101]);
  const inputs=chooseCycleInputs(c);c=(await advanceCycle(c,inputs)).context;
  for(let i=0;i<60&&c.decision.kind==='continuing';i++)c=(await advanceCycle(c)).context;
  assert.equal(c.decision.kind,'wait-actions');assert.equal(c.battle.turn,2);
  assert.ok(c.roster.entries.slice(0,2).every(e=>e.pokemon.moveset[0].ppUsed===1));
});
for(const wave of [4,9,10,199])test(`special encounter wave ${wave+1} is rejected without touching source or RNG`,async()=>{
  const c=await nextBattleContext({wave}),before=saved(c);await assert.rejects(createNextBattle(c),/UNSUPPORTED_NEXT_BATTLE_BRANCH/);assert.deepEqual(saved(c),before);
});
for(const seat of [0,1])test(`seat ${seat} viable reserve retains original optional-switch gap instead of auto-declining`,async()=>{
  const c=await nextBattleContext();c.roster.entries.find(e=>e.owner===seat&&e.index===1).pokemon.hp=20;
  const before=saved(c);await assert.rejects(createNextBattle(c),/UNSUPPORTED_PRE_BATTLE_SWITCH/);assert.deepEqual(saved(c),before);
});
for(const phase of ['NewBattlePhase','NextEncounterPhase'])test(`${phase} tracked task rejection leaves previous battle, both resources, eggs and RNG intact`,async()=>{
  const c=await nextBattleContext(),before=saved(c);
  await assert.rejects(createNextBattle(c,{onBind:(_c,p,_b,t)=>{if(p.constructor.name===phase)t.add(Promise.reject(Error('creation-fault')));}}),/creation-fault/);
  assert.deepEqual(saved(c),before);assert.equal((await createNextBattle(c)).context.battle.waveIndex,2);
});
test('encounter Promise chain reports asset/save failures to the candidate observer',async()=>{
  for(const failure of ['asset','save']){
    const c=await nextBattleContext(),before=saved(c);
    await assert.rejects(createNextBattle(c,{onBind:(_c,p,b,t)=>{
      if(p.constructor!==originalPhases.NextEncounterPhase)return;
      if(failure==='save')b.scene.gameData.saveSystem=()=>Promise.reject(Error('save-fault'));
      else{const add=b.scene.addEnemyPokemon;b.scene.addEnemyPokemon=(...args)=>{const pk=add(...args);pk.loadAssets=()=>t.add(Promise.reject(Error('asset-fault')));return pk;};}
    }}),new RegExp(`${failure}-fault`));assert.deepEqual(saved(c),before);
  }
});
test('candidate creation rejects resource or partner HP modification',async()=>{
  for(const change of [c=>c.players[1].money--,c=>c.roster.entries[1].pokemon.hp--,
    c=>{c.roster.entries[1].pokemon.ivs=c.roster.entries[0].pokemon.ivs;}]){
    const c=await nextBattleContext(),before=saved(c);
    await assert.rejects(createNextBattle(c,{onBind:(c,p)=>{if(p.constructor===originalPhases.NextEncounterPhase)change(c);}}),/NEXT_BATTLE_(RESOURCE|PARTY|PARTY_ALIAS)_CHANGED/);
    assert.deepEqual(saved(c),before);
  }
});
test('creation cannot restart a completed encounter or cross pending hatch commit',async()=>{
  const c=await nextBattleContext(),r=(await createNextBattle(c)).context,before=saved(r);
  await assert.rejects(createNextBattle(r),/UNSAFE_NEXT_BATTLE_BOUNDARY/);assert.deepEqual(saved(r),before);
  c.pendingEffects.push({id:'blocked-hatch',phase:c.continuation.phaseQueue[0].phase,remaining:'start'});
  await assert.rejects(createNextBattle(c),/UNSAFE_NEXT_BATTLE_BOUNDARY/);
});
test('original encounter resets real battle data while v6 stays v6 without inventing egg inventory',async()=>{
  const c=await nextBattleContext();delete c.eggState;c.roster.entries[0].pokemon.battleData.hitCount=4;
  const before=saved(c),r=await createNextBattle(c);
  assert.equal(r.context.roster.entries[0].pokemon.battleData.hitCount,0);
  assert.equal(saved(r.context).version,6);assert.equal(Object.hasOwn(r.context,'eggState'),false);assert.deepEqual(saved(c),before);
});
test('original enemy item roll outside this slice fails the whole candidate rather than discarding its result',async()=>{
  const c=await nextBattleContext(),before=saved(c);
  await assert.rejects(createNextBattle(c,{onBind:(_c,p,b)=>{
    if(p.constructor===originalPhases.NextEncounterPhase)b.scene.gameMode.getEnemyModifierChance=()=>1;
  }}),/UNSUPPORTED_ENEMY_ITEM_ROLL/);assert.deepEqual(saved(c),before);
});
