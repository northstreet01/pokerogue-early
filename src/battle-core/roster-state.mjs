// M2 Pokemon/ownership slice. It deliberately does not claim to save the scene,
// inventories, modifiers, trainer, decision queue or all random streams.
import { copy, requireContract as check } from './coop-contract.mjs';
const id = value => Number.isSafeInteger(value) && value >= 0 && value <= 4294967295;
const exact = (value, names) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...names].sort().join(','), 'INVALID_ROSTER');

export function createRosterStateCodec({ capturePokemonState, restorePokemonState }) {
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
      return { version: 1, entries: roster.entries.map(entry => ({ owner: entry.owner, group: entry.group, index: entry.index, pokemon: capturePokemonState(entry.pokemon) })), field: copy(roster.field), retiredIds: copy(roster.retiredIds) };
    },
    restore(input) {
      const snapshot = copy(input); // Reject getters/undefined/unknown executable values.
      exact(snapshot, ['version', 'entries', 'field', 'retiredIds']);
      check(snapshot.version === 1 && Array.isArray(snapshot.entries) && snapshot.entries.length <= 10000, 'INVALID_ROSTER');
      const entries = snapshot.entries.map(entry => {
        exact(entry, ['owner', 'group', 'index', 'pokemon']);
        return { ...entry, pokemon: restorePokemonState(entry.pokemon) };
      });
      validate(entries, snapshot.field, snapshot.retiredIds);
      return { entries, field: snapshot.field, retiredIds: snapshot.retiredIds };
    }
  });
}
