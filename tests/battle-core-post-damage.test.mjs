import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {moves,arena} from './helpers/original-model.mjs';
import {abilityRules} from './helpers/move-execution-model.mjs';
import {damageRules} from './helpers/move-effect-model.mjs';
import {statContext,postEffectContext,advancePostDamage,runPostDamageReference,nextPostPhase,statRules,BattleSpec} from './helpers/post-damage-model.mjs';

for(const seat of [0,1])test(`original Damage display resumes without applying HP twice, owner=${seat}`,async()=>{
  const c=await postEffectContext(seat),before=codec.capture(c),hp=c.roster.entries.map(e=>e.pokemon.hp);
  assert.equal(nextPostPhase(c).constructor.name,'DamagePhase');
  const ref=await runPostDamageReference(codec.restore(before)),actual=await advancePostDamage(c);
  assert.deepEqual(actual.events,ref.events);assert.deepEqual(codec.capture(actual.context),codec.capture(ref.context));
  assert.deepEqual(actual.context.roster.entries.map(e=>e.pokemon.hp),hp);
  assert.equal(actual.events.filter(e=>e.kind==='damage-display').length,1);
  assert.deepEqual(codec.capture(c),before);
});

for(const seat of [0,1])test(`original StatChange restored execution matches frozen rules and RNG, owner=${seat}`,async()=>{
  const B=statRules.BattleStat;
  const scenarios=[{}, {levels:2,selfTarget:true}, {levels:-3,stage:-5}, {levels:2,stage:6},
    {stats:[B.ATK,B.DEF,B.ACC],levels:1}, {stats:[B.RAND],levels:1}, {showMessage:false}, {inactive:true}];
  for(const options of scenarios){
    const c=statContext(seat,options),saved=codec.capture(c);
    const expected=await runPostDamageReference(codec.restore(saved)),actual=await advancePostDamage(codec.restore(JSON.parse(JSON.stringify(saved))));
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(codec.capture(actual.context),codec.capture(expected.context));
    assert.deepEqual(codec.capture(c),saved);
    if(!options.inactive)assert.ok(actual.context.roster.entries[seat].pokemon.summonData.battleStats.every(n=>n>=-6&&n<=6));
  }
});

for(const seat of [0,1])test(`original multi-hit continues every Damage/effect boundary and stops at faint, owner=${seat}`,async()=>{
  for(const faint of [false,true]){
    const c=await postEffectContext(seat,moves.Moves.DOUBLE_SLAP,{faint}),saved=codec.capture(c);
    let actual=c,reference=codec.restore(saved),steps=0,displays=0;
    const initialHp=c.roster.entries[2].pokemon.hp;
    while(nextPostPhase(actual)&&nextPostPhase(actual).constructor.name!=='FaintPhase'){
      assert.ok(++steps<16);
      const hp=actual.roster.entries[2].pokemon.hp,kind=nextPostPhase(actual).constructor.name;
      const expected=await runPostDamageReference(reference);reference=expected.context;
      const result=await advancePostDamage(codec.restore(codec.capture(actual)));actual=result.context;
      assert.deepEqual(result.events,expected.events);assert.deepEqual(codec.capture(actual),codec.capture(reference));
      if(kind==='DamagePhase'){displays++;assert.equal(actual.roster.entries[2].pokemon.hp,hp);}
    }
    assert.ok(displays>=1);assert.ok(actual.roster.entries[2].pokemon.hp<=initialHp);
    if(faint){assert.equal(nextPostPhase(actual).constructor.name,'FaintPhase');const before=codec.capture(actual);
      await assert.rejects(advancePostDamage(actual),{code:'UNSUPPORTED_RULE_PHASE'});assert.deepEqual(codec.capture(actual),before);
    }else{assert.ok(displays>=2);assert.equal(actual.roster.entries[seat].pokemon.turnData.hitsLeft,0);}
    assert.deepEqual(codec.capture(c),saved);
  }
});

