import assert from 'node:assert/strict';
import { createOriginalRuleHost } from '../../server/original-rule-host.mjs';

export const naturalConfig = { seed: 'learning-natural-2', identity: { trainerId: 1, secretId: 2 } };
const selection = (speciesId, moveset = null) => ({ version: 2, speciesId, dexAttr: '149', nature: 0,
  moveset, pokerus: false, ivs: [31, 31, 31, 31, 31, 31], eggMoves: 0 });
// Legal original level-5 starter moves, not a manufactured learning checkpoint.
export const naturalSelection = { identities: [{ trainerId: 1, secretId: 2 }, { trainerId: 3, secretId: 4 }],
  starterSelections: [[selection(298, [55, 39, 150, 270])], [selection(143)]], eggState: { players: [[], []] } };
const front = c => (c.continuation.phaseQueuePrepend.at(-1) ?? c.continuation.phaseQueue[0])?.phase.type;
export const owned = (c, seat) => c.roster.entries.filter(e => e.owner === seat && e.group === 'party').sort((a,b) => a.index-b.index);
export function naturalFight(c, seat) {
  const options = c.decision.options[seat].filter(o => o.kind === 'fight' && (o.target === null || o.target >= 2));
  const moves = owned(c, seat)[0].pokemon.fields.moveset;
  return options.find(o => [33, 55, 175].includes(moves[o.cursor]?.fields.moveId)) ?? options[0];
}
export async function progressNatural(h, c, {heal = true} = {}) {
  const d = c.decision;
  if (d.kind === 'wait-actions') {
    const inputs = Object.fromEntries(d.requiredSeats.map(seat => [seat, naturalFight(c, seat)]));
    assert.ok(Object.values(inputs).every(Boolean), 'ordinary battle must provide a legal attack');
    return h.request('native-submit', { checkpoint: c, inputs });
  }
  if (d.kind === 'preparation') {
    const allEvents = [];
    for (const seat of [0, 1]) {
      const player = c.decision.players[seat];
      if (!player.rewardResolved) {
        const target = owned(c, seat).find(e => e.pokemon.fields.hp > 0 && e.pokemon.fields.hp < e.pokemon.fields.stats[0]);
        const potion = player.rewards.find(o => ['POTION','SUPER_POTION','HYPER_POTION','MAX_POTION'].includes(o.type.catalogId));
        const action = heal && target && potion ? { kind:'preparation', operation:'reward', optionId:potion.id,
          pokemonId:target.pokemon.fields.id, moveIndex:null, fusionId:null } : {kind:'preparation',operation:'skip-reward'};
        const result = await h.request('native-prepare-action', {checkpoint:c,seat,action});
        c = result.checkpoint; allEvents.push(...result.events);
      }
      const result = await h.request('native-prepare-action', {checkpoint:c,seat,action:{kind:'preparation',operation:'ready'}});
      c = result.checkpoint; allEvents.push(...result.events);
    }
    return {checkpoint:c,events:allEvents};
  }
  if (['switch-confirm','switch-select','wait-switch'].includes(d.kind)) {
    const seat = d.requiredSeats[0], options = d.options[seat];
    const action = options.find(o => o.accept === false) ?? options[0];
    return h.request('native-switch', {checkpoint:c,inputs:{[seat]:action}});
  }
  assert.equal(d.kind,'continuing');
  return h.request(d.reason==='next-battle'?'native-next':front(c)==='SelectModifierPhase'?'native-preparation':'native-run-to-boundary',c);
}
export async function naturalLearning() {
  const h = await createOriginalRuleHost(naturalConfig);
  try {
    // Synthetic collection descriptors only, checked by production profile rules;
    // no real user save is created, unlocked, imported or overwritten.
    let total=0;
    for(const seat of [0,1]){
      const starters=naturalSelection.starterSelections[seat];
      const profile={version:2,trainer:naturalSelection.identities[seat],starters,eggs:[],
        costs:starters.map(s=>({speciesId:s.speciesId,caughtCount:0,hatchedCount:0})),
        unlocks:starters.map(s=>({speciesId:s.speciesId,caughtAttr:s.dexAttr,natureAttr:2,ivs:s.ivs,eggMoves:s.eggMoves}))};
      const priced=await h.request('validate-profile',profile);
      assert.ok(priced.total<=10); total+=priced.total;
    }
    assert.ok(total<=14);
    let c = (await h.request('native-open-selected-to-input', naturalSelection)).checkpoint;
    const initial = structuredClone(c), trace = [];
    let beforeLearning;
    for (let n=0; n<180 && c.decision.kind!=='learn-move'; n++) {
      beforeLearning = c;
      const result = await progressNatural(h,c);
      trace.push({wave:c.battle.waveIndex,kind:c.decision.kind,events:result.events});
      c = result.checkpoint;
    }
    assert.equal(c.decision.kind,'learn-move','ordinary battles must naturally reach a full-moveset decision');
    return {h,c,initial,trace,beforeLearning};
  } catch(error) {await h.close();throw error;}
}
