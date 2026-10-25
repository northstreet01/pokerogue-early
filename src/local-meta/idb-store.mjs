import { check, json } from './codec.mjs';

// Separate database: importing this module neither opens nor upgrades the old DB.
export function createMetaStore({ indexedDB = globalThis.indexedDB, name = 'pokerogue-local-meta' } = {}) {
  async function run(keys, write, mutation) {
    check(Array.isArray(keys) && keys.length > 0 && new Set(keys).size === keys.length
      && keys.every(k => typeof k === 'string' && !['__proto__','prototype','constructor'].includes(k)), 'INVALID_STORE_KEYS');
    check(indexedDB, 'LOCAL_STORAGE_UNAVAILABLE');
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1); let failed = false;
      req.onupgradeneeded = () => req.result.createObjectStore('records');
      req.onblocked = () => { failed = true; reject(new Error('LOCAL_DATABASE_BLOCKED')); };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { if (failed) req.result.close(); else { req.result.onversionchange = () => req.result.close(); resolve(req.result); } };
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('records', write ? 'readwrite' : 'readonly'), store = tx.objectStore('records');
        const records = {}; let remaining = keys.length, result, failure;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => {};
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('LOCAL_TRANSACTION_ABORTED'));
        for (const key of keys) store.get(key).onsuccess = event => {
          try {
            records[key] = event.target.result === undefined ? null : json(event.target.result);
            if (--remaining) return;
            if (!write) { result = records; return; }
            const update = mutation(records);
            check(update && typeof update === 'object' && !('then' in update), 'ASYNC_LOCAL_TRANSACTION');
            check(update.changes && Object.keys(update.changes).every(k => keys.includes(k)), 'UNREAD_LOCAL_WRITE');
            const changes = json(update.changes);
            for (const [k,v] of Object.entries(changes)) v === null ? store.delete(k) : store.put(v, k);
            result = update.result === undefined ? null : json(update.result);
          } catch (error) { failure = error; tx.abort(); }
        };
      });
    } finally { db.close(); }
  }
  return Object.freeze({ read: keys => run(keys, false), transact: (keys, mutation) => run(keys, true, mutation) });
}