test('actual Growl queues and executes its original StatChange after effect restoration',async()=>{
  const c=await postEffectContext(0,moves.Moves.GROWL);
  assert.equal(nextPostPhase(c).constructor.name,'StatChangePhase');
  const actual=await advancePostDamage(c),expected=await runPostDamageReference(codec.restore(codec.capture(c)));
  assert.deepEqual(codec.capture(actual.context),codec.capture(expected.context));assert.deepEqual(actual.events,expected.events);
  assert.equal(actual.context.roster.entries[2].pokemon.summonData.battleStats[statRules.BattleStat.ATK],-1);
});

test('Damage handles native display result branches and final boss remains unsupported',async()=>{
  for(const result of [damageRules.HitResult.OTHER,damageRules.HitResult.ONE_HIT_KO,damageRules.HitResult.SUPER_EFFECTIVE,damageRules.HitResult.NOT_VERY_EFFECTIVE]){
    const c=await postEffectContext(),phase=nextPostPhase(c);phase.damageResult=result;phase.critical=true;
    const expected=await runPostDamageReference(codec.restore(codec.capture(c))),actual=await advancePostDamage(c);
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(codec.capture(actual.context),codec.capture(expected.context));
    if(result===damageRules.HitResult.ONE_HIT_KO)assert.deepEqual(actual.events.filter(e=>e.kind==='invert').map(e=>e.value),[true,false]);
  }
  const c=await postEffectContext();c.battle.battleSpec=BattleSpec.FINAL_BOSS;const before=codec.capture(c);
  await assert.rejects(advancePostDamage(c),{code:'UNSUPPORTED_RULE_PHASE'});assert.deepEqual(codec.capture(c),before);
});

test('late rule failures and invalid candidates retain old HP/stats/queue/RNG',async()=>{
  for(const c of [await postEffectContext(),statContext()]){
    const before=codec.capture(c);
    await assert.rejects(advancePostDamage(c,{onBind:(candidate,_phase,b)=>{
      candidate.players[0].money--;b.tasks.add(Promise.reject(Error('post-damage task failed')));
    }}),/post-damage task failed/);assert.deepEqual(codec.capture(c),before);
    await assert.rejects(advancePostDamage(c,{onBind:candidate=>{candidate.roster.entries[0].pokemon.hp=-1;}}));
    assert.deepEqual(codec.capture(c),before);
  }
});

test('original StatChange multiplier abilities and Mist preserve early rule ordering',async()=>{
  for(const [ability,selfTarget,want]of [[abilityRules.Abilities.SIMPLE,true,-2],[abilityRules.Abilities.CONTRARY,true,1]]){
    const c=statContext(0,{selfTarget});c.roster.entries[0].pokemon.summonData.ability=ability;
    const expected=await runPostDamageReference(codec.restore(codec.capture(c))),actual=await advancePostDamage(c);
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(codec.capture(actual.context),codec.capture(expected.context));
    assert.equal(actual.context.roster.entries[0].pokemon.summonData.battleStats[0],want);
  }
  for(const selfTarget of [false,true]){
    const c=statContext(1,{selfTarget});c.arena.tags=[new arena.MistTag(3,101,arena.ArenaTagSide.PLAYER)];
    const expected=await runPostDamageReference(codec.restore(codec.capture(c))),actual=await advancePostDamage(c);
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(codec.capture(actual.context),codec.capture(expected.context));
    assert.equal(actual.context.roster.entries[1].pokemon.summonData.battleStats[0],selfTarget?-1:0);
  }
});

test('post-damage candidates wait for their own asynchronous tasks after end',async()=>{
  const controls=[];
  const runs=[await postEffectContext(0),statContext(1)].map(c=>{
    let release,notify;const gate=new Promise(resolve=>{release=resolve;}),bound=new Promise(resolve=>{notify=resolve;});
    const control={release,bound,done:false,before:codec.capture(c),context:c};controls.push(control);
    return advancePostDamage(c,{onBind:(candidate,_phase,b)=>{
      b.tasks.add(gate.then(()=>{candidate.players[0].money--;}));notify();
    }}).then(result=>{control.done=true;return result;});
  });
  await Promise.all(controls.map(c=>c.bound));assert.deepEqual(controls.map(c=>c.done),[false,false]);
  controls[0].release();await runs[0];assert.equal(controls[1].done,false);
  controls[1].release();await runs[1];
  for(const c of controls)assert.deepEqual(codec.capture(c.context),c.before);
});
