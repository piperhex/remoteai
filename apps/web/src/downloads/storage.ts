import type { DownloadTask } from './types';

const DATABASE_NAME = 'codex-switch.web.downloads.v1';
const TASKS = 'tasks';
const CHUNKS = 'chunks';
const MANIFESTS = 'manifests';
let database: Promise<IDBDatabase> | undefined;

export function openDownloadDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(TASKS)) request.result.createObjectStore(TASKS, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(CHUNKS)) {
        request.result.createObjectStore(CHUNKS, { keyPath: ['id', 'offset'] });
      }
      request.result.createObjectStore(MANIFESTS, { keyPath: ['id', 'page'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}

export function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Download storage aborted'));
    transaction.onerror = () => reject(transaction.error);
  });
}

export function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const chunkRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

export async function listDownloads(): Promise<DownloadTask[]> {
  const db = await openDownloadDatabase();
  return result(db.transaction(TASKS).objectStore(TASKS).getAll());
}
export async function storeDownload(task: DownloadTask) {
  const db = await openDownloadDatabase();
  const transaction = db.transaction(TASKS, 'readwrite');
  transaction.objectStore(TASKS).put(task);
  await complete(transaction);
}

/** Commit bytes and their resume offset atomically, including when the tab is closed mid-write. */
export async function storeChunk(task: DownloadTask, offset: number, data: string) {
  const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
  const db = await openDownloadDatabase();
  const transaction = db.transaction([TASKS, CHUNKS], 'readwrite');
  transaction.objectStore(CHUNKS).put({ id: task.id, offset, blob: new Blob([bytes]) });
  transaction.objectStore(TASKS).put(task);
  await complete(transaction);
}

export async function resetDownload(task: DownloadTask) {
  const db = await openDownloadDatabase();
  const transaction = db.transaction([TASKS, CHUNKS], 'readwrite');
  transaction.objectStore(CHUNKS).delete(chunkRange(task.id));
  transaction.objectStore(TASKS).put(task);
  await complete(transaction);
}

export async function deleteDownload(id: string) {
  const db = await openDownloadDatabase();
  const transaction = db.transaction([TASKS, CHUNKS, MANIFESTS], 'readwrite');
  transaction.objectStore(CHUNKS).delete(chunkRange(id));
  transaction.objectStore(TASKS).delete(id);
  transaction.objectStore(MANIFESTS).delete(chunkRange(id));
  await complete(transaction);
}

export async function readStoredBlock(id: string, offset: number): Promise<Blob | undefined> {
  const db = await openDownloadDatabase();
  const chunk = await result<{ blob: Blob } | undefined>(db.transaction(CHUNKS).objectStore(CHUNKS).get([id, offset]));
  return chunk?.blob;
}

export async function downloadContent(task: DownloadTask) {
  const db = await openDownloadDatabase();
  const chunks: { id: string; offset: number; blob: Blob }[] = await result(
    db.transaction(CHUNKS).objectStore(CHUNKS).getAll(chunkRange(task.id)));
  let offset = 0;
  for (const chunk of chunks) {
    if (chunk.offset !== offset) throw new Error('Incomplete download');
    offset += chunk.blob.size;
  }
  if (offset !== task.size) throw new Error('Incomplete download');
  return new Blob(chunks.map(chunk => chunk.blob), { type: task.mimeType });
}
