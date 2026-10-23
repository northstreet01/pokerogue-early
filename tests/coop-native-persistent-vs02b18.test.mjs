import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {createOriginalRuleHost} from '../server/original-rule-host.mjs';
import {defaultTrainerRoute,progressDefault} from './helpers/native-default-trainer.mjs';
import {canonical} from '../src/battle-core/coop-contract.mjs';

let api;
before(async()=>{await buildCoopRuntime();api=createRequire(import.meta.url)('../build/coop-runtime/original-runtime.cjs');api.describeOriginalCatalogs();});
const json=value=>JSON.parse(JSON.stringify(value));
function sameCheckpoint(actual,expected){
  const paths=[];
  const walk=(a,b,path)=>{
    // Queue-local descriptor allocation differs between continuous execution
    // and reopening a binding per phase; the original phase/body/state must match.
    if(path.startsWith('checkpoint.continuation.')&&path.endsWith('.phaseId'))return;
    if(canonical(a??null)===canonical(b??null))return;
    if(a&&b&&typeof a==='object'&&typeof b==='object')for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],`${path}.${key}`);
    else paths.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  walk(actual,expected,'checkpoint');assert.deepEqual(paths,[]);
}

test('natural default wave two basic attacks execute the enemy berry and survive every queued checkpoint',async()=>{
  const {h,initial,config}=await defaultTrainerRoute();
  let restart;
  try{
    let c=initial;
    for(let n=0;n<70&&c.decision.kind!=='preparation';n++)c=(await progressDefault(h,c)).checkpoint;
    assert.equal(c.decision.kind,'preparation');
    for(const seat of [0,1])for(const operation of ['skip-reward','ready'])
      c=(await h.request('native-prepare-action',{checkpoint:c,seat,action:{kind:'preparation',operation}})).checkpoint;
    for(let n=0;n<35&&!(c.battle.waveIndex===2&&c.decision.kind==='wait-actions');n++)c=(await progressDefault(h,c)).checkpoint;
    assert.equal(c.battle.waveIndex,2);assert.equal(c.decision.kind,'wait-actions');
    const inputs=Object.fromEntries(c.decision.requiredSeats.map(seat=>[seat,c.decision.options[seat].find(o=>o.kind==='fight'&&(o.target===null||o.target>=2))]));
    assert.deepEqual(Object.values(inputs).map(o=>o.cursor),[0,0]);
    c=(await h.request('native-submit',{checkpoint:c,inputs})).checkpoint;
    const baseline=await h.request('native-run-to-boundary',c);
    restart=await createOriginalRuleHost(config);
    let berry=false,events=[];
    for(let n=0;n<120;n++){
      const result=await restart.request('native-step',json(c));events.push(...result.events);c=result.checkpoint;
      berry ||= result.events.some(e=>e.phase==='BerryPhase');
      // Every stage, including after consumption and before healing, is a real
      // JSON restart boundary rather than replaying the berry from turn start.
      const resumed=c.decision.kind==='continuing'?await h.request('native-run-to-boundary',json(c)):{checkpoint:c};
      sameCheckpoint(resumed.checkpoint,baseline.checkpoint);
      if(c.decision.kind!=='continuing')break;
    }
    assert.ok(berry);assert.ok(['wait-actions','wait-switch'].includes(c.decision.kind));
    assert.equal(api.originalDecisionStateCodec.restore(c).enemyModifiers.length,0,'naturally generated enemy berry was consumed');
    sameCheckpoint(c,baseline.checkpoint);
    assert.equal(events.filter(e=>e.phase==='BerryPhase'&&e.kind==='phase-start').length,1);
  }finally{await h.close();await restart?.close();}
});

