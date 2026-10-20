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
