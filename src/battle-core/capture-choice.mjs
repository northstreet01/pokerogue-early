import { canonical, requireContract as check } from './coop-contract.mjs';

// Only a full personal party asks for a release. The caught wild Pokemon stays
// in the suspended original phase, never in an accumulating reserve warehouse.
export function createCaptureChoice(id, context, seat) {
  check([0, 1].includes(seat), 'INVALID_CAPTURE_OWNER');
  const party = context.roster.entries.filter(e => e.owner === seat && e.group === 'party').sort((a,b) => a.index-b.index);
  const phase = context.continuation.currentPhase?.phase;
  const target = context.roster.entries.find(e => e.owner === null && e.pokemon.id === phase?.coopTargetId);
  check(party.length === 6 && target?.pokemon.hp > 0, 'INVALID_CAPTURE_CHOICE');
  return { id, kind: 'capture-choice', requiredSeats: [seat], targetId: target.pokemon.id,
    options: { [seat]: [{ kind: 'capture-choice', releaseId: null },
      ...party.filter(e => e.pokemon.id !== context.roster.field[seat]).map(e => ({ kind: 'capture-choice', releaseId: e.pokemon.id }))] } };
}

export function validateCaptureChoice(context, seat, action) {
  const d = context.decision;
  check(d.kind === 'capture-choice' && d.requiredSeats.length === 1 && d.requiredSeats[0] === seat
    && d.options[seat].some(o => canonical(o) === canonical(action)), 'INVALID_CAPTURE_CHOICE');
}
