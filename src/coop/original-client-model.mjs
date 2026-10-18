// Client-side application boundary for VS-01. The caller supplies the original
// Pokemon codec functions; this module never executes rules, damage or RNG.
// The public shared model is a read-only observation view; only the personal
// party is restored as real original PlayerPokemon instances.
const COPY = value => JSON.parse(JSON.stringify(value));

export function createOriginalClientModel({ restorePokemonState, capturePokemonState }) {
  if (typeof restorePokemonState !== 'function' || typeof capturePokemonState !== 'function')
    throw new Error('ORIGINAL_POKEMON_CODEC_REQUIRED');
  let applied = null;
  return Object.freeze({
    applySnapshot(snapshot) {
      const shared = COPY(snapshot.shared);
      const personal = COPY(snapshot.personal);
      const party = Array.isArray(personal.party)
        ? personal.party.map(entry => ({ ...entry, pokemon: restorePokemonState(COPY(entry.pokemon)) })) : [];
      const byId = new Map(party.map(entry => [entry.id, entry]));
      for (const publicEntry of shared.pokemon ?? []) {
        if (publicEntry.owner !== snapshot.seat) continue;
        const own = byId.get(publicEntry.id);
        if (!own) throw new Error('OWN_POKEMON_NOT_IN_PERSONAL');
        if (own.pokemon.hp !== publicEntry.hp || own.pokemon.getMaxHp() !== publicEntry.maxHp)
          throw new Error('OWN_POKEMON_VIEW_MISMATCH');
      }
      applied = { seat: snapshot.seat, shared, personal: { ...personal, party }, byId };
    },

    captureAppliedState() {
      if (!applied) throw new Error('MODEL_NOT_APPLIED');
      const personal = {
        format: applied.personal.format,
        stage: applied.personal.stage,
        seat: applied.personal.seat,
        party: applied.personal.party.map(entry => ({
          id: entry.id,
          owner: entry.owner,
          index: entry.index,
          group: entry.group,
          pokemon: capturePokemonState(entry.pokemon),
        })),
        eggs: COPY(applied.personal.eggs ?? null),
        resources: COPY(applied.personal.resources),
        decision: COPY(applied.personal.decision),
      };
      if (Object.hasOwn(applied.personal, 'selection')) personal.selection = COPY(applied.personal.selection);
      if (Object.hasOwn(applied.personal, 'profile')) personal.profile = COPY(applied.personal.profile);
      if (Object.hasOwn(applied.personal, 'priced')) personal.priced = COPY(applied.personal.priced);
      return { shared: COPY(applied.shared), personal };
    },

    // VS-01 has no permanent grant transaction. The consumer still requires the
    // interface; this adapter never writes collections or storage.
    async applyGrantsTransaction(grants) {
      if (!applied) throw new Error('MODEL_NOT_APPLIED');
      if (!Array.isArray(grants) || grants.length !== 0)
        throw new Error('PERMANENT_GRANTS_UNAVAILABLE');
    },

    // Test/diagnostic hook: mutate the applied model without touching the
    // received message. Used to prove captureAppliedState is re-read.
    tamper(mutator) {
      if (!applied) throw new Error('MODEL_NOT_APPLIED');
      mutator(applied);
    },

    get applied() { return applied; },
  });
}
