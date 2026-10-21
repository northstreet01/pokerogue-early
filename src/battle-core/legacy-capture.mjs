import { canonical, requireContract as check } from './coop-contract.mjs';

export const hasLegacyCaptures = (c, seat) => c.roster.entries.some(e => e.owner === seat && e.group === 'reserve');

// Old captures have already been converted. Offer them one at a time at the
// original preparation boundary, without inventing another storage system.
export function legacyCaptureOptions(c, seat) {
  const reserve = c.roster.entries.filter(e => e.owner === seat && e.group === 'reserve').sort((a,b) => a.index-b.index)[0];
  if (!reserve || c.decision.kind !== 'preparation') return null;
  const p = c.decision.players[seat];
  if (p.ready || p.selection !== null || p.subdecision !== null) return null;
  const party = c.roster.entries.filter(e => e.owner === seat && e.group === 'party').sort((a,b) => a.index-b.index);
  check(party.length >= 1 && party.length <= 6, 'PERSONAL_PARTY_LIMIT');
  const action = (choice, releaseId) => ({ kind:'preparation', operation:'legacy-capture', pokemonId:reserve.pokemon.id, choice, releaseId });
  return { pokemonId: reserve.pokemon.id, options: [action('discard',null),
    ...(party.length < 6 ? [action('keep',null)] : party.filter(e => !c.roster.field.includes(e.pokemon.id)).map(e => action('keep',e.pokemon.id)))] };
}

export function validateLegacyCapture(c, seat, action, codec, safe) {
  check(seat === 0 || seat === 1, 'INVALID_CAPTURE_OWNER');
  safe.validate(c.decision,c);
  const choice = legacyCaptureOptions(c,seat);
  check(choice && choice.options.some(o => canonical(o) === canonical(action)), 'INVALID_LEGACY_CAPTURE_CHOICE');
  const pending = codec.capture(c).pendingEffects.filter(e => e.phase.scope === seat);
  check(pending.length === 1 && pending[0].remaining === 'reward-select'
    && pending[0].phase.type === 'SelectModifierPhase', 'PREPARATION_GROWTH_PENDING');
}
