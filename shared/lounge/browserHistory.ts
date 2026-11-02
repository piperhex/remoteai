import { historyKey, historyPage, historyPageLimit, historyScope, historyText, historyTerms,
  messageBytes, RECENT_BYTE_LIMIT,
  type HistoryQuery, type LoungeHistoryStore } from './archive';
import { parseMessage, type LoungeMessage } from './types';
import { mergeContact, parseContact, type LoungeContact } from './contacts';
import { mergeDelivery, needsDeliveryWork } from './delivery';

const DATABASE = 'remoteai-lounge-history-v1';
const META = 'metadata';
const CONTENT = 'content';
const CONTACTS = 'contacts';
interface Metadata {
  scope: string; key: string; time: number; search: string; conversation?: string; pending?: boolean; generation?: number;
}
let opening: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(META)) {
        const metadata = request.result.createObjectStore(META, { keyPath: ['scope', 'key'] });
        metadata.createIndex('timeline', ['scope', 'time', 'key']);
        request.result.createObjectStore(CONTENT);
      }
      request.result.createObjectStore(CONTACTS, { keyPath: ['scope', 'id'] });
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) { database.close(); return; }
      database.onversionchange = () => { database.close(); opening = undefined; };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('History database is blocked')); };
  }).catch((error: unknown) => { opening = undefined; throw error; });
}

function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('History transaction aborted'));
    transaction.onerror = () => reject(transaction.error);
  });
}

async function save(scope: string, message: LoungeMessage) {
  const database = await openDatabase();
  const transaction = database.transaction([META, CONTENT], 'readwrite');
  const finished = complete(transaction);
  const key = historyKey(message);
  const content = transaction.objectStore(CONTENT);
  const write = (delivery = message.delivery) => {
    transaction.objectStore(META).put({ scope, key, time: Date.parse(message.sentAt), search: historyText(message),
      conversation: message.conversation ?? '', pending: needsDeliveryWork(delivery), generation: message.generation });
    content.put({ ...message, delivery }, [scope, key]);
  };
  if (message.delivery) {
    const previous = content.get([scope, key]);
    previous.onsuccess = () => write(mergeDelivery(parseMessage(previous.result)?.delivery, message.delivery));
  } else write();
  await finished;
}

async function search(scope: string, query: HistoryQuery) {
  const database = await openDatabase();
  const transaction = database.transaction([META, CONTENT]);
  const finished = complete(transaction);
  const terms = historyTerms(query.query);
  const upper = query.before ? [scope, query.before.time, query.before.key] : [scope, Number.MAX_SAFE_INTEGER, []];
  const lower = query.after ? [scope, query.after.time, query.after.key] : [scope, -Number.MAX_SAFE_INTEGER, ''];
  const range = IDBKeyRange.bound(lower, upper, !!query.after, !!query.before);
  const values: LoungeMessage[] = [];
  let bytes = 0;
  const cursor = transaction.objectStore(META).index('timeline').openCursor(range, query.after ? 'next' : 'prev');
  cursor.onsuccess = () => {
    const row = cursor.result;
    if (!row || values.length > historyPageLimit(query) || bytes > RECENT_BYTE_LIMIT) return;
    const metadata = row.value as Metadata;
    if (query.pendingOnly && !metadata.pending) { row.continue(); return; }
    if (query.conversation !== undefined && (metadata.conversation ?? '') !== query.conversation) {
      row.continue(); return;
    }
    if (!terms.every(term => metadata.search.includes(term))) { row.continue(); return; }
    const content = transaction.objectStore(CONTENT).get([scope, metadata.key]);
    content.onsuccess = () => {
      const message = parseMessage(content.result);
      if (message) { values.push(message); bytes += messageBytes(message); }
      row.continue();
    };
  };
  await finished;
  return historyPage(values, query);
}

