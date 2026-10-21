import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginalRuleHost } from '../server/original-rule-host.mjs';
import { restoreTurnCommands } from '../src/battle-core/command-state.mjs';

import { learningFixture } from './helpers/native-learning-fixture.mjs';
import { naturalLearning, naturalConfig, naturalSelection, progressNatural, owned } from './helpers/native-natural-learning.mjs';
const config = { seed: 'learn-review', identity: { trainerId: 1, secretId: 2 } };
const own = (c, seat) => c.roster.entries.find(e => e.owner === seat && e.group === 'party' && e.index === 0);

for (const slot of [0, null]) test(`natural original victory EXP reaches full learning and next FIGHT slot=${slot}`, async () => {
  let {h,c,initial,trace} = await naturalLearning();
  try {
    assert.equal(c.battle.waveIndex,4);
    assert.deepEqual(c.decision.requiredSeats,[0]);
    assert.equal(c.decision.learn.moveId,61);
    assert.equal(owned(c,0)[0].pokemon.fields.level,6);
    assert.equal(owned(initial,0)[0].pokemon.fields.level,5);
    const phases=trace.flatMap(t=>t.events.filter(e=>e.kind==='phase-start').map(e=>e.phase));
    for(const name of ['MoveEffectPhase','VictoryPhase','ExpPhase','LevelUpPhase']) assert.ok(phases.includes(name),name);
    const before=structuredClone(owned(c,0)[0].pokemon.fields.moveset);
    const action=c.decision.options[0].find(o=>o.slot===slot);
    await h.close(); h=await createOriginalRuleHost(naturalConfig);
    await h.request('native-validate-progression',{checkpoint:c,seat:0,action});
    c=(await h.request('native-progression',{checkpoint:JSON.parse(JSON.stringify(c)),seat:0,action})).checkpoint;
    for(let n=0;n<12&&c.decision.kind==='continuing';n++) c=(await progressNatural(h,c)).checkpoint;
    assert.equal(c.decision.kind,'wait-actions');
    const expected=structuredClone(before);
    if(slot!==null) expected[slot]={type:'PokemonMove',fields:{moveId:61,ppUsed:0,ppUp:0,virtual:false},undefinedFields:[]};
    assert.deepEqual(owned(c,0)[0].pokemon.fields.moveset,expected);
    const attack=c.decision.options[0].find(o=>o.kind==='fight'&&o.cursor===0&&(o.target===null||o.target>=2));
    const peer=c.decision.options[1].find(o=>o.kind==='fight'&&owned(c,1)[0].pokemon.fields.moveset[o.cursor].fields.moveId===111);
    assert.ok(attack&&peer,'original Bubble Beam/Water Gun plus ally Defense Curl');
    const pp=owned(c,0)[0].pokemon.fields.moveset[0].fields.ppUsed;
    const submitted=(await h.request('native-submit',{checkpoint:c,inputs:{0:attack,1:peer}})).checkpoint;
    assert.equal(restoreTurnCommands(submitted.battle.turnCommands)[0].move.move,slot===null?55:61);
    const result=await h.request('native-run-to-boundary',submitted);
    assert.equal(owned(result.checkpoint,0)[0].pokemon.fields.moveset[0].fields.ppUsed,pp+1);
    assert.ok(result.events.some(e=>e.kind==='phase-start'&&e.phase==='MoveEffectPhase'));
  } finally {await h.close();}
});

