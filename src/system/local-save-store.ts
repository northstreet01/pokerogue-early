const DB_NAME = 'pokerogue-early-local';
const DB_VERSION = 1;
const STORE = 'saves';
let database: Promise<IDBDatabase>;

interface SaveRecord {
  schema: 1;
  value: string;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('请关闭其他旧版本页面后重试本地存档'));
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); database = undefined; };
        resolve(request.result);
      };
    }).catch(error => { database = undefined; throw error; });
  }
  return database;
}

function validateRecord(record: SaveRecord): string {
  if (record.schema !== 1 || typeof record.value !== 'string') throw new Error('本地存档格式不受支持');
  JSON.parse(record.value);
  return record.value;
}

export function sessionSaveKey(slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) throw new Error('无效的存档槽位');
  return slot === 0 ? 'sessionData' : `sessionData${slot}`;
}

/** Resolve writes only after the complete IndexedDB transaction is committed. */
export async function writeLocalSave(key: string, value: string, expectedValue?: string | null): Promise<void> {
  JSON.parse(value);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    let failure: Error;
    if (key === 'data') {
      const lease = store.get('coop-profile-lease');
      lease.onsuccess = () => {
        if (lease.result && JSON.parse(validateRecord(lease.result)).expires > Date.now()) {
          failure = new Error('合作冒险正在使用收藏存档，请先退出合作页面再保存单人游戏');
          transaction.abort();
        }
      };
    }
    const previous = store.get(key);
    previous.onsuccess = () => {
      if (expectedValue !== undefined && (previous.result ? validateRecord(previous.result) : null) !== expectedValue) {
        failure = new Error('本地收藏已被其他页面更新，请重新进入游戏后再保存'); transaction.abort(); return;
      }
      if (previous.result) store.put(previous.result, `${key}:backup`);
      store.put({ schema: 1, value, updatedAt: Date.now() } satisfies SaveRecord, key);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('本地存档写入失败'));
    transaction.onerror = () => {}; // onabort reports the transaction failure.
  });
}

export async function readLocalSave(key: string): Promise<string | null> {
  return (await readLocalSaveSnapshot([key]))[key];
}

/** Read collection and receipt records from one consistent database snapshot. */
export async function readLocalSaveSnapshot(keys: string[]): Promise<Record<string, string | null>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const records: Record<string, string | null> = {};
    let failure: unknown;
    transaction.onabort = () => reject(failure ?? transaction.error);
    transaction.oncomplete = () => resolve(records);
    for (const key of keys) {
      const request = transaction.objectStore(STORE).get(key);
      request.onsuccess = () => {
        try { records[key] = request.result ? validateRecord(request.result) : null; }
        catch (error) { failure = error; transaction.abort(); }
      };
    }
  });
}

export async function deleteLocalSave(key: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const previous = store.get(key);
    previous.onsuccess = () => {
      if (previous.result) store.put(previous.result, `${key}:backup`);
      store.delete(key);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Restore a validated archive atomically, retaining current primary records as backups. */
export async function restoreLocalSaves(records: Record<string, string>): Promise<void> {
  const primary = ['data', 'coop-grants', 'coop-experiment-data', 'coop-experiment-grants', 'coop-seats', ...[0, 1, 2].map(sessionSaveKey)];
  const allowed = [...primary, ...primary.map(key => `${key}:backup`)];
  for (const [key, value] of Object.entries(records)) {
    if (!allowed.includes(key) || typeof value !== 'string') throw new Error('备份包含不支持的记录');
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('备份记录格式无效');
  }
  if (!records.data && !primary.some(key => records[key])) throw new Error('备份没有可恢复的存档');
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    let failure: Error;
    const lease = store.get('coop-profile-lease');
    lease.onsuccess = () => { if (lease.result && JSON.parse(validateRecord(lease.result)).expires > Date.now()) {
      failure = new Error('合作页面正在使用收藏，请先退出合作连接再恢复备份'); transaction.abort();
    } };
    for (const key of primary) {
      const previous = store.get(key);
      previous.onsuccess = () => {
        if (previous.result) store.put(previous.result, `${key}:backup`);
        else if (records[`${key}:backup`]) store.put({ schema: 1, value: records[`${key}:backup`], updatedAt: Date.now() }, `${key}:backup`);
        if (records[key]) store.put({ schema: 1, value: records[key], updatedAt: Date.now() }, key);
        else store.delete(key);
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(failure ?? transaction.error);
  });
}

/** Synchronous mutation after all reads, in one transaction; no network awaits inside it. */
export async function mutateLocalSaves(keys: string[], mutation: (records: Record<string, string | null>) => Record<string, string | null>): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite'), store = transaction.objectStore(STORE);
    const records: Record<string, string | null> = {}, previous: Record<string, SaveRecord> = {};
    let remaining = keys.length, failure: unknown;
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          previous[key] = request.result; records[key] = request.result ? validateRecord(request.result) : null;
          if (--remaining) return;
          const updates = mutation(records);
          for (const [key, value] of Object.entries(updates)) {
            if (!keys.includes(key)) throw new Error('事务不能修改未读取的记录');
            if (value !== null) JSON.parse(value);
          }
          for (const [key, value] of Object.entries(updates)) {
            if (previous[key] && key !== 'coop-profile-lease') store.put(previous[key], `${key}:backup`);
            if (value === null) store.delete(key);
            else store.put({ schema: 1, value, updatedAt: Date.now() } satisfies SaveRecord, key);
          }
        } catch (error) { failure = error; transaction.abort(); }
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('本地事务失败'));
  });
}