/** Account-scoped local storage; same-account devices exchange records through the encrypted sync transport. */
export function browserLoungeHistory(baseUrl: string, account: string): LoungeHistoryStore {
  const scope = historyScope(baseUrl, account);
  return { save: message => save(scope, message), page: query => search(scope, query),
    contacts: () => contacts(scope), saveContact: contact => saveContact(scope, contact),
    get: key => get(scope, key), deleteConversation: (peer, generation) => deleteConversation(scope, peer, generation) };
}

async function deleteConversation(scope: string, peer: string, generation = Number.MAX_SAFE_INTEGER) {
  const db = await openDatabase();
  const tx = db.transaction([META, CONTENT, CONTACTS], 'readwrite'); const done = complete(tx);
  let retained = false;
  const cursor = tx.objectStore(META).openCursor(IDBKeyRange.bound([scope, ''], [scope, []]));
  cursor.onsuccess = () => {
    const row = cursor.result;
    if (!row) { if (!retained) tx.objectStore(CONTACTS).delete([scope, peer]); return; }
    const metadata = row.value as Metadata;
    if (metadata.conversation === peer) {
      if ((metadata.generation ?? 0) < generation) {
        tx.objectStore(CONTENT).delete([scope, metadata.key]); row.delete();
      } else retained = true;
    }
    row.continue();
  };
  await done;
}

async function get(scope: string, key: string) {
  const db = await openDatabase();
  const tx = db.transaction(CONTENT); const done = complete(tx);
  const request = tx.objectStore(CONTENT).get([scope, key]);
  let message: LoungeMessage | undefined;
  request.onsuccess = () => { message = parseMessage(request.result); };
  await done; return message;
}

async function contacts(scope: string) {
  const db = await openDatabase();
  const tx = db.transaction([CONTACTS, META], 'readwrite'); const done = complete(tx);
  const store = tx.objectStore(CONTACTS);
  const request = store.getAll(IDBKeyRange.bound([scope, ''], [scope, []]));
  const values: LoungeContact[] = [];
  request.onsuccess = () => {
    for (const row of request.result) { const value = parseContact(row); if (value) values.push(value); }
    restoreContactTimes({ tx, scope, values });
  };
  await done; return values;
}

async function saveContact(scope: string, contact: LoungeContact) {
  const db = await openDatabase();
  const tx = db.transaction(CONTACTS, 'readwrite'); const done = complete(tx);
  const store = tx.objectStore(CONTACTS);
  const previous = store.get([scope, contact.user.id]);
  previous.onsuccess = () => {
    const saved = parseContact(previous.result);
    const [value] = mergeContact(saved ? [saved] : [], contact);
    store.put({ scope, id: value.user.id, ...parseContact(value) });
  };
  await done;
}

/** Upgrade old contacts from lightweight timeline metadata without loading image payloads. */
function restoreContactTimes({ tx, scope, values }: {
  tx: IDBTransaction; scope: string; values: LoungeContact[];
}) {
  const missing = new Map(values.filter(value => value.direct && value.lastMessageAt === undefined)
    .map(value => [value.user.id, value]));
  if (!missing.size) return;
  const cursor = tx.objectStore(META).index('timeline').openCursor(
    IDBKeyRange.bound([scope, -Number.MAX_SAFE_INTEGER, ''], [scope, Number.MAX_SAFE_INTEGER, []]), 'prev');
  const save = (contact: LoungeContact, time: number) => {
    contact.lastMessageAt = time;
    tx.objectStore(CONTACTS).put({ scope, id: contact.user.id, ...contact });
    missing.delete(contact.user.id);
  };
  cursor.onsuccess = () => {
    const row = cursor.result;
    if (!row) { for (const contact of missing.values()) save(contact, 0); return; }
    const metadata = row.value as Metadata;
    const contact = missing.get(metadata.conversation ?? '');
    if (contact) save(contact, metadata.time);
    if (missing.size) row.continue();
  };
}