let base;
async function preparation(){
  if(!base){
    const route=await defaultTrainerRoute();
    try{let c=route.initial;for(let n=0;n<70&&c.decision.kind!=='preparation';n++)c=(await progressDefault(route.h,c)).checkpoint;
      assert.equal(c.decision.kind,'preparation');base={checkpoint:c,config:route.config};
    }finally{await route.h.close();}
  }
  return {h:await createOriginalRuleHost(base.config),c:json(base.checkpoint)};
}
const own=(c,seat)=>c.roster.entries.filter(e=>e.owner===seat&&e.group==='party');
function factory(id,c,seat,args=[0]){
  let type=api.modifierTypes[id]().withIdFromFunc(api.modifierTypes[id]);
  if(type.generateType)type=type.generateType(own(c,seat).map(e=>api.restorePokemonState(e.pokemon)),args);
  return type;
}
function reward(c,seat,id,{args=[0],existing=0,tier}={}){
  const type=factory(id,c,seat,args),pokemon=api.restorePokemonState(own(c,seat)[0].pokemon);
  if(tier!==undefined)type.tier=tier;
  const targeted=typeof type.selectFilter==='function';
  const modifier=type.newModifier(...(targeted?[pokemon]:[]));
  if(existing){modifier.stackCount=existing;const restored=api.originalDecisionStateCodec.restore(c);restored.players[seat].modifiers.push(modifier);c=api.originalDecisionStateCodec.capture(restored);}
  const option=c.decision.players[seat].rewards[0];option.type=api.captureModifierTypeState(type);c.decision.players[seat].rewardResolved=false;
  return {c,type,modifier,action:{kind:'preparation',operation:'reward',optionId:option.id,pokemonId:targeted?pokemon.id:null,moveIndex:null,fusionId:null}};
}

for(const seat of [0,1])for(const id of ['EXP_CHARM','HEALING_CHARM','EXP_SHARE','GOLDEN_POKEBALL','AMULET_COIN',
  'LUCKY_EGG','BASE_STAT_BOOSTER','ATTACK_TYPE_BOOSTER','BERRY','TEMP_STAT_BOOSTER','SOUL_DEW','BERRY_POUCH'])
test(`native original persistent ${id} seat ${seat}: stacks, pure validation, Worker restart and peer isolation`,async()=>{
  const prepared=await preparation(),h=prepared.h;let second;
  try{
    const {c,action}=reward(prepared.c,seat,id,{existing:1}),before=canonical(c);
    await h.request('native-validate-preparation',{checkpoint:c,seat,action});assert.equal(canonical(c),before);
    if(action.pokemonId!==null)await assert.rejects(h.request('native-validate-preparation',{checkpoint:c,seat,
      action:{...action,pokemonId:own(c,1-seat)[0].pokemon.fields.id}}),/INVALID_PREPARATION_OWNER/);
    const first=await h.request('native-prepare-action',{checkpoint:c,seat,action});
    second=await createOriginalRuleHost(base.config);
    const restarted=await second.request('native-prepare-action',{checkpoint:json(c),seat,action});
    assert.equal(canonical(first),canonical(restarted));assert.equal(canonical(c),before);
    const model=api.originalDecisionStateCodec.restore(first.checkpoint);
    assert.equal(model.players[seat].modifiers[0].stackCount,2);
    assert.equal(canonical(first.checkpoint.players[1-seat]),canonical(c.players[1-seat]));
    assert.equal(canonical(first.checkpoint.roster.entries.filter(e=>e.owner!==seat)),canonical(c.roster.entries.filter(e=>e.owner!==seat)));
    assert.equal(first.checkpoint.sceneRandom,c.sceneRandom);
    await assert.rejects(h.request('native-prepare-action',{checkpoint:first.checkpoint,seat,action}),/REWARD_ALREADY_RESOLVED|INVALID_PREPARATION_OPTION/);
  }finally{await h.close();await second?.close();}
});

for(const seat of [0,1])test(`native full global replacement and original held cap seat ${seat}`,async()=>{
  const {h,c:initial}=await preparation();
  try{
    // Explicit synthetic tier-two original fallback, matching the frozen M3 case.
    const global=reward(initial,seat,'GOLDEN_POKEBALL',{existing:3,tier:2});
    const next=(await h.request('native-prepare-action',{checkpoint:global.c,seat,action:global.action})).checkpoint;
    assert.equal(api.originalDecisionStateCodec.restore(next).players[seat].modifiers[0].stackCount,3);
    assert.equal(next.players[seat].pokeballCounts[2],global.c.players[seat].pokeballCounts[2]+5);
    const held=reward(json(base.checkpoint),seat,'LUCKY_EGG',{existing:99});const before=canonical(held.c);
    await assert.rejects(h.request('native-validate-preparation',{checkpoint:held.c,seat,action:held.action}),/INVALID_PREPARATION_TARGET/);
    await assert.rejects(h.request('native-prepare-action',{checkpoint:held.c,seat,action:held.action}),/INVALID_PREPARATION_TARGET/);
    assert.equal(canonical(held.c),before);
  }finally{await h.close();}
});

