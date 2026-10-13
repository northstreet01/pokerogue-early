import test from 'node:test';
import assert from 'node:assert/strict';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {safeContext,hooks} from './helpers/safe-model.mjs';
import {applySafeDecisionAction} from '../src/battle-core/safe-decisions.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import {pokemonRuleNodes} from '../src/battle-core/pokemon-state.mjs';

const apply=(c,seat,a)=>applySafeDecisionAction(c,seat,a,codec,safeCodec,hooks);
test('every remaining safe stop roundtrips independently without losing options or random state',()=>{
  for(const kind of ['starter-ready','evolution','map','preparation','ended']) {
    const c=safeContext(kind),saved=codec.capture(c),resumed=codec.restore(copy(saved));
    assert.deepEqual(codec.capture(resumed),saved,kind);
    assert.notEqual(resumed.roster.entries[0].pokemon,c.roster.entries[0].pokemon);
  }
});
test('map permits disagreement and changes until agreement; restored choices follow the same transition',async()=>{
  let a=safeContext('map'),b=codec.restore(codec.capture(a));
  for(const [seat,biome]of [[0,1],[1,2],[0,2]]) {
    const action={kind:'map',biome};const x=await apply(a,seat,action),y=await apply(b,seat,action);
    assert.deepEqual(y.events,x.events);assert.deepEqual(codec.capture(y.context),codec.capture(x.context));a=x.context;b=codec.restore(codec.capture(y.context));
  }
  assert.equal(b.arena.biomeType,2);assert.equal(b.decision.id,'battle-after-map');assert.equal(b.continuation.phaseQueuePrepend[0].phase.nextBiome,2);
});
test('independent preparation retains ready/reward/reroll flags, original HP modifier effects and RNG after every restore',async()=>{
  let a=safeContext('preparation'),b=codec.restore(codec.capture(a));
  const steps=[[0,{kind:'preparation',operation:'reroll'}],[0,{kind:'preparation',operation:'skip-reward'}],
    [0,{kind:'preparation',operation:'ready'}],[1,{kind:'preparation',operation:'reward',optionId:'reward-potion',pokemonId:101,moveIndex:null,fusionId:null}],
    [1,{kind:'preparation',operation:'buy',optionId:'shop-potion',pokemonId:101,moveIndex:null,fusionId:null}],
    [0,{kind:'preparation',operation:'reserve-swap',partyId:100,reserveId:190}],
    [1,{kind:'preparation',operation:'ready'}],[0,{kind:'preparation',operation:'ready'}]];
  for(const [seat,action]of steps){const x=await apply(a,seat,action),y=await apply(b,seat,action);assert.deepEqual(y.events,x.events);assert.deepEqual(codec.capture(y.context),codec.capture(x.context));a=x.context;b=codec.restore(codec.capture(y.context));}
  assert.equal(b.players[0].money,750);assert.equal(b.players[1].money,900);assert.equal(b.roster.entries[1].pokemon.hp,30);assert.equal(b.roster.field[0],190);
  assert.equal(b.decision.id,'battle-after-preparation');
});
test('original Pokemon evolution and cancel/pause states continue identically after JSON restore',async()=>{
  for(const choice of ['evolve','cancel']) {
    const original=safeContext('evolution'),before=codec.capture(original),resumed=codec.restore(copy(before));
    const action={kind:'evolution',pokemonId:100,choice};
    const a=await apply(original,0,action),b=await apply(resumed,0,action);assert.deepEqual(b.events,a.events);assert.deepEqual(codec.capture(b.context),codec.capture(a.context));
    if(choice==='evolve')assert.equal(b.context.roster.entries[0].pokemon.species.speciesId,2);
    else {
      const pause={kind:'evolution',pokemonId:100,choice:'pause'},next=await apply(codec.restore(codec.capture(b.context)),0,pause);
      assert.equal(next.context.roster.entries[0].pokemon.pauseEvolutions,true);assert.equal(next.context.decision.kind,'wait-actions');
    }
    assert.deepEqual(codec.capture(original),before);
  }
});
test('starter ready gate survives single confirmation and opens battle only after both',async()=>{
  const c=safeContext('starter-ready'),a=await apply(c,0,{kind:'starter-ready',ready:true});assert.equal(a.context.decision.kind,'starter-ready');
  const b=await apply(codec.restore(codec.capture(a.context)),1,{kind:'starter-ready',ready:true});assert.equal(b.context.decision.id,'battle-after-starters');
});
test('one player can prepare while the partner has a restored evolution subdecision',async()=>{
  const c=safeContext('preparation'),e=safeContext('evolution');
  c.roster.entries[0].pokemon=e.roster.entries[0].pokemon;
  c.decision.players[0].rewardResolved=true;c.decision.players[0].subdecision=e.decision;
  const skipped=await apply(c,1,{kind:'preparation',operation:'skip-reward'});
  const ready=await apply(skipped.context,1,{kind:'preparation',operation:'ready'});
  assert.equal(ready.context.decision.players[1].ready,true);
  const resumed=codec.restore(codec.capture(ready.context));
  const cancel=await apply(resumed,0,{kind:'evolution',pokemonId:100,choice:'cancel'});
  assert.equal(cancel.context.decision.kind,'preparation');assert.equal(cancel.context.decision.players[0].subdecision.stage,'pause-confirm');
  const paused=await apply(codec.restore(codec.capture(cancel.context)),0,{kind:'evolution',pokemonId:100,choice:'pause'});
  assert.equal(paused.context.decision.kind,'preparation');assert.equal(paused.context.decision.players[0].subdecision,null);
  assert.equal(paused.context.decision.players[1].ready,true);assert.equal(paused.context.roster.entries[0].pokemon.pauseEvolutions,true);
  const done=await apply(paused.context,0,{kind:'preparation',operation:'ready'});assert.equal(done.context.decision.id,'battle-after-preparation');
});
test('safe decision corruption, foreign resources, missing hooks and late failures keep previous state',async()=>{
  const c=safeContext('preparation'),before=codec.capture(c);
  const mutations=[s=>{s.decision.players[0].shop[0].cost=-1;},s=>{s.decision.players[0].rewards[0].type.catalogId='UNKNOWN';},
    s=>{s.decision.players[0].ready=true;},s=>{s.decision.players[0].selection={optionId:'shop-potion',pokemonId:101,moveIndex:null,fusionId:null};}];
  for(const change of mutations){const bad=copy(before);change(bad);assert.throws(()=>codec.restore(bad));assert.deepEqual(codec.capture(c),before);}
  const buy={kind:'preparation',operation:'buy',optionId:'shop-potion',pokemonId:101,moveIndex:null,fusionId:null};
  assert.throws(()=>safeCodec.validateAction(c,0,buy),/INVALID_PREPARATION_OWNER/);
  await assert.rejects(applySafeDecisionAction(c,1,buy,codec,safeCodec,{}),/HANDLER_UNAVAILABLE/);
  await assert.rejects(applySafeDecisionAction(c,1,buy,codec,safeCodec,{applyModifier(candidate){candidate.roster.entries[1].pokemon.hp=999;return {events:[],grants:[]};}}));
  assert.deepEqual(codec.capture(c),before);
});
test('cross-Pokemon mutable arrays and records retain identity; full aliases reject cycles and forged paths',()=>{
  const c=safeContext('map'),a=c.roster.entries[0].pokemon,b=c.roster.entries[1].pokemon;
  b.ivs=a.ivs;b.summonData.moveset=a.moveset;b.summonData.stats=a.stats;
  const saved=codec.capture(c),restored=codec.restore(saved),ra=restored.roster.entries[0].pokemon,rb=restored.roster.entries[1].pokemon;
  assert.equal(ra.ivs,rb.ivs);assert.equal(ra.moveset,rb.summonData.moveset);assert.equal(ra.stats,rb.summonData.stats);
  rb.summonData.moveset[0].ppUsed++;assert.equal(ra.moveset[0].ppUsed,3);
  const invalid=copy(saved);invalid.roster.ruleGroups[0][0].path=['scene'];assert.throws(()=>codec.restore(invalid),/INVALID_RULE_ALIAS/);
  assert.deepEqual(codec.capture(c),saved);
});
