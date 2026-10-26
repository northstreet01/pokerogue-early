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
  // Session ownership is checked inside the transaction, after opening the DB.
  // A delayed old connection cannot reactivate a seat after leave/new-session.
  const owned = (target, origin, session, operation, done) => {
    target.get(`active:${origin}`).onsuccess = event => {
      const active = event.target.result;
      if (!session.isCurrent() || active?.sessionId !== session.id || active.paused) { done(false); return; }
      operation(); done(true);
    };
  };
  return Object.freeze({
    listSeats(origin) {
      return transact(SEATS, 'readonly', (target, done) => {
        const out = [];
        target.openCursor().onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) { done(out); return; }
          const value = cursor.value;
          if (String(cursor.key).startsWith(origin + '|') && /^[A-Z0-9]{6}$/i.test(value?.roomId)
            && [0, 1].includes(value.seat) && typeof value.token === 'string' && value.token)
            out.push({ roomId: value.roomId, seat: value.seat, ...(value.profileId ? {profileId:value.profileId} : {}),
              ...(value.hostId?{hostId:value.hostId,endpoint:value.endpoint}: {}) });
          cursor.continue();
        };
      });
    },
    // Only a deliberate home selection may reactivate an explicitly paused seat.
    resumeSession(origin, session, roomId, seat) {
      return transact(SEATS, 'readwrite', (target, done) => {
        const key = seatKey(origin, roomId, seat);
        target.get(key).onsuccess = event => {
          const value = event.target.result;
          if (!session.isCurrent() || value?.roomId !== roomId || value?.seat !== seat || !value?.token) {
            done(null); return;
          }
          target.put({ sessionId: session.id, key, paused: false }, `active:${origin}`);
          done(value);
        };
      });
    },
    async loadSeat(origin) {
      const active = await get(SEATS, `active:${origin}`);
      if (active && typeof active === 'object') return active.paused || !active.key ? null : get(SEATS, active.key);
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
    beginSession(origin, session, resume = false) {
      return transact(SEATS, 'readwrite', (target, done) => {
        const activate = (key, value) => {
          if (!session.isCurrent()) { done(null); return; }
          target.put({ sessionId: session.id, key, paused: false }, `active:${origin}`);
          done(value);
        };
        if (!resume) { activate(null, null); return; }
        target.get(`active:${origin}`).onsuccess = event => {
          const active = event.target.result;
          if (active && typeof active === 'object' && (active.paused || !active.key)) { done(null); return; }
          const key = typeof active === 'string' ? active : active?.key;
          if (key) {
            target.get(key).onsuccess = entry => activate(key, entry.target.result ?? null);
            return;
          }
          const entries = [];
          target.openCursor().onsuccess = entry => {
            const cursor = entry.target.result;
            if (!cursor) {
              if (entries.length === 1) activate(entries[0].key, entries[0].value);
              else done(null);
              return;
            }
            if (String(cursor.key).startsWith(origin + '|')) entries.push({ key: cursor.key, value: cursor.value });
            cursor.continue();
          };
        };
      });
    },
    pauseSession(origin, session) {
      return transact(SEATS, 'readwrite', (target, done) => {
        target.get(`active:${origin}`).onsuccess = event => {
          const active = event.target.result;
          // Do not let an old page's late leave clear a newer explicit session.
          if (active?.sessionId && active.sessionId !== session.id) { done(false); return; }
          target.put({ sessionId: session.id, key: null, paused: true }, `active:${origin}`);
          done(true);
        };
      });
    },
    saveSeat(origin, value, session = null) {
      return transact(SEATS, 'readwrite', (target, done) => {
        const key = seatKey(origin, value.roomId, value.seat);
        const write = () => {
          target.put(value, key);
          target.put(session ? { sessionId: session.id, key, paused: false } : key, `active:${origin}`);
        };
        if (session) owned(target, origin, session, write, done);
        else { write(); done(true); }
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
