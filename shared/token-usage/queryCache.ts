/** Short-lived query results shared by same-origin windows, including separate WebViews. */
const DATABASE = 'remoteai-token-queries-v1';
const STORE = 'results';
export const MAX_QUERY_ENTRIES = 24;
export const MAX_QUERY_BYTES = 8 * 1024 * 1024;
const RETENTION_MS = 5 * 60 * 1000;

interface Entry { key: string; value: unknown; savedAt: number; startedAt: number; bytes: number }
interface Query<T> { key: string; load: () => Promise<T>; maxAgeMs: number; cacheable?: (value: T) => boolean }
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
let generation = 0;

function fresh(entry: Entry | undefined, since: number): entry is Entry {
  return !!entry && entry.savedAt >= since && entry.savedAt <= Date.now();
}

function retain(entry: Entry) {
  memory.delete(entry.key);
  if (entry.bytes > MAX_QUERY_BYTES) return;
  memory.set(entry.key, entry);
  let bytes = [...memory.values()].reduce((sum, item) => sum + item.bytes, 0);
  for (const [key, item] of memory) {
    if (item.savedAt < Date.now() - RETENTION_MS || memory.size > MAX_QUERY_ENTRIES || bytes > MAX_QUERY_BYTES) {
      memory.delete(key);
      bytes -= item.bytes;
    }
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const complete = (db: IDBDatabase | null) => {
      if (settled) { db?.close(); return; }
      settled = true;
      resolve(db);
    };
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onerror = () => complete(null);
    request.onblocked = () => complete(null);
    request.onsuccess = () => complete(request.result);
  });
}

async function readStored(key: string): Promise<Entry | undefined> {
  const db = await openDatabase();
  if (!db) return;
  try {
    return await new Promise<Entry | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as Entry | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function writeStored(entry: Entry, current: () => boolean) {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        if (!current()) return;
        const previous = (request.result as Entry[]).find(item => item.key === entry.key);
        // Runtimes without Web Locks may finish an older read last; it must not replace newer shared data.
        if (previous && previous.startedAt > entry.startedAt) return;
        const entries = (request.result as Entry[]).filter(item => item.key !== entry.key);
        if (entry.bytes <= MAX_QUERY_BYTES) entries.push(entry);
        entries.sort((a, b) => b.savedAt - a.savedAt);
        let bytes = 0;
        store.clear();
        entries.forEach((item, index) => {
          bytes += item.bytes;
          if (index < MAX_QUERY_ENTRIES && bytes <= MAX_QUERY_BYTES && item.savedAt >= Date.now() - RETENTION_MS) {
            store.put(item);
          }
        });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function readQuery<T>(query: Query<T>, since: number, version: number): Promise<T> {
  const stored = await readStored(query.key).catch(() => undefined);
  if (fresh(stored, since)) { retain(stored); return stored.value as T; }
  const startedAt = Date.now();
  const value = await query.load();
  const current = () => generation === version && (!query.cacheable || query.cacheable(value));
  if (!current()) return value;
  const entry = { key: query.key, value, startedAt, savedAt: Date.now(), bytes: JSON.stringify(value).length * 2 };
  retain(entry);
  // Storage denial/full disks must not turn a successful request into an error or trigger another read.
  await writeStored(entry, current).catch(() => undefined);
  return value;
}

function withQueryLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  let started = false;
  try {
    const locks = globalThis.navigator?.locks;
    if (!locks) return run();
    return locks.request(`${DATABASE}:${key}`, () => { started = true; return run(); }).catch(error => {
      // A denied lock can fall back; a failed data request must never be invoked twice.
      if (started) throw error;
      return run();
    });
  } catch (error) { return started ? Promise.reject(error) : run(); }
}

export function readTokenQuery<T>(query: Query<T>): Promise<T> {
  const since = Date.now() - Math.min(RETENTION_MS, Math.max(0, query.maxAgeMs));
  const existing = pending.get(query.key);
  if (existing) return existing as Promise<T>;
  const cached = memory.get(query.key);
  if (fresh(cached, since)) return Promise.resolve(cached.value as T);
  // The lock and IndexedDB are browser services, not module memory. Recheck inside the lock:
  // another window may have completed the same query while this window was waiting.
  const version = generation;
  const run = () => readQuery(query, since, version);
  const request = withQueryLock(query.key, run);
  if (pending.size < MAX_QUERY_ENTRIES) pending.set(query.key, request);
  void request.finally(() => { if (pending.get(query.key) === request) pending.delete(query.key); }).catch(() => undefined);
  return request;
}

/** Stop reusing a retired authenticated source, including reads that were already in flight. */
export async function invalidateTokenQueries(prefix: string) {
  generation++;
  for (const key of memory.keys()) if (key.startsWith(prefix)) memory.delete(key);
  for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key);
  const db = await openDatabase().catch(() => null);
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const request = store.getAllKeys();
      request.onsuccess = () => {
        for (const key of request.result) if (typeof key === 'string' && key.startsWith(prefix)) store.delete(key);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* Storage denial must not prevent signing out or switching sources. */ }
  finally { db.close(); }
}
