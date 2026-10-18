const DB_NAME = 'coop-play-v1';
const SEATS = 'seats', OUTBOX = 'outbox';
const seatKey = (origin, roomId, seat) => `${origin}|${roomId}|${seat}`;
const actionKey = (origin, roomId, seat, actionId) => `${seatKey(origin, roomId, seat)}|${actionId}`;

// Resolve only after transaction commit, and close every opened connection.
export function createPlayStorage(factory = globalThis.indexedDB) {
  async function transact(store, mode, operation) {
    const db = await new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        for (const name of [SEATS, OUTBOX])
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error ?? new Error('LOCAL_TRANSACTION_ABORTED'));
        tx.onerror = () => reject(tx.error ?? new Error('LOCAL_TRANSACTION_FAILED'));
        operation(tx.objectStore(store), value => { result = value; });
      });
    } finally { db.close(); }
  }
  const get = (store, key) => transact(store, 'readonly', (target, done) => {
    target.get(key).onsuccess = event => done(event.target.result ?? null);
  });
  return Object.freeze({
    async loadSeat(origin) {
      const active = await get(SEATS, `active:${origin}`);
      if (active) return get(SEATS, active);
      // Upgrade old pages safely: only auto-resume when the choice is unique.
      const values = await transact(SEATS, 'readonly', (target, done) => {
        const out = [];
        target.openCursor().onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) { done(out); return; }
          if (String(cursor.key).startsWith(origin + '|')) out.push(cursor.value);
          cursor.continue();
        };
      });
      return values.length === 1 ? values[0] : null;
    },
    saveSeat(origin, value) {
      return transact(SEATS, 'readwrite', (target) => {
        const key = seatKey(origin, value.roomId, value.seat);
        target.put(value, key); target.put(key, `active:${origin}`);
      });
    },
    saveAction(origin, seat, message) {
      return transact(OUTBOX, 'readwrite', target =>
        target.put(message, actionKey(origin, message.roomId, seat, message.actionId)));
    },
    deleteAction(origin, roomId, seat, actionId) {
      return transact(OUTBOX, 'readwrite', target => target.delete(actionKey(origin, roomId, seat, actionId)));
    },
    pendingActions(origin, roomId, seat) {
      return transact(OUTBOX, 'readonly', (target, done) => {
        const out = [], prefix = seatKey(origin, roomId, seat) + '|';
        target.openCursor().onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) { done(out.sort((a, b) => a.expectedRevision - b.expectedRevision)); return; }
          if (String(cursor.key).startsWith(prefix)) out.push(cursor.value);
          cursor.continue();
        };
      });
    },
  });
}
