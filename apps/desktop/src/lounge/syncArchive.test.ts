import { expect, it, vi } from 'vitest';
import { historyKey, historyPage, type LoungeHistoryStore } from '../../../../shared/lounge/archive';
import { mergeDelivery, needsDeliveryWork } from '../../../../shared/lounge/delivery';
import { SyncArchive, parseManifest, syncEntry, syncMessage } from '../../../../shared/lounge/syncArchive';
import { HistoryExchange } from '../../../../shared/lounge/syncExchange';
import { synchronizedSnapshot } from '../../../../shared/lounge/syncSnapshot';
import type { LoungeMessage, LoungeSnapshot } from '../../../../shared/lounge/types';
import type { RpcMessage } from '../../../../shared/remote-chat/protocol';

const owner = 'alice';
const access = { generations: async (peers: string[]) => Object.fromEntries(peers.map(peer => [peer, 0])) };
const message = (id: string, privateChat = false): LoungeMessage => ({ type: 'message', id, text: `Message ${id}`,
  images: [], sender: { id: 'bob', account: 'bob@example.test' }, sentAt: new Date(1000 + Number(id)).toISOString(),
  ...(privateChat ? { recipient: { id: owner, account: 'alice@example.test' }, conversation: 'bob', generation: 0,
    delivery: { direction: 'incoming', status: 'delivered', confirmed: 'delivered' } } : {}) });

function archive(initial: LoungeMessage[] = []) {
  const rows = new Map(initial.map(value => [historyKey(value), value]));
  const store: LoungeHistoryStore = {
    get: async key => rows.get(key),
    save: vi.fn(async value => {
      const old = rows.get(historyKey(value));
      rows.set(historyKey(value), { ...value, delivery: mergeDelivery(old?.delivery, value.delivery) });
    }),
    page: async query => {
      const sorted = [...rows.values()].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)
        || historyKey(b).localeCompare(historyKey(a)));
      return historyPage(sorted.filter(value => !query.before || Date.parse(value.sentAt) < query.before.time
        || Date.parse(value.sentAt) === query.before.time && historyKey(value) < query.before.key), query);
    },
    deleteConversation: async (peer, generation = Infinity) => {
      for (const [key, row] of rows) if (row.conversation === peer && (row.generation ?? 0) < generation) rows.delete(key);
    },
  };
  const restored = vi.fn();
  const options = { owner, store, restored, current: () => true, flush: async () => {}, accept: () => true };
  return { rows, store, restored, options, archive: new SyncArchive(options) };
}

it('normalizes conversation ownership and never takes over another device’s retry jobs', () => {
  const incoming = message('1', true);
  expect(syncMessage({ ...incoming, conversation: 'untrusted' }, owner)?.conversation).toBe('bob');
  expect(syncMessage(incoming, 'mallory')).toBeUndefined();
  expect(syncMessage({ ...incoming, id: '' }, owner)).toBeUndefined();
  expect(needsDeliveryWork(syncMessage(incoming, owner)?.delivery)).toBe(false);
  const outgoing = { ...incoming, sender: incoming.recipient!, recipient: incoming.sender,
    delivery: { direction: 'outgoing', status: 'pending', retry: true } };
  expect(needsDeliveryWork(syncMessage(outgoing, owner)?.delivery)).toBe(false);
  expect(() => parseManifest({ entries: [{ ...syncEntry(incoming), generation: -1 }] })).toThrow();
});

it('imports images and replies once, preserves local retry ownership and advances receipts without downgrading', async () => {
  const received = { ...message('1', true), images: ['data:image/png;base64,YWJj'],
    reply: { id: 'quote', senderId: 'bob', account: 'bob@example.test', text: 'quoted', imageCount: 1 } };
  const target = archive(); const key = historyKey(received);
  await target.archive.import(key, received, access);
  await target.archive.import(key, received, access);
  expect(target.store.save).toHaveBeenCalledTimes(1);
  expect(target.rows.get(key)).toMatchObject({ images: received.images, reply: received.reply });
  await target.archive.import(key, { ...received, delivery: { direction: 'incoming', status: 'read' } }, access);
  await target.archive.import(key, received, access);
  expect(target.rows.get(key)?.delivery?.status).toBe('read');
  expect(needsDeliveryWork(target.rows.get(key)?.delivery)).toBe(false);

  const sent: LoungeMessage = { ...received, sender: received.recipient!, recipient: received.sender,
    delivery: { direction: 'outgoing', status: 'pending', retry: true } };
  const source = archive([sent]);
  await source.archive.import(historyKey(sent), { ...sent, delivery: { ...sent.delivery, status: 'read' } }, access);
  expect(source.rows.get(historyKey(sent))?.delivery).toMatchObject({ status: 'read', retry: true });
});

it('filters deleted generations and refuses stale imports during a local deletion or account disposal', async () => {
  const incoming = message('2', true); const key = historyKey(incoming); const target = archive();
  const deleted = { generations: async () => ({ bob: 1 }) };
  expect(await target.archive.missing([syncEntry(incoming)], deleted)).toEqual([]);
  await target.archive.import(key, incoming, deleted);
  expect(target.rows.size).toBe(0);
  target.options.current = () => false;
  await target.archive.import(key, incoming, access);
  expect(target.rows.size).toBe(0);
  target.options.current = () => true;
  let allowed = true;
  target.options.accept = () => allowed;
  const save = target.store.save;
  target.store.save = async value => { await save(value); allowed = false; };
  await target.archive.import(key, incoming, access);
  expect(target.rows.size).toBe(0); expect(target.restored).not.toHaveBeenCalled();
});

it('merges read status without historical unread notifications or replacing local message bodies', () => {
  const incoming = message('1', true);
  const state: LoungeSnapshot = { messages: [incoming], conversation: 'bob', unread: 1,
    unreadByConversation: { bob: 1 }, historyRevision: 0, status: 'connected',
    policy: { moderator: false, mutedUntil: null }, historyError: false, contacts: [], blocked: [], directAvailable: true };
  const read: LoungeMessage = { ...incoming, text: 'changed remote text',
    delivery: { direction: 'incoming', status: 'read' } };
  const result = synchronizedSnapshot(state, [read, message('2', true)], [incoming]);
  expect(result.change.unread).toBe(0);
  expect(result.change.messages).toHaveLength(2);
  expect(result.change.messages[0].text).toBe(incoming.text);
  expect(result.change.messages[0].delivery?.status).toBe('read');
});

it('pulls multiple pages, accepts next requests before send completion and catches up live changes', async () => {
  const source = archive(Array.from({ length: 60 }, (_, index) => message(String(index))));
  const target = archive(); const failed = vi.fn();
  let left: HistoryExchange; let right: HistoryExchange;
  const transfer = (peer: () => HistoryExchange) => async (frame: RpcMessage) => {
    peer().receive(structuredClone(frame));
    // Acknowledgements may settle after the remote issues its next request.
    await new Promise(resolve => setTimeout(resolve, 1));
  };
  left = new HistoryExchange({ archive: source.archive, access, send: transfer(() => right), failed });
  right = new HistoryExchange({ archive: target.archive, access, send: transfer(() => left), failed });
  try {
    left.start(); right.start();
    await vi.waitFor(() => expect(target.rows.size).toBe(60), { timeout: 5_000 });
    const live = message('100'); await source.store.save(live); left.changedHere(historyKey(live));
    await vi.waitFor(() => expect(target.rows.size).toBe(61), { timeout: 5_000 });
    expect(failed).not.toHaveBeenCalled();
    expect(target.store.save).toHaveBeenCalledTimes(61);
  } finally { left.close(); right.close(); }
}, 15_000);
