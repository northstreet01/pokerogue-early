import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {pokemon,status,moves,battler} from './helpers/original-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {actionContext,runAction,runHitCheck,abilityRules,advanceAction,nativeMoveDriver} from './helpers/move-execution-model.mjs';
import {advanceQueuedMoveAction} from "./helpers/reference-rules/move-action-runner.mjs";

test('paralysis and confusion check once per action with original 1/4 and 1/2 outcomes for either seat',()=>{
 for(const seat of [0,1])for(const effect of ['paralysis','confusion']){
  const range=effect==='paralysis'?4:2;let blocked=0;
  for(let roll=0;roll<range;roll++){
   const c=actionContext(seat),p=c.roster.entries[seat].pokemon;let phase,checks=0;
   if(effect==='paralysis')p.status=new status.Status(status.StatusEffect.PARALYSIS);
   else p.summonData.tags=[battler.getBattlerTag('CONFUSED',3,moves.Moves.CONFUSE_RAY,p.id)];
   runAction(c,{onBind:(_c,current)=>{phase=current;const random=current.pokemon.randSeedInt.bind(current.pokemon);
    // Audit the pre-action chance only. The headless codec intentionally lacks
    // the visual confusion phase; downstream move effects have separate tests.
    current.scene.unshiftPhase=()=>{};
    current.scene.getCurrentPhase=()=>current;
    current.pokemon.damageAndUpdate=amount=>{current.pokemon.hp-=amount;};
    current.pokemon.randSeedInt=(size,...args)=>{if(size===range){checks++;return roll;}return random(size,...args);};}});
   assert.equal(checks,1,`${effect} must not roll once per player or repeat on replay`);
   if(phase.cancelled)blocked++;
  }
  assert.equal(blocked,1);
 }
});

test('co-op cancelled attack explains a departed target without changing the original PP, RNG or result',()=>{
  const c=actionContext(0);c.roster.entries.find(e=>c.roster.field[2]===e.pokemon.id).pokemon.hp=0;
  const solo=runAction(c),coop=runAction(c,{onBind:(_c,_p,b)=>{b.scene.nativeIndependentCommands=true;}});
  assert.deepEqual(codec.capture(coop.context),codec.capture(solo.context));
  assert.equal(coop.events.filter(e=>e.kind==='message'&&e.text.includes('battle:attackNoTarget')).length,1);
  assert.equal(solo.events.some(e=>e.kind==='message'&&e.text.includes('battle:attackNoTarget')),false);
});

test('native MovePhase consumes PP/status/history and queues the same effects as frozen source for either owner',()=>{
  const cases=[()=>{},(c,p)=>{p.hp=0;},(c,p)=>{p.moveset[0].ppUsed=p.moveset[0].getMovePp();},
    (c,p)=>{p.summonData.disabledMove=p.moveset[0].moveId;},(c,p)=>{c.roster.field[2]=null;},
    (c,p)=>{p.summonData.moveQueue=[{move:moves.Moves.NONE,targets:[2],ignorePP:true}];},
    (c,p)=>{p.summonData.moveQueue=[{move:p.moveset[0].moveId,targets:[2],ignorePP:true}];},
    (c,p)=>{p.status=new status.Status(status.StatusEffect.SLEEP,0,2);},
    (c,p)=>{p.status=new status.Status(status.StatusEffect.SLEEP,1,2);},
    (c,p)=>{p.status=new status.Status(status.StatusEffect.PARALYSIS);},
    (c,p)=>{p.status=new status.Status(status.StatusEffect.FREEZE);},
    c=>{c.roster.entries[2].pokemon.summonData.ability=abilityRules.Abilities.PRESSURE;},
    (c,p)=>{p.summonData.ability=abilityRules.Abilities.MOLD_BREAKER;}];
  let total=0;
  for(const seat of [0,1])for(const seed of ['action-0','action-1','action-2','action-3'])for(const setup of cases){
    const c=actionContext(seat,seed);setup(c,c.roster.entries[seat].pokemon);
    const before=codec.capture(c),original=codec.restore(before),resumed=codec.restore(JSON.parse(JSON.stringify(before)));
    const a=runAction(original,{reference:true,clone:false}),b=runAction(resumed,{clone:false});
    assert.deepEqual(b.events,a.events);assert.deepEqual(codec.capture(b.context),codec.capture(a.context));assert.deepEqual(codec.capture(c),before);total++;
  }
  assert.equal(total,104);
});

test('original accuracy stage preserves early-outs, stat stages and exact Battle RNG across restore',()=>{
  let total=0;
  for(const seat of [0,1])for(const accuracy of [-6,-2,0,3,6])for(const evasion of [-6,0,6])for(const moveId of [moves.Moves.TACKLE,moves.Moves.SWIFT,moves.Moves.GROWL]){
    const c=actionContext(seat,`hit-${seat}-${accuracy}-${evasion}-${moveId}`),p=c.roster.entries[seat].pokemon;
    p.moveset[0]=new pokemon.PokemonMove(moveId,0,0,false);p.summonData.battleStats[5]=accuracy;c.roster.entries[2].pokemon.summonData.battleStats[6]=evasion;
    const saved=codec.capture(c),r=codec.restore(saved);
    const phase=x=>new originalPhases.MoveEffectPhase({},seat,[2],x.roster.entries[seat].pokemon.moveset[0]);
    assert.deepEqual(runHitCheck(r,phase(r),102),runHitCheck(c,phase(c),102,true));
    assert.deepEqual(codec.capture(r),codec.capture(c));total++;
  }
  assert.equal(total,90);
  for(const laterHit of [false,true]){
    const c=actionContext(),p=c.roster.entries[0].pokemon;p.turnData.hitCount=3;p.turnData.hitsLeft=laterHit?2:3;
    const r=codec.restore(codec.capture(c)),phase=x=>new originalPhases.MoveEffectPhase({},0,[2],x.roster.entries[0].pokemon.moveset[0]);
    assert.deepEqual(runHitCheck(r,phase(r),102),runHitCheck(c,phase(c),102,true));assert.deepEqual(codec.capture(r),codec.capture(c));
  }
});

test('queued original action runner preserves command-target/move identity and fails without replacing old state',()=>{
  const c=actionContext(),before=codec.capture(c),reference=runAction(codec.restore(before),{reference:true,clone:false});
  const result=advanceAction(c);assert.deepEqual(result.events,reference.events);
  const effect=result.context.continuation.phaseQueuePrepend.find(d=>d.phase instanceof originalPhases.MoveEffectPhase).phase;
  assert.equal(effect.targets,result.context.battle.turnCommands[0].move.targets);assert.equal(effect.move,result.context.roster.entries[0].pokemon.moveset[0]);
  assert.deepEqual(codec.capture(c),before);
  assert.throws(()=>advanceQueuedMoveAction(c,codec,null),/MOVE_DRIVER_UNAVAILABLE/);
  assert.throws(()=>advanceQueuedMoveAction(c,codec,{...nativeMoveDriver,supports:()=>false}),/UNSUPPORTED_MOVE_ACTION/);
  assert.throws(()=>advanceQueuedMoveAction(c,codec,{...nativeMoveDriver,execute(candidate){candidate.roster.entries[0].pokemon.hp=999;return {completed:true,events:[],grants:[]};}}));
  assert.throws(()=>advanceQueuedMoveAction(c,codec,{...nativeMoveDriver,execute(){return {completed:false,events:[],grants:[]};}}),/INCOMPLETE_MOVE_ACTION/);
  assert.deepEqual(codec.capture(c),before);
});
