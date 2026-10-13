import { copy, requireContract as check } from './coop-contract.mjs';

// Immutable rule closures stay in trusted content modules. Their table key and
// array position are stable within the negotiated contentHash, never functions
// supplied by the checkpoint. Recovery must not rerun condition predicates.
export function createCatalogReferenceCodec(table) {
  const references = new Map();
  for (const [id, entries] of Object.entries(table)) {
    check(Array.isArray(entries), 'INVALID_CATALOG');
    entries.forEach((value,index) => {
      check(value && typeof value === 'object' && !references.has(value), 'INVALID_CATALOG');
      references.set(value, { id: Number(id), index });
    });
  }
  return Object.freeze({
    capture(value) { check(references.has(value), 'UNKNOWN_CATALOG_REFERENCE'); return {...references.get(value)}; },
    restore(input) {
      const ref=copy(input);
      check(ref && Object.keys(ref).sort().join(',')==='id,index' && Number.isSafeInteger(ref.id)
        && Number.isSafeInteger(ref.index) && ref.index>=0 && Object.hasOwn(table,ref.id)
        && ref.index<table[ref.id].length, 'UNKNOWN_CATALOG_REFERENCE');
      return table[ref.id][ref.index];
    }
  });
}
