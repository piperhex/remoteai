import { expect, it, vi } from 'vitest';
import { historyKey, historyPage, type LoungeHistoryStore } from '../../../../shared/lounge/archive';
import { LoungeDeletions } from '../../../../shared/lounge/deletions';
import { SyncArchive } from '../../../../shared/lounge/syncArchive';
import { HistoryExchange } from '../../../../shared/lounge/syncExchange';
import type { LoungeMessage } from '../../../../shared/lounge/types';
import type { RpcMessage } from '../../../../shared/remote-chat/protocol';

const owner = { id: 'alice', account: 'alice' };
const message = (id: string, peer = 'bob', time = 1000): LoungeMessage => ({ type: 'message', id, text: id,
  images: [], sender: { id: peer || 'room-member', account: peer || 'room-member' }, recipient: peer ? owner : undefined,
  conversation: peer || undefined, sentAt: new Date(time).toISOString() });
const access = { generations: async (peers: string[]) => Object.fromEntries(peers.map(peer => [peer, 0])) };

function device(initial: LoungeMessage[] = []) {
  const rows = new Map(initial.map(row => [historyKey(row), row]));
  const times: Record<string, number> = {};
  const store: LoungeHistoryStore = {
    get: async key => rows.get(key),
    save: async row => { if (Date.parse(row.sentAt) > (times[row.conversation ?? ''] ?? 0)) rows.set(historyKey(row), row); },
    page: async query => historyPage([...rows.values()].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
      .filter(row => !query.before || Date.parse(row.sentAt) < query.before.time), query),
    deleteBefore: async (peer, time) => {
      times[peer] = Math.max(time, times[peer] ?? 0);
      for (const [key, row] of rows) {
        if (row.conversation === peer && Date.parse(row.sentAt) <= times[peer]) rows.delete(key);
      }
    },
  };
  const deletions = new LoungeDeletions(store);
  const apply = async (entries: Record<string, number>) => {
    for (const [peer, time] of Object.entries(entries)) {
      if (time <= deletions.time(peer)) continue;
      await store.deleteBefore!(peer, time); deletions.remember(peer, time);
    }
  };
  const archive = new SyncArchive({ owner: owner.id, store, flush: async () => {}, current: () => true,
    restored: () => {}, accept: row => deletions.accepts(row), deletions: { page: after => deletions.page(after), apply } });
  return { rows, archive, deletions, apply, store };
}

function link(first: ReturnType<typeof device>, second: ReturnType<typeof device>) {
  const failed = vi.fn();
  let left: HistoryExchange; let right: HistoryExchange;
  const send = (peer: () => HistoryExchange) => async (frame: RpcMessage) => { peer().receive(structuredClone(frame)); };
  left = new HistoryExchange({ archive: first.archive, access, send: send(() => right), failed });
  right = new HistoryExchange({ archive: second.archive, access, send: send(() => left), failed });
  left.start(); right.start();
  return { left, right, failed, close: () => { left.close(); right.close(); } };
}

it('syncs deletion to another device before importing records and preserves new messages and other chats', async () => {
  const old = message('old'); const group = message('group', ''); const other = message('other', 'carol');
  const source = device([old, group, other]); const target = device([old]);
  await source.apply({ bob: 2000 });
  const connection = link(source, target);
  try {
    await vi.waitFor(() => expect(target.deletions.time('bob')).toBe(2000));
    await vi.waitFor(() => expect(target.rows.size).toBe(2));
    expect(target.rows.has(historyKey(old))).toBe(false);
    expect(source.rows.has(historyKey(old))).toBe(false);
    const fresh = message('fresh', 'bob', 2001);
    await source.store.save(fresh); connection.left.changedHere(historyKey(fresh));
    await vi.waitFor(() => expect(target.rows.has(historyKey(fresh))).toBe(true));
    expect(connection.failed).not.toHaveBeenCalled();
  } finally { connection.close(); }
});

it('propagates live deletions and catches up an offline device using the newest tombstone', async () => {
  const source = device([message('old')]); const target = device([message('old')]);
  const offline = device([message('old')]);
  let connection = link(source, target);
  try {
    await source.apply({ bob: 2000 }); connection.left.changedHere();
    await vi.waitFor(() => expect(target.rows.size).toBe(0));
    await target.apply({ bob: 3000 }); connection.right.changedHere();
    await vi.waitFor(() => expect(source.deletions.time('bob')).toBe(3000));
  } finally { connection.close(); }
  connection = link(target, offline);
  try {
    await vi.waitFor(() => expect(offline.deletions.time('bob')).toBe(3000));
    await vi.waitFor(() => expect(offline.rows.size).toBe(0));
    expect(connection.failed).not.toHaveBeenCalled();
  } finally { connection.close(); }
});

it('syncs more than one page of tombstones even when no messages remain', async () => {
  const source = device(); const target = device();
  await source.apply(Object.fromEntries(Array.from({ length: 61 }, (_, index) => [`peer-${index}`, 1000])));
  const connection = link(source, target);
  try {
    await vi.waitFor(() => expect(Object.keys(target.deletions.snapshot())).toHaveLength(61));
    expect(connection.failed).not.toHaveBeenCalled();
  } finally { connection.close(); }
});