async function acquire(h,c,seat,id,options){
  const input=reward(c,seat,id,options);
  return (await h.request('native-prepare-action',{checkpoint:input.c,seat,action:input.action})).checkpoint;
}
async function nextInput(h,c){
  for(const seat of [0,1]){
    if(!c.decision.players[seat].rewardResolved)c=(await h.request('native-prepare-action',{checkpoint:c,seat,action:{kind:'preparation',operation:'skip-reward'}})).checkpoint;
    c=(await h.request('native-prepare-action',{checkpoint:c,seat,action:{kind:'preparation',operation:'ready'}})).checkpoint;
  }
  for(let n=0;n<40&&c.decision.kind!=='wait-actions';n++)c=(await progressDefault(h,c)).checkpoint;
  assert.equal(c.decision.kind,'wait-actions');assert.equal(c.battle.waveIndex,2);return c;
}
async function nextPreparation(h,c){
  c=await nextInput(h,c);
  for(let n=0;n<80&&c.decision.kind!=='preparation';n++)c=(await progressDefault(h,c)).checkpoint;
  assert.equal(c.decision.kind,'preparation');return c;
}

for(const seat of [0,1])test(`native acquired healing/money boosters, vitamin and nature affect real original effects seat ${seat}`,async()=>{
  const {h,c:initial}=await preparation();
  try{
    let healing=await acquire(h,json(initial),seat,'HEALING_CHARM');
    // Explicit synthetic HP capacity isolates the original Potion multiplier
    // from the low-level default starter's full-HP clamp.
    own(healing,seat)[0].pokemon.fields.stats[0]=100;
    own(healing,seat)[0].pokemon.fields.hp=1;
    const input=reward(healing,seat,'POTION');input.action.pokemonId=own(healing,seat)[0].pokemon.fields.id;
    const treated=(await h.request('native-prepare-action',{checkpoint:input.c,seat,action:input.action})).checkpoint;
    assert.equal(own(treated,seat)[0].pokemon.fields.hp,Math.min(own(healing,seat)[0].pokemon.fields.stats[0],23));
    assert.ok(own(treated,seat)[0].pokemon.fields.hp>Math.min(own(healing,seat)[0].pokemon.fields.stats[0],21));
    const regular=reward(json(initial),seat,'NUGGET');
    const normal=(await h.request('native-prepare-action',{checkpoint:regular.c,seat,action:regular.action})).checkpoint;
    const money=await acquire(h,json(initial),seat,'AMULET_COIN');
    const boosted=await acquire(h,money,seat,'NUGGET');
    assert.ok(boosted.players[seat].money-money.players[seat].money>normal.players[seat].money-initial.players[seat].money);
    const vitamin=reward(json(initial),seat,'BASE_STAT_BOOSTER',{existing:9});
    const stats=await h.request('native-prepare-action',{checkpoint:vitamin.c,seat,action:vitamin.action});
    const before=own(initial,seat)[0].pokemon.fields,after=own(stats.checkpoint,seat)[0].pokemon.fields;
    assert.ok(after.stats[0]>before.stats[0]);assert.equal(after.hp-before.hp,after.stats[0]-before.stats[0]);
    const natureInput=json(initial);own(natureInput,seat)[0].pokemon.fields.nature=3; // Explicit synthetic Adamant condition.
    const natureBase=await acquire(h,natureInput,seat,'EXP_CHARM');
    const soul=await acquire(h,natureBase,seat,'SOUL_DEW',{existing:4});
    assert.notDeepEqual(own(soul,seat)[0].pokemon.fields.stats,own(natureBase,seat)[0].pokemon.fields.stats);
  }finally{await h.close();}
});

for(const seat of [0,1])for(const id of ['EXP_CHARM','LUCKY_EGG','EXP_SHARE','GOLDEN_POKEBALL'])
test(`native acquired ${id} changes next ordinary battle EXP/menu seat ${seat}`,async()=>{
  const {h,c:initial}=await preparation();
  try{
    // Both branches start from identical synthetic restored HP/status, so an
    // item on a naturally fainted starter is tested while it can receive EXP.
    for(const entry of initial.roster.entries.filter(e=>e.owner!==null)){
      const p=api.restorePokemonState(entry.pokemon);p.hp=p.getMaxHp();p.resetStatus();entry.pokemon=api.capturePokemonState(p);
    }
    const baseline=await nextPreparation(h,json(initial));
    const acquired=await acquire(h,json(initial),seat,id);
    const next=await nextPreparation(h,acquired);
    if(id==='GOLDEN_POKEBALL'){
      assert.equal(next.decision.players[seat].rewards.length,baseline.decision.players[seat].rewards.length+1);
      assert.equal(next.decision.players[1-seat].rewards.length,baseline.decision.players[1-seat].rewards.length);
    }else{
      const index=id==='EXP_SHARE'?1:0;
      const targetId=own(initial,seat)[index].pokemon.fields.id;
      const experience=c=>own(c,seat).find(e=>e.pokemon.fields.id===targetId).pokemon.fields.exp;
      assert.ok(experience(next)>experience(baseline),`${id} target ${targetId}: ${experience(baseline)} -> ${experience(next)}`);
      assert.deepEqual(own(next,1-seat).map(e=>e.pokemon.fields.exp),own(baseline,1-seat).map(e=>e.pokemon.fields.exp));
    }
    const view=await h.request('native-project',{checkpoint:next,seat});
    assert.equal(view.personal.resources.modifiers.length,1);
    const peer=await h.request('native-project',{checkpoint:next,seat:1-seat});
    assert.deepEqual(peer.personal.resources.modifiers,[]);
  }finally{await h.close();}
});

