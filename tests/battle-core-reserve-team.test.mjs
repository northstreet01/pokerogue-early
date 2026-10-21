import test from 'node:test';
import assert from 'node:assert/strict';
import { capturedPreparation, fullCaptureChoice, settleNative, enterNextNative, attack } from './helpers/native-reserve-fixture.mjs';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
const personal=(c,group)=>c.roster.entries.filter(e=>e.owner===1&&e.group===group).sort((a,b)=>a.index-b.index);

test('ordinary capture joins an under-full personal party and can fight the next encounter without reserve storage',async()=>{
 const {h,c}=await capturedPreparation();
 try {
  const caught=personal(c,'party').find(e=>e.pokemon.fields.id===0);
  assert.ok(caught);assert.equal(personal(c,'party').length,4);assert.equal(personal(c,'reserve').length,0);
  await assert.rejects(h.request('native-prepare-action',{checkpoint:c,seat:1,
    action:{kind:'preparation',operation:'reserve-swap',partyId:c.roster.field[1],reserveId:0}}),e=>e.code==='RESERVE_STORAGE_DISABLED');
  const next=await enterNextNative(h,c,0);assert.equal(next.roster.field[1],0);
  const inputs={0:attack(next,0),1:attack(next,1)},before=personal(next,'party')[0].pokemon.fields.moveset;
  const submitted=(await h.request('native-submit',{checkpoint:next,inputs})).checkpoint;
  const after=await settleNative(h,submitted),entry=after.roster.entries.find(e=>e.pokemon.fields.id===0);
  assert.equal(entry.pokemon.fields.moveset[inputs[1].cursor].fields.ppUsed,before[inputs[1].cursor].fields.ppUsed+1);
  assert.equal(personal(after,'reserve').length,0);
 }finally{await h.close()}
});

test('full-party capture must release an owned bench or decline the new individual, never accumulate seven',async()=>{
 const {h,c,before}=await fullCaptureChoice();
 try {
  assert.equal(personal(c,'party').length,6);assert.equal(personal(c,'reserve').length,0);
  assert.equal(c.players[1].pokeballCounts[4],0);
  for(const action of c.decision.options[1].slice(0,2)) {
   const done=await h.request('native-switch',{checkpoint:JSON.parse(JSON.stringify(c)),inputs:{1:action}});
   const after=await settleNative(h,done.checkpoint);
   assert.equal(personal(after,'party').length,6);assert.equal(personal(after,'reserve').length,0);
   assert.deepEqual(after.players,c.players);assert.deepEqual(after.eggState,c.eggState);
   assert.equal(after.roster.field[0],c.roster.field[0]);
   if(action.releaseId===null){assert.deepEqual(personal(after,'party').map(e=>e.pokemon.fields.id),personal(c,'party').map(e=>e.pokemon.fields.id));}
   else {
    assert.ok(!personal(after,'party').some(e=>e.pokemon.fields.id===action.releaseId));
    assert.ok(after.roster.retiredIds.includes(action.releaseId));
    const caught=personal(after,'party').find(e=>e.pokemon.fields.id===0);assert.ok(caught);
    const source=before.roster.entries.find(e=>e.pokemon.fields.id===c.decision.targetId).pokemon.fields;
    for(const key of ['ivs','nature','gender','abilityIndex','formIndex','shiny','moveset','status'])assert.deepEqual(caught.pokemon.fields[key],source[key],key);
    const next=await enterNextNative(h,after,0);assert.equal(next.roster.field[1],0);
   }
  }
 }finally{await h.close()}
});

test('capture choice rejects peer/front/extra fields, stale scope and ready bypass without mutation',async()=>{
 const {h,c}=await fullCaptureChoice();
 try {
  const snapshot=JSON.stringify(c);
  for(const releaseId of [c.roster.field[0],c.roster.field[1],4294967295])
   await assert.rejects(h.request('native-switch',{checkpoint:c,inputs:{1:{kind:'capture-choice',releaseId}}}));
  await assert.rejects(h.request('native-switch',{checkpoint:c,inputs:{0:c.decision.options[1][0]}}));
  await assert.rejects(h.request('native-switch',{checkpoint:c,inputs:{1:{...c.decision.options[1][1],extra:true}}}));
  await assert.rejects(h.request('native-prepare-action',{checkpoint:c,seat:1,action:{kind:'preparation',operation:'ready'}}));
  const wrong=structuredClone(c);wrong.continuation.currentPhase.phase.scope=0;
  await assert.rejects(h.request('native-validate-checkpoint',wrong));
  assert.equal(JSON.stringify(c),snapshot);
  const one=(await h.request('native-switch',{checkpoint:c,inputs:{1:c.decision.options[1][1]}})).checkpoint;
  const fresh=await createOriginalRuleHost({seed:c.scene.seed,identity:{trainerId:1,secretId:2}});
  try {const restored=(await fresh.request('native-switch',{checkpoint:JSON.parse(JSON.stringify(c)),inputs:{1:c.decision.options[1][1]}})).checkpoint;assert.deepEqual(restored,one)}finally{await fresh.close()}
 }finally{await h.close()}
});