test('native exhausted moves offer original Struggle rather than an empty action set', async()=>{
  const {h,c}=await learningFixture({full:false, seed:'vs02b08-switch'});
  try {
    // Explicit synthetic exhaustion fixture; original command/effects execute.
    for(const m of own(c,1).pokemon.fields.moveset) m.fields.ppUsed=999;
    c.continuation.phaseQueue.shift();
    const ready=(await h.request('native-run-to-boundary',c)).checkpoint;
    const fights=ready.decision.options[1].filter(o=>o.kind==='fight');
    assert.deepEqual([...new Set(fights.map(o=>o.cursor))],own(c,1).pokemon.fields.moveset.map((_,i)=>i),
      'every original move row remains a legal Struggle selection');
    const attack=fights.find(o=>o.cursor===1);assert.ok(attack);
    const peer=ready.decision.options[0].find(o=>o.kind==='fight'&&(o.target===null||o.target>=2));
    await h.request('native-validate',{checkpoint:ready,seat:1,action:attack});
    const sub=(await h.request('native-submit',{checkpoint:ready,inputs:{0:peer,1:attack}})).checkpoint;
    assert.equal(restoreTurnCommands(sub.battle.turnCommands)[1].move.move,165);
    const after=(await h.request('native-run-to-boundary',sub)).checkpoint;
    assert.deepEqual(own(after,1).pokemon.fields.moveset,own(c,1).pokemon.fields.moveset,'Struggle consumes no exhausted PP');
  } finally {await h.close();}
});

test('missing seat-1 summons promote the original living member equally in continuous and per-phase recovery', async()=>{
  let {h,c}=await learningFixture({full:false});
  try {
    const phase=c.continuation.phaseQueue[0].phase;
    phase.type='SummonMissingPhase';delete phase.fields.moveId;
    phase.fields.fieldIndex.value=1;
    own(c,1).pokemon.fields.hp=0;c.roster.field[1]=null;
    const incoming=owned(c,1)[1].pokemon.fields.id;
    const continuous=(await h.request('native-run-to-boundary',c)).checkpoint;
    let recovered=structuredClone(c);
    for(let n=0;n<12&&recovered.decision.kind!=='wait-actions';n++){
      await h.close();h=await createOriginalRuleHost(config);
      recovered=(await h.request('native-step',recovered)).checkpoint;
    }
    for(const after of [continuous,recovered]){
      assert.equal(after.roster.field[1],incoming);
      assert.equal(owned(after,1)[0].pokemon.fields.id,incoming);
      assert.deepEqual(after.decision.requiredSeats,[0,1]);
      assert.deepEqual(own(after,0).pokemon.fields.moveset,own(c,0).pokemon.fields.moveset);
    }
    assert.deepEqual(recovered.sceneRandom,continuous.sceneRandom);
  } finally {await h.close();}
});

test('native won BattleEnd reuses approved original half-revive for only the wholly fainted personal party', async()=>{
  const {h,c}=await learningFixture({full:false});
  try {
    for(const e of c.roster.entries) if(e.owner===0||e.owner===null) {
      e.pokemon.fields.hp=0;
      e.pokemon.fields.status={version:1,type:'Status',fields:{effect:7,turnCount:0},undefinedFields:['cureTurn']};
    }
    c.roster.field[0]=null;
    const phase=c.continuation.phaseQueue[0].phase;
    phase.type='BattleEndPhase';phase.scope=null;phase.fields={};
    const result=await h.request('native-step',c),after=result.checkpoint;
    assert.equal(own(after,0).pokemon.fields.hp,Math.floor(own(c,0).pokemon.fields.stats[0]/2));
    assert.ok(owned(after,0).slice(1).every(e=>e.pokemon.fields.hp===0));
    assert.equal(own(after,1).pokemon.fields.hp,own(c,1).pokemon.fields.hp);
    assert.deepEqual(after.players,c.players);
    assert.equal(result.events.filter(e=>e.kind==='victory-recovery').length,1);
  } finally {await h.close();}
});

