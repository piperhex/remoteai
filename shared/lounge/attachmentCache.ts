import type { AttachmentSink, AttachmentSource, LoungeAttachment } from './attachments';
import { imageAttachmentSource } from './imageAttachmentSource';
export interface AttachmentImageStore {
  get: (id: string) => Promise<string | undefined>;
  put: (id: string, uri: string) => Promise<void>;
  sink: (file: LoungeAttachment) => Promise<AttachmentSink>;
  source?: (id: string) => Promise<AttachmentSource | undefined>;
}

/** Images remain available offline in the receiving account's local archive. */
export function browserAttachmentImages(scope: string, sink: AttachmentImageStore['sink']): AttachmentImageStore {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('remoteai-lounge-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = undefined; reject(request.error); };
  });
  const store: AttachmentImageStore = { sink,
    get: async id => {
      const database = await open();
      return new Promise((resolve, reject) => {
        const request = database.transaction('images').objectStore('images').get([scope, id]);
        request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : undefined);
        request.onerror = () => reject(request.error);
      });
    },
    put: async (id, uri) => {
      const database = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('images', 'readwrite');
        transaction.objectStore('images').put(uri, [scope, id]);
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error);
      });
    },
  };
  store.source = async id => {
    const data = await store.get(id);
    return data ? imageAttachmentSource(data) : undefined;
  };
  return store;
}