for(const seat of [0,1])for(const id of ['ATTACK_TYPE_BOOSTER','TEMP_STAT_BOOSTER'])
test(`native acquired ${id} increases original normal attack damage seat ${seat}`,async()=>{
  const {h,c:initial}=await preparation();
  try{
    const acquired=await acquire(h,json(initial),seat,id),variants=[await nextInput(h,json(initial)),await nextInput(h,acquired)];
    const damage=[];
    for(let c of variants){
      const inputs=Object.fromEntries(c.decision.requiredSeats.map(owner=>[owner,c.decision.options[owner].find(o=>o.kind==='fight'&&(o.target===null||o.target>=2))]));
      c=(await h.request('native-submit',{checkpoint:c,inputs})).checkpoint;
      const result=await h.request('native-run-to-boundary',c);
      damage.push(own(result.checkpoint,seat)[0].pokemon.fields.turnData.fields.damageDealt);
    }
    assert.ok(damage[1]>damage[0],`${id} original damage ${damage}`);
  }finally{await h.close();}
});

for(const seat of [0,1])for(const [berryType,condition]of [[0,'hp'],[1,'status'],[3,'stat'],[9,'random-stat'],[10,'pp']])
test(`original TurnEnd consumes acquired berry ${condition} only for seat ${seat}, including JSON stage resume`,async()=>{
  const {h,c:initial}=await preparation();
  try{
    let c=await acquire(h,json(initial),seat,'BERRY',{args:[berryType]});
    c=await nextInput(h,c);
    const target=own(c,seat)[0].pokemon.fields;
    if(['hp','stat','random-stat'].includes(condition))target.hp=Math.max(1,Math.floor(target.stats[0]/5));
    if(condition==='status'){
      const p=api.restorePokemonState(own(c,seat)[0].pokemon);p.status=new api.Status(api.StatusEffect.PARALYSIS);
      own(c,seat)[0].pokemon=api.capturePokemonState(p);
    }
    if(condition==='pp'){
      const p=api.restorePokemonState(own(c,seat)[0].pokemon),move=p.getMoveset()[0];move.ppUsed=move.getMovePp();
      own(c,seat)[0].pokemon=api.capturePokemonState(p);
    }
    const before=json(c),continuation=c.continuation;
    // Explicit synthetic queued TurnEnd/condition, using a genuinely acquired
    // original factory item. The enemy regression above is fully natural.
    continuation.phaseQueue=[];continuation.phaseQueuePrepend=[{kind:'original-phase',phaseId:0,remaining:'start',phase:{version:1,type:'TurnEndPhase',scope:null,fields:{},presentation:{}}}];
    continuation.nextCommandPhaseQueue=[];c.decision={id:'native-2-100',kind:'continuing',requiredSeats:[],reason:'effects'};
    const result=await h.request('native-run-to-boundary',c);
    assert.ok(result.events.some(e=>e.phase==='BerryPhase'));
    assert.equal(api.originalDecisionStateCodec.restore(result.checkpoint).players[seat].modifiers.length,0);
    const after=own(result.checkpoint,seat)[0].pokemon.fields;
    if(condition==='hp')assert.ok(after.hp>target.hp);
    if(condition==='status')assert.ok(!after.status);
    if(condition==='pp')assert.ok(after.moveset[0].fields.ppUsed<before.roster.entries.find(e=>e.pokemon.fields.id===target.id).pokemon.fields.moveset[0].fields.ppUsed);
    if(['stat','random-stat'].includes(condition))assert.ok(after.summonData.fields.battleStats.some(v=>v>0));
    assert.equal(canonical(result.checkpoint.players[1-seat]),canonical(c.players[1-seat]));
    let stepped=c;
    for(let n=0;n<60&&stepped.decision.kind==='continuing';n++){
      stepped=(await h.request('native-step',json(stepped))).checkpoint;
      const resumed=stepped.decision.kind==='continuing'?await h.request('native-run-to-boundary',json(stepped)):{checkpoint:stepped};
      sameCheckpoint(resumed.checkpoint,result.checkpoint);
    }
  }finally{await h.close();}
});

