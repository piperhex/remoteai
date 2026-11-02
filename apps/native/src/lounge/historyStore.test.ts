import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import initSqlJs, { type Database, type BindParams } from 'sql.js';
import { nativeLoungeHistory } from './historyStore';
import { historyPosition, historyScope, recentMessages } from '../../../../shared/lounge/archive';
import { orderedDirectContacts } from '../../../../shared/lounge/contacts';
import type { LoungeMessage } from '../../../../shared/lounge/types';

const state = vi.hoisted(() => ({ db: null as Database | null }));
vi.mock('expo-sqlite', () => {
  const all = (sql: string, args: unknown[]) => {
    const statement = state.db!.prepare(sql);
    try {
      statement.bind(args as BindParams);
      const result = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally { statement.free(); }
  };
  return { openDatabaseAsync: async () => ({
    execAsync: async (sql: string) => { state.db!.exec(sql); },
    runAsync: async (sql: string, ...args: unknown[]) => { all(sql, args); },
    getAllAsync: async (sql: string, ...args: unknown[]) => all(sql, args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => all(sql, args)[0] ?? null,
  }) };
});
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => { SQL = await initSqlJs(); state.db = new SQL.Database(); });
afterAll(() => state.db?.close());
const store = () => nativeLoungeHistory('https://cloud.test/', 'Alice@example.test');
const message = (id: string): LoungeMessage => ({ type: 'message', id, text: `hello ${id}`, images: [],
  sender: { id: 'bob', account: 'Bob@example.test' }, sentAt: '2026-10-28T00:00:00Z' });

it('pages toward newer records with exclusive cursors, account isolation and search filters', async () => {
  const history = nativeLoungeHistory('https://cloud.test', 'timeline');
  for (let index = 0; index < 90; index++) {
    const value = { ...message(String(index).padStart(3, '0')), conversation: 'bob' };
    await history.save(value);
  }
  await history.save({ ...message('other-room'), conversation: 'carol' });
  const page = await history.page({ query: 'hello', conversation: 'bob', after: historyPosition(message('030')), limit: 20 });
  expect(page.messages.map(value => Number(value.id))).toEqual(Array.from({ length: 20 }, (_, index) => 50 - index));
  expect(page.next?.key).toBe(historyPosition(message('050')).key);
  const next = await history.page({ query: 'hello', conversation: 'bob', after: page.next, limit: 20 });
  expect(next.messages.map(value => Number(value.id))).toEqual(Array.from({ length: 20 }, (_, index) => 70 - index));
  expect((await nativeLoungeHistory('https://cloud.test', 'other-timeline')
    .page({ query: '', after: historyPosition(message('030')) })).messages).toEqual([]);
});

it('upgrades legacy contact ordering from archived messages and retains pins across restart per account', async () => {
  const account = 'legacy-order';
  const history = nativeLoungeHistory('https://cloud.test', account);
  await history.contacts!();
  const scope = historyScope('https://cloud.test', account);
  const bob = message('bob-order').sender;
  const carol = { id: 'carol', account: 'Carol@example.test' };
  for (const user of [bob, carol]) state.db!.run('INSERT INTO contacts(scope, id, content) VALUES (?, ?, ?)',
    [scope, user.id, JSON.stringify({ user, direct: true })]);
  await history.save({ ...message('bob-order'), conversation: 'bob', recipient: carol });
  await history.save({ ...message('carol-order'), sender: carol, conversation: 'carol', recipient: bob,
    sentAt: '2026-10-29T00:00:00Z' });
  let contacts = await history.contacts!();
  expect(orderedDirectContacts(contacts).map(value => value.user.id)).toEqual(['carol', 'bob']);
  expect(contacts.find(value => value.user.id === 'bob')?.lastMessageAt).toBe(Date.parse('2026-10-28T00:00:00Z'));
  await history.saveContact!({ user: bob, direct: true, pinned: true, online: true });
  const data = state.db!.export(); state.db!.close(); state.db = new SQL.Database(data);
  contacts = await history.contacts!();
  expect(orderedDirectContacts(contacts).map(value => value.user.id)).toEqual(['bob', 'carol']);
  expect(contacts.find(value => value.user.id === 'bob')).not.toHaveProperty('online');
  expect(await nativeLoungeHistory('https://other.test', account).contacts!()).toEqual([]);
  expect(await nativeLoungeHistory('https://cloud.test', 'another-account').contacts!()).toEqual([]);
  await history.saveContact!({ user: bob, direct: true, pinned: false, lastMessageAt: 1 });
  contacts = await history.contacts!();
  expect(orderedDirectContacts(contacts).map(value => value.user.id)).toEqual(['carol', 'bob']);
  await history.deleteConversation!('bob');
  expect((await history.contacts!()).map(value => value.user.id)).toEqual(['carol']);
});

it('deletes only old private history in the current account and preserves a fresh concurrent message', async () => {
  const history = nativeLoungeHistory('https://cloud.test', 'delete');
  const other = nativeLoungeHistory('https://cloud.test', 'other-delete');
  const old = { ...message('old'), conversation: 'bob', recipient: { id: 'alice', account: 'Alice' } };
  await history.save(old); await other.save(old); await history.save(message('group-delete'));
  await history.saveContact!({ user: old.sender, direct: true });
  await history.deleteConversation!('bob', 1);
  const data = state.db!.export(); state.db!.close(); state.db = new SQL.Database(data);
  expect((await history.page({ query: '', conversation: 'bob' })).messages).toEqual([]);
  expect(await history.contacts!()).toEqual([]);
  expect((await other.page({ query: '' })).messages).toEqual([old]);
  expect((await history.page({ query: '' })).messages.map(value => value.id)).toEqual(['group-delete']);
  await history.save(old); await history.save({ ...old, id: 'fresh', generation: 1 });
  await history.saveContact!({ user: old.sender, direct: true });
  await history.deleteConversation!('bob', 1);
  expect((await history.page({ query: '', conversation: 'bob' })).messages.map(value => value.id)).toEqual(['fresh']);
  expect(await history.contacts!()).toHaveLength(1);
});

it('persists receipt state and selects unfinished local jobs without resending completed messages', async () => {
  const history = nativeLoungeHistory('https://cloud.test', 'receipts');
  const outgoing: LoungeMessage = { ...message('pending'), recipient: { id: 'other', account: 'other' }, receipts: true,
    delivery: { direction: 'outgoing', status: 'pending', retry: true, attemptedAt: Date.now() } };
  await history.save(outgoing);
  const data = state.db!.export(); state.db!.close(); state.db = new SQL.Database(data);
  expect((await history.page({ query: '', pendingOnly: true })).messages).toHaveLength(1);
  expect((await history.get!('["bob","pending"]'))?.delivery?.status).toBe('pending');
  await history.save({ ...outgoing, delivery: { ...outgoing.delivery!, status: 'read' } });
  await history.save(outgoing);
  expect((await history.get!('["bob","pending"]'))?.delivery?.status).toBe('read');
  expect((await history.page({ query: '', pendingOnly: true })).messages).toHaveLength(0);
  const received: LoungeMessage = { ...outgoing, id: 'incoming',
    delivery: { direction: 'incoming', status: 'read', confirmed: 'delivered' } };
  await history.save(received);
  expect((await history.page({ query: '', pendingOnly: true })).messages.map(value => value.id)).toEqual(['incoming']);
  await history.save({ ...received, delivery: { ...received.delivery!, confirmed: 'read' } });
  expect((await history.page({ query: '', pendingOnly: true })).messages).toHaveLength(0);
});

it('keeps group and private searches separate and persists contacts without their online status', async () => {
  const history = nativeLoungeHistory('https://cloud.test', 'direct');
  const privateMessage = { ...message('secret'), conversation: 'bob', recipient: { id: 'alice', account: 'Alice' } };
  await history.save(message('group')); await history.save(privateMessage);
  await history.saveContact!({ user: privateMessage.sender, direct: true, online: true });
  const data = state.db!.export(); state.db!.close(); state.db = new SQL.Database(data);
  expect((await history.page({ query: '', conversation: '' })).messages.map(value => value.id)).toEqual(['group']);
  expect((await history.page({ query: '', conversation: 'bob' })).messages).toEqual([privateMessage]);
  expect(await history.contacts!()).toEqual([{ user: privateMessage.sender, direct: true, lastMessageAt: 0 }]);
});

it('preserves messages, images and avatars after reopening, without duplicating or sharing between accounts', async () => {
  const received = { ...message('picture'), images: ['data:image/png;base64,AAAA'],
    reply: { id: 'old', senderId: 'other', account: 'other@example.test', text: 'quoted-only', imageCount: 1 },
    sender: { id: 'bob', account: 'Bob@example.test', avatar: 'data:image/png;base64,AAAA' } };
  await store().save(received); await store().save(received);
  const data = state.db!.export(); state.db!.close(); state.db = new SQL.Database(data);
  const restored = await nativeLoungeHistory('https://cloud.test', 'alice@example.test').page({ query: '' });
  expect(restored.messages).toEqual([received]);
  expect((await store().page({ query: 'quoted-only' })).messages).toEqual([received]);
  expect(await nativeLoungeHistory('https://other.test', 'alice@example.test').page({ query: '' }))
    .toEqual({ messages: [] });
  expect(await nativeLoungeHistory('https://cloud.test', 'other@example.test').page({ query: '' }))
    .toEqual({ messages: [] });
});

it('searches older than the timeline limit with normalized terms and literal SQL wildcards', async () => {
  const archive = nativeLoungeHistory('https://cloud.test', 'search');
  const oldest = { ...message('old'), text: '唯一 100%_\\ old coffee', sentAt: '2026-01-01T00:00:00Z' };
  await archive.save(oldest);
  for (let index = 0; index < 210; index++) await archive.save(message(`new-${index}`));
  expect(recentMessages((await archive.page({ query: '', limit: 200 })).messages)).toHaveLength(200);
  expect((await archive.page({ query: 'ＢＯＢ 唯一 100%_\\' })).messages).toEqual([oldest]);
  expect((await archive.page({ query: '%missing' })).messages).toEqual([]);
  let page = await archive.page({ query: '' });
  const ids = page.messages.map(value => value.id);
  while (page.next) {
    page = await archive.page({ query: '', before: page.next }); ids.push(...page.messages.map(value => value.id));
  }
  expect(ids).toHaveLength(211); expect(new Set(ids).size).toBe(211); expect(ids.at(-1)).toBe('old');
});

it('limits image-heavy page memory while retaining all records for subsequent pages', async () => {
  const archive = nativeLoungeHistory('https://cloud.test', 'images');
  const image = `data:image/png;base64,${'A'.repeat(1024 * 1024)}`;
  for (let index = 0; index < 6; index++) {
    await archive.save({ ...message(`large-${index}`), images: [image, image, image] });
  }
  const first = await archive.page({ query: '' });
  expect(first.messages.length).toBeLessThan(6); expect(first.next).toBeDefined();
  const second = await archive.page({ query: '', before: first.next });
  expect(first.messages.length + second.messages.length).toBe(6);
  expect(second.next).toBeUndefined();
});
