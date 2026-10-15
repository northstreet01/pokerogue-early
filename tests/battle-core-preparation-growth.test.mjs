import test from 'node:test';
import assert from 'node:assert/strict';
import {growthContext,growthIntent,growthChoice,executeGrowth,validateGrowth,optionAction,projectGrowth,restoreGrowth} from './helpers/preparation-growth-model.mjs';
import {codec,safeCodec} from './helpers/decision-model.mjs';
import {types} from './helpers/modifier-model.mjs';
import {advancePreparationGrowth} from '../src/battle-core/preparation-growth-runner.mjs';
import {progressionDriver} from './helpers/level-up-model.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import fs from 'node:fs';
import {parse} from './helpers/original-model.mjs';
const saved=c=>copy(codec.capture(c));
test('candy uses the unchanged original apply method rather than a new level or experience formula',()=>{
  const ref=JSON.parse(fs.readFileSync(new URL('./fixtures/early-preparation-growth-reference.json',import.meta.url),'utf8'));
  const cls=parse('modifier/modifier.ts').statements.find(n=>n.name?.text==='PokemonLevelIncrementModifier');
  assert.equal(cls.members.find(n=>n.name?.getText()==='apply').getText().replace(/\r\n/g,'\n'),ref.apply.replace(/\r\n/g,'\n'));
});
const cases=[{}, {seat:1,full:true}, {full:true,slot:null}, {level:15},
  {level:15,evolve:'cancel',pause:'pause'}, {level:15,evolve:'cancel',pause:'continue'},
  {level:15,pauseEvolutions:true}, {full:true,booster:10}, {all:true,level:15}, {all:true,full:true}];
