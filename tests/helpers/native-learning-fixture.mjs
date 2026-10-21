import { createOriginalRuleHost } from '../../server/original-rule-host.mjs';
const config = { seed: 'learn-review', identity: { trainerId: 1, secretId: 2 } };
const fields = values => Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { presence: 'value', value }]));
// Explicit synthetic queue fixture: real native Pokemon/phase codecs and Worker,
// but not evidence of natural battle level-up or browser interaction.
export async function learningFixture({ seat = 1, full = true, moveId = 73, index = 0, seed = config.seed } = {}) {
  const h = await createOriginalRuleHost({...config, seed});
  try {
    const c = (await h.request('native-open-to-input', {
      parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] },
    })).checkpoint;
    const member = c.roster.entries.find(e => e.owner === seat && e.group === 'party' && e.index === index);
    if (full) member.pokemon.fields.moveset.push({ ...structuredClone(member.pokemon.fields.moveset[0]),
      fields: { moveId: 39, ppUsed: 2, ppUp: 0, virtual: false } });
    c.decision = { id: 'native-1-100', kind: 'continuing', requiredSeats: [], reason: 'effects' };
    c.continuation.phaseQueuePrepend = [];
    c.continuation.phaseQueue = [{ kind: 'original-phase', phaseId: 100, remaining: 'start',
      phase: { type: 'LearnMovePhase', version: 1, scope: seat, presentation: {},
        fields: fields({ partyMemberIndex: index, fieldIndex: index < 2 ? index : -1, player: true, moveId }) } },
      { kind: 'original-phase', phaseId: 101, remaining: 'start',
        phase: { type: 'TurnInitPhase', version: 1, scope: null, fields: {}, presentation: {} } }];
    return { h, c };
  } catch (error) { await h.close(); throw error; }
}