for(const seat of [0,1])test(`native original Berry Pouch retains a used own berry with original RNG seat ${seat}`,async()=>{
  const {h,c:initial}=await preparation();
  try{
    let c=await acquire(h,json(initial),seat,'BERRY',{args:[0]});
    c=await acquire(h,c,seat,'BERRY_POUCH',{existing:2});c=await nextInput(h,c);
    const target=own(c,seat)[0].pokemon.fields;target.hp=1;
    c.continuation.phaseQueue=[];c.continuation.phaseQueuePrepend=[{kind:'original-phase',phaseId:0,remaining:'start',phase:{version:1,type:'TurnEndPhase',scope:null,fields:{},presentation:{}}}];
    c.decision={id:'native-2-200',kind:'continuing',requiredSeats:[],reason:'effects'};
    const result=await h.request('native-run-to-boundary',c),replay=await h.request('native-run-to-boundary',json(c));
    assert.equal(canonical(result),canonical(replay));
    const berry=api.originalDecisionStateCodec.restore(result.checkpoint).players[seat].modifiers.find(m=>Object.hasOwn(m,'berryType'));
    assert.equal(berry.stackCount,1);assert.equal(berry.consumed,false);
    assert.ok(own(result.checkpoint,seat)[0].pokemon.fields.hp>1);
    assert.equal(result.checkpoint.sceneRandom,c.sceneRandom,'Berry Pouch uses original battle RNG, not the room stream');
    let stepped=c;
    for(let n=0;n<15;n++){
      const step=await h.request('native-step',stepped);stepped=step.checkpoint;
      if(step.events.some(e=>e.phase==='BerryPhase')){assert.notEqual(stepped.battle.random.state,null);break;}
      assert.ok(n<14,'original berry phase must run');
    }
  }finally{await h.close();}
});

test('native original persistent async update failures reject the candidate and preserve the supplied checkpoint',async()=>{
  const {h,c:initial}=await preparation();await h.close();
  const input=reward(initial,0,'BASE_STAT_BOOSTER'),before=canonical(input.c);
  for(const method of ['updateModifiers','updatePartyForModifiers']){
    const original=api.BattleScene.prototype[method];
    try{
      api.BattleScene.prototype[method]=function(){return new Promise((resolve,reject)=>setTimeout(()=>reject(Error(`TEST_ORIGINAL_${method}`)),10));};
      const runtime=api.createOriginalRuntime(base.config.seed,base.config.identity);
      await assert.rejects(api.executeRuntimeOperation(runtime,'native-prepare-action',{checkpoint:input.c,seat:0,action:input.action}),new RegExp(`TEST_ORIGINAL_${method}`));
      assert.equal(canonical(input.c),before);
    }finally{api.BattleScene.prototype[method]=original;}
  }
});

test('native observes original Pokemon updateInfo rejection even inside original updatePartyForModifiers allSettled',async()=>{
  const {h,c:initial}=await preparation();await h.close();
  const input=reward(initial,1,'BASE_STAT_BOOSTER'),before=canonical(input.c);
  const descriptor=Object.getOwnPropertyDescriptor(api.PlayerPokemon.prototype,'updateInfo');
  try{
    // PlayerPokemon inherits the original display port from Pokemon. Shadowing
    // only this subclass injects a failing original async update, while the
    // production addModifier/updateModifiers/updateParty bodies stay intact.
    Object.defineProperty(api.PlayerPokemon.prototype,'updateInfo',{configurable:true,writable:true,
      value(){return new Promise((resolve,reject)=>setTimeout(()=>reject(Error('TEST_ORIGINAL_UPDATE_INFO')),10));}});
    const runtime=api.createOriginalRuntime(base.config.seed,base.config.identity);
    await assert.rejects(api.executeRuntimeOperation(runtime,'native-prepare-action',{checkpoint:input.c,seat:1,action:input.action}),/TEST_ORIGINAL_UPDATE_INFO/);
    assert.equal(canonical(input.c),before);
  }finally{
    if(descriptor)Object.defineProperty(api.PlayerPokemon.prototype,'updateInfo',descriptor);else delete api.PlayerPokemon.prototype.updateInfo;
  }
});