test('two full parties capturing the same wild instance suspend once and a new Worker per phase preserves the choice',async()=>{
 const {h,c,submitted}=await fullCaptureChoice({both:true});
 try {
  let restored=submitted;
  for(let step=0;step<80&&restored.decision.kind==='continuing';step++) {
   const fresh=await createOriginalRuleHost({seed:c.scene.seed,identity:{trainerId:1,secretId:2}});
   try {restored=(await fresh.request('native-step',JSON.parse(JSON.stringify(restored)))).checkpoint}finally{await fresh.close()}
  }
  const semantic=input=>{const out=structuredClone(input);delete out.decision.id;
   for(const key of ['phaseQueue','phaseQueuePrepend','nextCommandPhaseQueue'])for(const d of out.continuation[key])delete d.phaseId;
   if(out.continuation.currentPhase)delete out.continuation.currentPhase.phaseId;return out};
  assert.deepEqual(semantic(restored),semantic(c));
  const owner=c.decision.requiredSeats[0],other=1-owner;
  assert.equal(c.players[owner].pokeballCounts[4],0);assert.equal(c.players[other].pokeballCounts[4],1);
  const action=c.decision.options[owner].find(o=>o.releaseId!==null);
  const result=(await h.request('native-switch',{checkpoint:restored,inputs:{[owner]:action}})).checkpoint;
  const done=await settleNative(h,result);
  assert.equal(done.decision.kind,'preparation');assert.equal(done.players[other].pokeballCounts[4],1);
  assert.equal(done.roster.entries.filter(e=>e.owner===owner&&e.group==='party').length,6);
  assert.equal(done.roster.entries.filter(e=>e.owner===other&&e.group==='party').length,6);
  assert.equal(done.roster.entries.filter(e=>e.group==='reserve').length,0);
  assert.equal(done.roster.entries.filter(e=>e.owner!==null&&e.pokemon.fields.id===0).length,1);
 }finally{await h.close()}
});

test('old reserve captures require explicit choices, never grow the party above six and preserve eggs/rewards/resources',async()=>{
 const {h,c}=await capturedPreparation();
 try {
  // Explicit old-version checkpoint fixture using the genuinely caught Pokemon.
  // Extra old inventory only exercises migration; it is never browser evidence.
  const original=personal(c,'party').find(e=>e.pokemon.fields.id===0);
  original.group='reserve';original.index=0;
  for(let index=1;index<8;index++) {const entry=structuredClone(original);entry.index=index;entry.pokemon.fields.id=4000000100+index;c.roster.entries.push(entry)}
  let state=c;
  const before=structuredClone(c),retired=[];
  for(let step=0;step<8;step++) {
   const view=await h.request('native-project',{checkpoint:state,seat:1});
   const legacy=view.personal.decision.legacyCapture;assert.ok(legacy);
   assert.equal(legacy.pokemonId,personal(state,'reserve')[0].pokemon.fields.id);
   await assert.rejects(h.request('native-prepare-action',{checkpoint:state,seat:1,action:{kind:'preparation',operation:'ready'}}),e=>e.code==='LEGACY_CAPTURE_PENDING');
   const keep=legacy.options.find(o=>o.choice==='keep');
   const action=step<4?keep:legacy.options.find(o=>o.choice==='discard');
   const incoming=personal(state,'reserve')[0].pokemon;
   await h.request('native-validate-preparation',{checkpoint:state,seat:1,action});
   state=(await h.request('native-prepare-action',{checkpoint:JSON.parse(JSON.stringify(state)),seat:1,action})).checkpoint;
   if(action.choice==='keep')assert.deepEqual(personal(state,'party').find(e=>e.pokemon.fields.id===legacy.pokemonId).pokemon,incoming);
   if(action.releaseId!==null)retired.push(action.releaseId);
   if(action.choice==='discard')retired.push(action.pokemonId);
   assert.ok(personal(state,'party').length<=6);assert.equal(personal(state,'reserve').length,7-step);
   assert.deepEqual(state.players,before.players);assert.deepEqual(state.eggState,before.eggState);
   assert.deepEqual(state.pendingEffects,before.pendingEffects);assert.deepEqual(state.decision.players,before.decision.players);
   assert.deepEqual(state.battle.random,before.battle.random);assert.deepEqual(state.sceneRandom,before.sceneRandom);
   assert.deepEqual(personal(state,'party').filter(e=>e.pokemon.fields.id===state.roster.field[1]),personal(before,'party').filter(e=>e.pokemon.fields.id===before.roster.field[1]));
  }
  assert.equal(personal(state,'party').length,6);assert.ok(retired.every(id=>state.roster.retiredIds.includes(id)));
  const final=await h.request('native-project',{checkpoint:state,seat:1});assert.equal(final.personal.decision.legacyCapture,undefined);
  await enterNextNative(h,state);
 }finally{await h.close()}
});