test('natural fainted seat supplies no action, survivor wins and original half-revive reaches preparation', async()=>{
  const h=await createOriginalRuleHost({...naturalConfig,seed:'learning-natural-1'});
  try{
    const selected=structuredClone(naturalSelection);
    selected.starterSelections[0]=[{...selected.starterSelections[0][0],speciesId:1,moveset:null}];
    let c=(await h.request('native-open-selected-to-input',selected)).checkpoint,sawSolo=false,recovery=null;
    for(let n=0;n<100&&!recovery;n++){
      if(c.decision.kind==='wait-actions'&&owned(c,0)[0].pokemon.fields.hp===0){
        assert.deepEqual(c.decision.requiredSeats,[1]);sawSolo=true;
      }
      const result=await progressNatural(h,c,{heal:false});c=result.checkpoint;
      if(sawSolo) recovery=result.events.find(e=>e.kind==='victory-recovery');
    }
    assert.ok(sawSolo&&recovery,'normal battles must exercise the exhausted personal party policy');
    assert.equal(recovery.seat,0);
    assert.equal(owned(c,0)[0].pokemon.fields.hp,Math.floor(owned(c,0)[0].pokemon.fields.stats[0]/2));
    c=(await progressNatural(h,c)).checkpoint;
    assert.equal(c.decision.kind,'preparation');
  }finally{await h.close();}
});

test('original post-turn poison is identical through native continuous execution and a fresh Worker step',async()=>{
  let {h,c}=await learningFixture({full:false});
  try{
    const enemy=c.roster.entries.find(e=>e.owner===null&&e.index===0);
    enemy.pokemon.fields.status={version:1,type:'Status',fields:{effect:1,turnCount:0},undefinedFields:['cureTurn']};
    const phase=c.continuation.phaseQueue[0].phase;
    phase.type='PostTurnStatusEffectPhase';phase.scope=null;
    phase.fields={battlerIndex:{presence:'value',value:2},fieldIndex:{presence:'value',value:0},player:{presence:'value',value:false}};
    const after=(await h.request('native-run-to-boundary',c)).checkpoint;
    await h.close();h=await createOriginalRuleHost(config);
    const stepped=(await h.request('native-step',JSON.parse(JSON.stringify(c)))) .checkpoint;
    const find=s=>s.roster.entries.find(e=>e.pokemon.fields.id===enemy.pokemon.fields.id).pokemon.fields;
    assert.ok(find(after).hp<enemy.pokemon.fields.hp);
    assert.equal(find(after).status.fields.turnCount,1);
    assert.equal(find(stepped).hp,find(after).hp);
    assert.deepEqual(find(stepped).status,find(after).status);
    assert.deepEqual(stepped.sceneRandom,after.sceneRandom);
  }finally{await h.close();}
});

for (const seat of [0, 1]) for (const slot of [1, null])
  test(`native saved LearnMove resumes original replacement/decline seat=${seat} slot=${slot}`, async () => {
    let { h, c } = await learningFixture({ seat });
    try {
      const before = structuredClone(c);
      c = (await h.request('native-run-to-boundary', c)).checkpoint;
      assert.equal(c.decision.kind, 'learn-move');
      assert.ok(!c.continuation.phaseQueue.some(d => d.phase.type === 'LearnMovePhase'), 'selected phase leaves the queue');
      assert.deepEqual(c.decision.requiredSeats, [seat]);
      assert.equal(c.decision.learn.pokemonId, own(c, seat).pokemon.fields.id);
      const action = c.decision.options[seat].find(o => o.slot === slot);
      await h.request('native-validate-progression', { checkpoint: c, seat, action });
      const projected = await h.request('native-project', { checkpoint: c, seat });
      assert.deepEqual(projected.personal.decision.learn, c.decision.learn);
      const peerProjection = await h.request('native-project', { checkpoint: c, seat: 1 - seat });
      assert.equal(peerProjection.personal.decision.learn, null, 'pending personal learning is owner-scoped');
      assert.equal(peerProjection.personal.decision.options, null);
      await h.close(); h = await createOriginalRuleHost(config);
      const resumed = await h.request('native-progression', { checkpoint: JSON.parse(JSON.stringify(c)), seat, action });
      const result = await h.request('native-run-to-boundary', resumed.checkpoint);
      const after = result.checkpoint;
      assert.equal(after.decision.kind, 'wait-actions');
      assert.deepEqual(own(after, 1 - seat).pokemon, own(before, 1 - seat).pokemon);
      const expected = structuredClone(own(before, seat).pokemon.fields.moveset);
      if (slot !== null) expected[slot] = { type: 'PokemonMove', fields: { moveId: 73, ppUsed: 0, ppUp: 0, virtual: false }, undefinedFields: [] };
      assert.deepEqual(own(after, seat).pokemon.fields.moveset, expected);
    } finally { await h.close(); }
  });

