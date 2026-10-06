import { complete, openDownloadDatabase, result } from './storage';

interface StoredRange { offset: number; blob: Blob }

/** Reads at most one logical block, including legacy chunks that cross its boundaries. */
export async function readStoredRange(id: string, offset: number, length: number): Promise<Blob | undefined> {
  const db = await openDownloadDatabase();
  const before = IDBKeyRange.bound([id, 0], [id, offset]);
  const first = await result(db.transaction('chunks').objectStore('chunks').openCursor(before, 'prev'));
  const start = (first?.value as StoredRange | undefined)?.offset;
  if (start === undefined) return undefined;
  const chunks = await result<StoredRange[]>(db.transaction('chunks').objectStore('chunks')
    .getAll(IDBKeyRange.bound([id, start], [id, offset + length], false, true)));
  const slices: Blob[] = [];
  let next = offset;
  for (const chunk of chunks) {
    if (chunk.offset > next || chunk.offset + chunk.blob.size <= next) return undefined;
    const end = Math.min(offset + length, chunk.offset + chunk.blob.size);
    slices.push(chunk.blob.slice(next - chunk.offset, end - chunk.offset)); next = end;
    if (next === offset + length) return new Blob(slices);
  }
  return undefined;
}

/** Replaces disjoint ranges in one transaction while preserving bytes outside their boundaries.
 * IDB callbacks serialize adjacent replacements so a split tail cannot overwrite the next block.
 */
export function replaceChunkRanges(store: IDBObjectStore, id: string, ranges: StoredRange[]) {
  let index = 0;
  const next = () => {
    const range = ranges[index++];
    if (!range) return;
    const before = store.openCursor(IDBKeyRange.bound([id, 0], [id, range.offset]), 'prev');
    before.onsuccess = () => {
      const start = (before.result?.value as StoredRange | undefined)?.offset ?? range.offset;
      replaceRange({ store, id, range, start, done: next });
    };
  };
  next();
}

function replaceRange(options: {
  store: IDBObjectStore; id: string; range: StoredRange; start: number; done: () => void;
}) {
  const { store, id, range, start, done } = options;
  const end = range.offset + range.blob.size;
  const request = store.openCursor(IDBKeyRange.bound([id, start], [id, end], false, true));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) { store.put({ id, ...range }); done(); return; }
    const chunk = cursor.value as StoredRange;
    const chunkEnd = chunk.offset + chunk.blob.size;
    if (chunkEnd > range.offset) {
      cursor.delete();
      if (chunk.offset < range.offset) {
        store.put({ id, offset: chunk.offset, blob: chunk.blob.slice(0, range.offset - chunk.offset) });
      }
      if (chunkEnd > end) store.put({ id, offset: end, blob: chunk.blob.slice(end - chunk.offset) });
    }
    cursor.continue();
  };
}

/** Keep the legacy prefix readable if migration is interrupted before its new checkpoint is saved. */
export async function coalesceStoredRange(id: string, offset: number, blob: Blob) {
  const db = await openDownloadDatabase();
  const transaction = db.transaction('chunks', 'readwrite');
  replaceChunkRanges(transaction.objectStore('chunks'), id, [{ offset, blob }]);
  await complete(transaction);
}

/** Trim stale source bytes in the same transaction that records the new file size. */
export function truncateChunks(store: IDBObjectStore, id: string, size: number) {
  const before = store.openCursor(IDBKeyRange.bound([id, 0], [id, size]), 'prev');
  before.onsuccess = () => {
    const chunk = before.result?.value as StoredRange | undefined;
    if (chunk && chunk.offset < size && chunk.offset + chunk.blob.size > size) {
      store.put({ id, offset: chunk.offset, blob: chunk.blob.slice(0, size - chunk.offset) });
    }
    store.delete(IDBKeyRange.bound([id, size], [id, Number.MAX_SAFE_INTEGER]));
  };
}
