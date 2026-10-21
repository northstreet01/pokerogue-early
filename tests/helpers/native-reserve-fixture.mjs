import assert from 'node:assert/strict';
import { createOriginalRuleHost } from '../../server/original-rule-host.mjs';

export const frontPhase = c => (c.continuation.phaseQueuePrepend.at(-1) ?? c.continuation.phaseQueue[0])?.phase?.type;
export const attack = (c, seat) => c.decision.options[seat].find(o => o.kind === 'fight' && (o.target === null || o.target >= 2));
export async function settleNative(h, c) {
  for (let budget = 0; budget < 12 && c.decision.kind === 'continuing'; budget++) {
    const operation = c.decision.reason === 'next-battle' ? 'native-next'
      : frontPhase(c) === 'SelectModifierPhase' ? 'native-preparation' : 'native-run-to-boundary';
    c = (await h.request(operation, c)).checkpoint;
  }
  return c;
}

// Actual native encounter/FIGHTs/ordinary ball, not a manufactured reserve.
export async function capturedPreparation() {
  const h = await createOriginalRuleHost({ seed: 'capture-review-5', identity: { trainerId: 1, secretId: 2 } });
  try {
    let c = (await h.request('native-open-to-input', { parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [
      [{ id: 28123456, gachaType: 0, hatchWaves: 10, timestamp: 1000 }],
      [{ id: 28123456, gachaType: 0, hatchWaves: 12, timestamp: 1000 }],
    ] } })).checkpoint;
    for (let turn = 0; turn < 10 && !c.decision.options[1].some(o => o.kind === 'ball'); turn++) {
      c = (await h.request('native-submit', { checkpoint: c, inputs: { 0: attack(c, 0), 1: attack(c, 1) } })).checkpoint;
      c = await settleNative(h, c);
    }
    const ball = c.decision.options[1].find(o => o.kind === 'ball' && o.pokeballType === 0);
    assert.ok(ball);
    c = (await h.request('native-submit', { checkpoint: c, inputs: { 0: attack(c, 0), 1: ball } })).checkpoint;
    c = await settleNative(h, c);
    assert.equal(c.decision.kind, 'preparation');
    assert.equal(c.roster.entries.filter(e => e.owner === 1 && e.group === 'reserve').length, 0);
    assert.equal(c.roster.entries.filter(e => e.owner === 1 && e.group === 'party').length, 4);
    return { h, c };
  } catch (error) { await h.close(); throw error; }
}

export async function enterNextNative(h, c, switchTo = null) {
  for (const seat of [0, 1]) for (const operation of ['skip-reward', 'ready'])
    c = (await h.request('native-prepare-action', { checkpoint: c, seat, action: { kind: 'preparation', operation } })).checkpoint;
  c = await settleNative(h, c);
  for (let budget = 0; budget < 12 && ['switch-confirm', 'switch-select'].includes(c.decision.kind); budget++) {
    const seat = c.decision.requiredSeats[0], options = c.decision.options[seat];
    const action = c.decision.kind === 'switch-confirm'
      ? options.find(o => o.accept === (seat === 1 && switchTo !== null))
      : options.find(o => o.pokemonId === switchTo);
    assert.ok(action);
    c = (await h.request('native-switch', { checkpoint: c, inputs: { [seat]: action } })).checkpoint;
    c = await settleNative(h, c);
  }
  assert.equal(c.decision.kind, 'wait-actions');
  return c;
}

// Full parties are constructed through the production selected-starter Worker.
// Only the initial master-ball inventory is synthetic for deterministic success.
export async function fullCaptureChoice({ both = false } = {}) {
  const identities = [{trainerId:1,secretId:2},{trainerId:3,secretId:4}];
  const h = await createOriginalRuleHost({ seed:'capture-review-5', identity:identities[0] });
  try {
    const selection = speciesId => ({version:2,speciesId,dexAttr:'149',nature:0,moveset:null,
      pokerus:false,ivs:[31,30,29,28,27,26],eggMoves:0});
    let c = (await h.request('native-open-selected-to-input', { identities,
      starterSelections:[both ? [1,4,7,25,133,152] : [1,4,7],[906,909,912,25,133,152]].map(p=>p.map(selection)),
      eggState:{players:[[],[]]} })).checkpoint;
    for(let turn=0;turn<12&&!c.decision.options?.[1]?.some(o=>o.kind==='ball');turn++) {
      assert.equal(c.decision.kind,'wait-actions');
      c = (await h.request('native-submit',{checkpoint:c,inputs:{0:attack(c,0),1:attack(c,1)}})).checkpoint;
      c = await settleNative(h,c);
    }
    const ball = {...c.decision.options[1].find(o=>o.kind==='ball'),pokeballType:4};
    assert.equal(ball.kind,'ball');c.players[1].pokeballCounts[4]=1;c.decision.options[1].push(ball);
    if(both){c.players[0].pokeballCounts[4]=1;c.decision.options[0].push({...ball})}
    const before = structuredClone(c);
    c = (await h.request('native-submit',{checkpoint:c,inputs:{0:both?ball:attack(c,0),1:ball}})).checkpoint;
    const submitted = structuredClone(c);
    const result = await h.request('native-run-to-boundary',c);
    assert.equal(result.checkpoint.decision.kind,'capture-choice');
    return {h,c:result.checkpoint,before,result,submitted};
  } catch(error) {await h.close();throw error;}
}
