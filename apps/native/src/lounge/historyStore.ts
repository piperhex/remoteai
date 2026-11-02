import type { SQLiteDatabase } from 'expo-sqlite';
import { historyKey, historyPage, historyPageLimit, historyScope, historyText, historyTerms,
  messageBytes, RECENT_BYTE_LIMIT, type HistoryQuery, type LoungeHistoryStore,
} from '../../../../shared/lounge/archive';
import { parseMessage, type LoungeMessage } from '../../../../shared/lounge/types';
import { mergeContact, parseContact, type LoungeContact } from '../../../../shared/lounge/contacts';
import { mergeDelivery } from '../../../../shared/lounge/delivery';

let database: Promise<SQLiteDatabase> | undefined;
let pending: Promise<unknown> = Promise.resolve();
const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS messages (
  scope TEXT NOT NULL, key TEXT NOT NULL, time INTEGER NOT NULL,
  search TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS timeline ON messages(scope, time, key);
CREATE TABLE IF NOT EXISTS contacts(scope TEXT NOT NULL, id TEXT NOT NULL, content TEXT NOT NULL,
  PRIMARY KEY(scope, id));`;

async function open() {
  const { openDatabaseAsync } = await import('expo-sqlite');
  const db = await openDatabaseAsync('lounge-history-v1.db');
  try { await db.execAsync(SCHEMA); }
  catch (error) { await db.closeAsync(); throw error; }
  return db;
}

/** Serializes connection initialization and access; failed operations can be retried. */
function withDatabase<T>(operation: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  const result = pending.then(async () => {
    database ??= open().catch((error: unknown) => { database = undefined; throw error; });
    return operation(await database);
  });
  pending = result.catch(() => { /* The caller receives the error; later operations may recover. */ });
  return result;
}

async function search(db: SQLiteDatabase, scope: string, query: HistoryQuery) {
  const terms = historyTerms(query.query);
  const conditions = ['scope = ?', ...terms.map(() => "search LIKE ? ESCAPE '\\'")];
  if (query.pendingOnly) conditions.push(`(
    (json_extract(content, '$.delivery.direction') = 'outgoing'
      AND json_extract(content, '$.delivery.status') = 'pending' AND json_extract(content, '$.delivery.retry') = 1)
    OR (json_extract(content, '$.delivery.direction') = 'incoming'
      AND json_extract(content, '$.delivery.status') != COALESCE(json_extract(content, '$.delivery.confirmed'), '')))`);
  const parameters: (string | number)[] = [scope,
    ...terms.map(term => `%${term.replace(/[\\%_]/g, '\\$&')}%`)];
  if (query.conversation !== undefined) {
    conditions.push("COALESCE(json_extract(content, '$.conversation'), '') = ?");
    parameters.push(query.conversation);
  }
  if (query.before) {
    conditions.push('(time < ? OR (time = ? AND key < ?))');
    parameters.push(query.before.time, query.before.time, query.before.key);
  }
  if (query.after) {
    conditions.push('(time > ? OR (time = ? AND key > ?))');
    parameters.push(query.after.time, query.after.time, query.after.key);
  }
  // Select keys first so image-heavy pages never allocate the full matched payload set.
  const order = query.after ? 'ASC' : 'DESC';
  const rows = await db.getAllAsync<{ key: string }>(
    `SELECT key FROM messages WHERE ${conditions.join(' AND ')} ORDER BY time ${order}, key ${order} LIMIT ?`,
    ...parameters, historyPageLimit(query) + 1);
  const messages: LoungeMessage[] = [];
  let bytes = 0;
  for (const row of rows) {
    const stored = await db.getFirstAsync<{ content: string }>(
      'SELECT content FROM messages WHERE scope = ? AND key = ?', scope, row.key);
    const message = stored && parseMessage(JSON.parse(stored.content));
    if (!message) continue;
    messages.push(message); bytes += messageBytes(message);
    if (bytes > RECENT_BYTE_LIMIT) break;
  }
  return historyPage(messages, query);
}

/** A durable local archive, isolated by server and account, separate from the chat cache. */
export function nativeLoungeHistory(baseUrl: string, account: string): LoungeHistoryStore {
  const scope = historyScope(baseUrl, account);
  return {
    save: message => withDatabase(async db => {
      const previous = message.delivery ? await db.getFirstAsync<{ content: string }>(
        'SELECT content FROM messages WHERE scope = ? AND key = ?', scope, historyKey(message)) : undefined;
      const delivery = mergeDelivery(previous ? parseMessage(JSON.parse(previous.content))?.delivery : undefined,
        message.delivery);
      await db.runAsync('INSERT OR REPLACE INTO messages(scope, key, time, search, content) VALUES (?, ?, ?, ?, ?)',
        scope, historyKey(message), Date.parse(message.sentAt), historyText(message), JSON.stringify({ ...message, delivery }));
    }),
    page: query => withDatabase(db => search(db, scope, query)),
    deleteConversation: (peer, generation = Number.MAX_SAFE_INTEGER) => withDatabase(async db => {
      await db.execAsync('BEGIN IMMEDIATE');
      try {
        await db.runAsync(`DELETE FROM messages WHERE scope = ? AND json_extract(content, '$.conversation') = ?
          AND coalesce(json_extract(content, '$.generation'), 0) < ?`, scope, peer, generation);
        const retained = await db.getFirstAsync<{ key: string }>(
          "SELECT key FROM messages WHERE scope = ? AND json_extract(content, '$.conversation') = ? LIMIT 1", scope, peer);
        if (!retained) await db.runAsync('DELETE FROM contacts WHERE scope = ? AND id = ?', scope, peer);
        await db.execAsync('COMMIT');
      } catch (error) { await db.execAsync('ROLLBACK'); throw error; }
    }),
    get: key => withDatabase(async db => {
      const row = await db.getFirstAsync<{ content: string }>(
        'SELECT content FROM messages WHERE scope = ? AND key = ?', scope, key);
      return row ? parseMessage(JSON.parse(row.content)) : undefined;
    }),
    contacts: () => withDatabase(async db => {
      const rows = await db.getAllAsync<{ content: string }>('SELECT content FROM contacts WHERE scope = ?', scope);
      const contacts = rows.map(row => parseContact(JSON.parse(row.content)))
        .filter((value): value is LoungeContact => !!value);
      await restoreContactTimes(db, scope, contacts);
      return contacts;
    }),
    saveContact: contact => withDatabase(async db => {
      const previous = await db.getFirstAsync<{ content: string }>(
        'SELECT content FROM contacts WHERE scope = ? AND id = ?', scope, contact.user.id);
      const saved = previous && parseContact(JSON.parse(previous.content));
      const [value] = mergeContact(saved ? [saved] : [], contact);
      await db.runAsync('INSERT OR REPLACE INTO contacts(scope, id, content) VALUES (?, ?, ?)',
        scope, value.user.id, JSON.stringify(parseContact(value)));
    }),
  };
}

/** Backfill legacy contacts once; subsequent launches read the saved timestamps directly. */
async function restoreContactTimes(db: SQLiteDatabase, scope: string, contacts: LoungeContact[]) {
  const missing = contacts.filter(contact => contact.direct && contact.lastMessageAt === undefined);
  if (!missing.length) return;
  const rows = await db.getAllAsync<{ peer: string; time: number }>(
    `SELECT json_extract(content, '$.conversation') AS peer, MAX(time) AS time
      FROM messages WHERE scope = ? GROUP BY peer`, scope);
  const times = new Map(rows.map(row => [row.peer, row.time]));
  for (const contact of missing) {
    contact.lastMessageAt = times.get(contact.user.id) ?? 0;
    await db.runAsync('UPDATE contacts SET content = ? WHERE scope = ? AND id = ?',
      JSON.stringify(contact), scope, contact.user.id);
  }
}