test('old capture migration rejects foreign or out-of-order members and unresolved choices without deleting inventory',async()=>{
 const {h,c}=await capturedPreparation();
 try {
  const caught=personal(c,'party').find(e=>e.pokemon.fields.id===0);caught.group='reserve';caught.index=0;
  const extra=structuredClone(caught);extra.index=1;extra.pokemon.fields.id=4000000001;c.roster.entries.push(extra);
  const view=await h.request('native-project',{checkpoint:c,seat:1}),action=view.personal.decision.legacyCapture.options.find(o=>o.choice==='keep');
  const before=JSON.stringify(c);
  for(const invalid of [{...action,pokemonId:4000000001},{...action,pokemonId:c.roster.field[0]},
    {...action,releaseId:c.roster.field[1]},{...action,extra:true}])
   await assert.rejects(h.request('native-prepare-action',{checkpoint:c,seat:1,action:invalid}));
  await assert.rejects(h.request('native-prepare-action',{checkpoint:c,seat:0,action}));
  const ready=structuredClone(c);ready.decision.players[1].rewardResolved=true;ready.decision.players[1].ready=true;
  await assert.rejects(h.request('native-prepare-action',{checkpoint:ready,seat:1,action}));
  const pending=structuredClone(c);pending.decision.players[1].selection={optionId:pending.decision.players[1].rewards[0].id,pokemonId:pending.roster.field[1],moveIndex:null,fusionId:null};
  await assert.rejects(h.request('native-prepare-action',{checkpoint:pending,seat:1,action}));
  assert.equal(JSON.stringify(c),before);
 }finally{await h.close()}
});

test('actual native faint requires an owned forced replacement and survives per-phase Worker recovery', async () => {
  const seed = 'team-forced-0', identity = { trainerId: 1, secretId: 2 };
  const h = await createOriginalRuleHost({ seed, identity });
  try {
    const initial = (await h.request('native-open-to-input', { parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } })).checkpoint;
    // Explicit synthetic near-faint initial HP, followed by original combat,
    // FaintPhase and its queued SwitchPhase. Not a browser shortcut.
    initial.roster.entries.find(e => e.pokemon.fields.id === initial.roster.field[1]).pokemon.fields.hp = 1;
    const submitted = (await h.request('native-submit', { checkpoint: initial, inputs: { 0: attack(initial, 0), 1: attack(initial, 1) } })).checkpoint;
    const result = await h.request('native-run-to-boundary', submitted), c = result.checkpoint;
    assert.equal(c.decision.kind, 'wait-switch');
    assert.ok(result.events.some(e => e.phase === 'FaintPhase'));
    assert.deepEqual(c.decision.requiredSeats, [1]);
    assert.equal(c.continuation.currentPhase.remaining, 'wait-switch');
    const action = c.decision.options[1][0], before = JSON.stringify(c);
    const wrongScope = structuredClone(c); wrongScope.continuation.currentPhase.phase.scope = 0;
    await assert.rejects(h.request('native-validate-checkpoint', wrongScope), e => e.code === 'INVALID_SWITCH_DECISION');
    const oldSharedScope=structuredClone(c);oldSharedScope.continuation.currentPhase.phase.scope=null;
    await h.request('native-validate-checkpoint',oldSharedScope);
    const normalized=(await h.request('native-switch',{checkpoint:oldSharedScope,inputs:{1:action}})).checkpoint;
    const scoped=(await h.request('native-switch',{checkpoint:c,inputs:{1:action}})).checkpoint;
    assert.deepEqual(normalized,scoped,'legacy null scope binds the same actual owner, never another seat');
    for(const flag of ['isModal','doReturn']){
      const corrupt=structuredClone(c);corrupt.continuation.currentPhase.phase.fields[flag].value=flag==='doReturn';
      await assert.rejects(h.request('native-validate-checkpoint',corrupt),e=>e.code==='INVALID_SWITCH_DECISION');
    }
    await h.request('native-validate-switch', { checkpoint: c, seat: 1, action });
    for (const bad of [{ ...action, pokemonId: c.roster.field[0] }, { ...action, pokemonId: null }])
      await assert.rejects(h.request('native-validate-switch', { checkpoint: c, seat: 1, action: bad }));
    assert.equal(JSON.stringify(c), before);
    const chosen = (await h.request('native-switch', { checkpoint: c, inputs: { 1: action } })).checkpoint;
    const expected = await settleNative(h, chosen);
    let recovered = chosen;
    for (let guard = 0; guard < 20 && recovered.decision.kind === 'continuing'; guard++) {
      const fresh = await createOriginalRuleHost({ seed, identity });
      try { recovered = (await fresh.request('native-step', JSON.parse(JSON.stringify(recovered)))).checkpoint; }
      finally { await fresh.close(); }
    }
    const semantic = value => {
      const v = structuredClone(value); delete v.decision.id;
      for (const list of ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue']) for (const d of v.continuation[list]) delete d.phaseId;
      return v;
    };
    assert.deepEqual(semantic(recovered), semantic(expected));
    assert.equal(recovered.roster.field[1], action.pokemonId);
    assert.equal(recovered.roster.field[0], initial.roster.field[0]);
    assert.equal(recovered.decision.kind, 'wait-actions');
  } finally { await h.close(); }
});
