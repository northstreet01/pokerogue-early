// M2 Pokemon/ownership slice. It deliberately does not claim to save the scene,
// inventories, modifiers, trainer, decision queue or all random streams.
import { copy, canonical, requireContract as check } from './coop-contract.mjs';
const id = value => Number.isSafeInteger(value) && value >= 0 && value <= 4294967295;
const exact = (value, names) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...names].sort().join(','), 'INVALID_ROSTER');

export function createRosterStateCodec({ capturePokemonState, restorePokemonState }) {
  // transferSummon copies tag references, not tag values. Include primer paths
  // too, so restoring a cross-Pokemon alias preserves existing local aliases.
  function tagGroups(entries) {
    const groups = new Map();
    for (const { pokemon } of entries) for (const summon of ['summonData', 'summonDataPrimer']) {
      for (const [index, tag] of (pokemon[summon]?.tags ?? []).entries()) {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push({ pokemonId: pokemon.id, summon, index });
      }
    }
    return [...groups.values()].filter(group => new Set(group.map(ref => ref.pokemonId)).size > 1);
  }
  function validate(entries, field, retiredIds) {
    check(Array.isArray(entries) && entries.length <= 10000 && Array.isArray(field) && field.length === 4 && Array.isArray(retiredIds) && retiredIds.every(id), 'INVALID_ROSTER');
    const byId = new Map(), locations = new Set(), retired = new Set(retiredIds);
    check(retired.size === retiredIds.length, 'DUPLICATE_ID');
    for (const entry of entries) {
      exact(entry, ['owner', 'group', 'index', 'pokemon']);
      const p = entry.pokemon;
      check(p && id(p.id) && !byId.has(p.id) && !retired.has(p.id), 'DUPLICATE_ID');
      check(Number.isSafeInteger(entry.index) && entry.index >= 0 && entry.index < 10000, 'INVALID_ROSTER');
      check(entry.owner === null ? entry.group === 'enemy' && !p.isPlayer() : [0, 1].includes(entry.owner) && ['party', 'reserve'].includes(entry.group) && p.isPlayer(), 'INVALID_OWNER');
      const location = `${entry.owner}:${entry.group}:${entry.index}`;
      check(!locations.has(location), 'DUPLICATE_LOCATION'); locations.add(location); byId.set(p.id, entry);
    }
    const occupied = new Set();
    field.forEach((pokemonId, slot) => {
      if (pokemonId === null) return;
      check(id(pokemonId) && byId.has(pokemonId) && !occupied.has(pokemonId), 'INVALID_FIELD_REFERENCE');
      const entry = byId.get(pokemonId);
      check(slot < 2 ? entry.owner === slot && entry.group === 'party' : entry.owner === null && entry.group === 'enemy', 'INVALID_FIELD_OWNER');
      occupied.add(pokemonId);
    });
    // Historical sources can refer to explicitly retained retired IDs. Never
    // silently replace a missing reference with a new instance or a slot index.
    const known = sourceId => sourceId === undefined || sourceId === null || id(sourceId) && (byId.has(sourceId) || retired.has(sourceId));
    for (const { pokemon } of entries) {
      for (const summon of [pokemon.summonData, pokemon.summonDataPrimer]) for (const tag of summon?.tags ?? []) check(known(tag.sourceId), 'UNKNOWN_SOURCE');
      for (const attack of pokemon.turnData?.attacksReceived ?? []) check(known(attack.sourceId), 'UNKNOWN_SOURCE');
    }
  }
  return Object.freeze({
    capture(roster) {
      exact(roster, ['entries', 'field', 'retiredIds']);
      validate(roster.entries, roster.field, roster.retiredIds);
      return { version: 2, entries: roster.entries.map(entry => ({ owner: entry.owner, group: entry.group, index: entry.index, pokemon: capturePokemonState(entry.pokemon) })), field: copy(roster.field), retiredIds: copy(roster.retiredIds), tagGroups: tagGroups(roster.entries) };
    },
    restore(input) {
      const snapshot = copy(input); // Reject getters/undefined/unknown executable values.
      check(snapshot.version === 2, 'VERSION_MISMATCH');
      exact(snapshot, ['version', 'entries', 'field', 'retiredIds', 'tagGroups']);
      check(Array.isArray(snapshot.entries) && snapshot.entries.length <= 10000, 'INVALID_ROSTER');
      const entries = snapshot.entries.map(entry => {
        exact(entry, ['owner', 'group', 'index', 'pokemon']);
        return { ...entry, pokemon: restorePokemonState(entry.pokemon) };
      });
      validate(entries, snapshot.field, snapshot.retiredIds);
      const byId = new Map(entries.map((entry, index) => [entry.pokemon.id, { pokemon: entry.pokemon, saved: snapshot.entries[index].pokemon }]));
      check(Array.isArray(snapshot.tagGroups) && snapshot.tagGroups.length <= 10000, 'INVALID_TAG_ALIAS');
      const used = new Set();
      for (const group of snapshot.tagGroups) {
        check(Array.isArray(group) && group.length > 1 && group.length <= entries.length * 256, 'INVALID_TAG_ALIAS');
        let shared, state;
        for (const ref of group) {
          exact(ref, ['pokemonId', 'summon', 'index']);
          check(id(ref.pokemonId) && byId.has(ref.pokemonId) && ['summonData', 'summonDataPrimer'].includes(ref.summon)
            && Number.isInteger(ref.index) && ref.index >= 0 && ref.index < 128, 'INVALID_TAG_ALIAS');
          const key = canonical(ref), entry = byId.get(ref.pokemonId), tags = entry.pokemon[ref.summon]?.tags;
          check(tags && ref.index < tags.length && !used.has(key), 'INVALID_TAG_ALIAS'); used.add(key);
          const encoded = canonical(entry.saved.fields[ref.summon].fields.tags[ref.index]);
          if (state === undefined) { state = encoded; shared = tags[ref.index]; }
          else { check(encoded === state, 'INVALID_TAG_ALIAS'); tags[ref.index] = shared; }
        }
      }
      // Reject incomplete/conflicting local alias groups and noncanonical paths.
      check(canonical(tagGroups(entries)) === canonical(snapshot.tagGroups), 'INVALID_TAG_ALIAS');
      return { entries, field: snapshot.field, retiredIds: snapshot.retiredIds };
    }
  });
}