for(const options of cases)test(`original candy growth preserves personal menus and shared NewBattle ${JSON.stringify(options)}`,async()=>{
  const seat=options.seat??0,initial=await growthContext({...options,pause:!!options.pauseEvolutions}),before=saved(initial),intent=growthIntent(initial,seat);
  let ref=(await executeGrowth(codec.restore(before),seat,intent,{reference:true})),actual=await executeGrowth(codec.restore(before),seat,intent);
  let steps=0;const events=[...actual.events];
  for(;;){assert.deepEqual(saved(actual.context),saved(ref.context));assert.deepEqual(actual.events,ref.events);
    const c=actual.context;
    assert.deepEqual(saved(c).continuation,before.continuation);assert.deepEqual(c.decision.players[1-seat],initial.decision.players[1-seat]);
    assert.equal(c.continuation.currentPhase,null);assert.equal(c.decision.kind,'preparation');
    if(c.decision.players[seat].subdecision===null)break;
    assert.ok(++steps<80);const a=growthChoice(c,seat,options);
    ref=await executeGrowth(ref.context,seat,a,{reference:true});actual=await executeGrowth(codec.restore(saved(c)),seat,a);events.push(...actual.events);
  }
  const c=actual.context,party=c.roster.entries.filter(e=>e.owner===seat&&e.group==='party');
  for(const [index,e]of party.entries())assert.equal(e.pokemon.level,(options.level??5)+(options.all||index===0?1+(options.booster??0):0));
  assert.ok(events.some(e=>e.kind==='level-stats'));assert.equal(c.decision.players[seat].rewardResolved,true);
  assert.notDeepEqual(party[0].pokemon.stats,initial.roster.entries.find(e=>e.pokemon.id===party[0].pokemon.id).pokemon.stats);
  assert.equal(c.pendingEffects.length,2);assert.equal(actual.grants.length,0);assert.deepEqual(saved(initial),before);
  await assert.rejects(executeGrowth(c,seat,intent),/INVALID_PREPARATION_OPTION/);
  const pk=party[0].pokemon;if(options.level===15)assert.equal(pk.species.speciesId,options.evolve==='cancel'||options.pauseEvolutions?1:2);
});
test('personal learning and evolution can overlap while the peer buys, readies and waits for both menus',async()=>{
  let c=await growthContext({full:true});c=(await executeGrowth(c,0,growthIntent(c))).context;
  assert.equal(c.decision.players[0].subdecision.kind,'learn-move');
  const pk=c.roster.entries.find(e=>e.owner===1&&e.index===0).pokemon;pk.level=15;pk.exp=3375;pk.levelExp=0;pk.hp=1;
  const t=types.modifierTypes.RARE_CANDY();t.id='RARE_CANDY';c.decision.players[1].rewards=[{id:'peer-candy',type:types.captureModifierTypeState(t),cost:0}];
  c=(await executeGrowth(c,1,growthIntent(c,1))).context;assert.equal(c.decision.players[1].subdecision.kind,'evolution');
  for(const seat of [0,1]){const wire=projectGrowth(c,seat),model=restoreGrowth({...copy(wire),seat});assert.deepEqual(copy(projectGrowth(model,seat)),copy(wire));
    assert.equal(model.context.pendingEffects.filter(e=>e.id.startsWith(`preparation-growth-${1-seat}-`)).length,0);
    assert.equal(wire.shared.battle.decision.players[1-seat].subdecision,null);}
  c=(await executeGrowth(c,1,growthChoice(c,1))).context;assert.equal(c.decision.players[0].subdecision.kind,'learn-move');
  c=(await executeGrowth(c,1,{kind:'preparation',operation:'ready'})).context;assert.equal(c.decision.players[1].ready,true);
  c=(await executeGrowth(c,1,optionAction(c,1,'buy','POTION',101))).context;assert.equal(c.decision.players[1].ready,false);
  while(c.decision.players[0].subdecision)c=(await executeGrowth(c,0,growthChoice(c,0))).context;
  for(const seat of [0,1])c=(await executeGrowth(c,seat,{kind:'preparation',operation:'ready'})).context;
  assert.equal(c.decision.kind,'continuing');assert.equal(c.decision.reason,'next-battle');assert.equal(c.pendingEffects.length,0);
});
test('both personal evolution callbacks retain each other original pending references across JSON restart',async()=>{
  let c=await growthContext({level:15});const t=types.modifierTypes.RARE_CANDY();t.id='RARE_CANDY';
  const pk=c.roster.entries.find(e=>e.owner===1&&e.index===0).pokemon;pk.level=15;pk.exp=3375;pk.levelExp=0;
  c.decision.players[1].rewards=[{id:'peer-candy',type:types.captureModifierTypeState(t),cost:0}];
  for(const seat of [0,1])c=(await executeGrowth(c,seat,growthIntent(c,seat))).context;
  assert.ok(c.decision.players.every(p=>p.subdecision.kind==='evolution'));
  for(const seat of [0,1]){const view=projectGrowth(c,seat);assert.deepEqual(copy(projectGrowth(restoreGrowth({...copy(view),seat}),seat)),copy(view));}
  c=(await executeGrowth(codec.restore(saved(c)),0,growthChoice(c,0))).context;
  assert.equal(c.decision.players[1].subdecision.kind,'evolution');
  c=(await executeGrowth(codec.restore(saved(c)),1,growthChoice(c,1))).context;
  assert.ok(c.decision.players.every(p=>p.subdecision===null));
  assert.deepEqual(c.roster.entries.filter(e=>e.owner!==null&&e.index===0).map(e=>e.pokemon.species.speciesId),[2,2]);
});
test('growth choice pure validation rejects foreign, invalid slots and replayed reward without changing RNG or attaching scenes',async()=>{
  let c=await growthContext({full:true});c=(await executeGrowth(c,0,growthIntent(c))).context;const before=saved(c);
  for(const [seat,a]of [[0,growthChoice(c,0,{slot:4})],[1,growthChoice(c,0)],[0,growthIntent(c)]]){
    assert.throws(()=>validateGrowth(c,seat,a));assert.deepEqual(saved(c),before);
  }
  assert.ok(c.roster.entries.every(e=>!Object.hasOwn(e.pokemon,'scene')));
});
test('growth async task and peer mutation failures keep the original candy, choices, stats and menu state',async()=>{
  for(const kind of ['effect','level','learn','evolve','pause']){
    let c=await growthContext({level:kind==='evolve'||kind==='pause'?15:5,full:kind==='learn'});
    let a=growthIntent(c);
    if(['learn','evolve','pause'].includes(kind)){c=(await executeGrowth(c,0,a)).context;a=growthChoice(c,0,{evolve:kind==='pause'?'cancel':'evolve'});}
    const before=saved(c),options=kind==='effect'?{updateInfo:()=>Promise.reject(Error('effect-failed'))}
      :{onProgressionBind:(_c,_p,_b,tasks)=>tasks.add(Promise.reject(Error('growth-failed')))};
    await assert.rejects(executeGrowth(c,0,a,options),/failed/);assert.deepEqual(saved(c),before);
  }
  const c=await growthContext(),before=saved(c);await assert.rejects(executeGrowth(c,0,growthIntent(c),{
    onProgressionBind:c=>{c.roster.entries.find(e=>e.owner===1).pokemon.hp--;}
  }),/CHANGED_PEER/);assert.deepEqual(saved(c),before);
  await assert.rejects(executeGrowth(c,0,growthIntent(c),{onProgressionBind:c=>{
    c.roster.entries.find(e=>e.owner===1).pokemon.ivs=c.roster.entries.find(e=>e.owner===0).pokemon.ivs;
  }}),/CHANGED_PEER/);assert.deepEqual(saved(c),before);
});
test('growth rejects forged owner, remaining method, missing original phase and absent choice driver',async()=>{
  let c=await growthContext({full:true});c=(await executeGrowth(c,0,growthIntent(c))).context;const before=saved(c);
  for(const change of [s=>s.pendingEffects.find(e=>e.id.startsWith('preparation-growth-')).phase.scope=1,
    s=>s.pendingEffects.find(e=>e.id.startsWith('preparation-growth-')).remaining='start',
    s=>s.pendingEffects=s.pendingEffects.filter(e=>!e.id.startsWith('preparation-growth-'))]){
    const wire=copy(before);change(wire);let bad;try{bad=codec.restore(wire);}catch{continue;}
    await assert.rejects(advancePreparationGrowth(bad,0,growthChoice(c,0),codec,safeCodec,progressionDriver()));
    assert.deepEqual(saved(c),before);
  }
  await assert.rejects(advancePreparationGrowth(c,0,growthChoice(c,0),codec,safeCodec,{}),/PROGRESSION_DRIVER_UNAVAILABLE/);
});