test('native automatic LearnMove runs original empty-slot branch without browser assets', async () => {
  const { h, c } = await learningFixture({ seat: 1, full: false });
  try {
    const after = (await h.request('native-run-to-boundary', c)).checkpoint;
    assert.equal(after.decision.kind, 'wait-actions');
    assert.equal(own(after, 1).pokemon.fields.moveset.at(-1).fields.moveId, 73);
    assert.deepEqual(own(after, 0).pokemon, own(c, 0).pokemon);
  } finally { await h.close(); }
});

test('native original ExpPhase actually queues LevelUp then automatically learns its level move', async () => {
  const { h, c } = await learningFixture({ seat: 0, full: false });
  try {
    // Synthetic EXP amount/queue, not a claim of a naturally won encounter.
    const p = c.continuation.phaseQueue[0].phase;
    p.type = 'ExpPhase'; delete p.fields.moveId;
    p.fields.expValue = { presence: 'value', value: 80 };
    const result = await h.request('native-run-to-boundary', c);
    const after = own(result.checkpoint, 0).pokemon.fields;
    assert.equal(after.level, 6);
    assert.equal(after.moveset.at(-1).fields.moveId, 74, 'original Bulbasaur level-6 Growth');
    const phases = result.events.filter(e => e.kind === 'phase-start').map(e => e.phase);
    assert.ok(phases.indexOf('LevelUpPhase') > phases.indexOf('ExpPhase'));
    assert.ok(phases.indexOf('LearnMovePhase') > phases.indexOf('LevelUpPhase'));
  } finally { await h.close(); }
});

test('off-field member retains original fieldIndex=-1 through native learning and JSON recovery', async () => {
  const { h, c } = await learningFixture({ seat: 1, index: 2, full: false });
  try {
    const after = (await h.request('native-run-to-boundary', JSON.parse(JSON.stringify(c)))).checkpoint;
    const member = after.roster.entries.find(e => e.owner === 1 && e.group === 'party' && e.index === 2);
    assert.equal(member.pokemon.fields.moveset.at(-1).fields.moveId, 73);
    assert.deepEqual(after.roster.field, c.roster.field);
  } finally { await h.close(); }
});

test('native learning validation/execution reject foreign owner, extra fields and stale phase consistently', async () => {
  const { h, c: queued } = await learningFixture();
  try {
    const c = (await h.request('native-run-to-boundary', queued)).checkpoint;
    const action = c.decision.options[1][0], before = JSON.stringify(c);
    for (const payload of [
      { checkpoint: c, seat: 0, action },
      { checkpoint: c, seat: 1, action: { ...action, extra: true } },
      { checkpoint: c, seat: 1, action: { ...action, pokemonId: own(c, 0).pokemon.fields.id } },
      { checkpoint: c, seat: 1, action: { ...action, slot: 4 } },
    ]) for (const operation of ['native-validate-progression', 'native-progression']) await assert.rejects(h.request(operation, payload));
    const corrupt = structuredClone(c);
    corrupt.continuation.currentPhase.phase.fields.partyMemberIndex.value = 1;
    for (const operation of ['native-validate-progression', 'native-progression'])
      await assert.rejects(h.request(operation, { checkpoint: corrupt, seat: 1, action }));
    assert.equal(JSON.stringify(c), before);
  } finally { await h.close(); }
});
