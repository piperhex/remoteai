import { afterEach, expect, it, vi } from 'vitest';
import { LoungeDirectDelivery } from '../../../../shared/lounge/directDelivery';
import { historyKey, type LoungeHistoryStore } from '../../../../shared/lounge/archive';
import { mergeDelivery, needsDeliveryWork } from '../../../../shared/lounge/delivery';
import { INVALID_GROUP_RECEIPT, type GroupReceiptRejection } from '../../../../shared/lounge/groupReceipts';
import { SyncArchive, parseManifest, syncEntry } from '../../../../shared/lounge/syncArchive';
import { parseMessage, type LoungeAccount, type LoungeMessage } from '../../../../shared/lounge/types';

const admin = { id: 'admin', account: 'admin', moderator: true };
const reader = { id: 'reader', account: 'reader' };
const engines: LoungeDirectDelivery[] = [];
const settle = async () => { for (let step = 0; step < 80; step++) await Promise.resolve(); };
const announcement = (id = 'historical'): LoungeMessage => ({ type: 'message', id, sender: admin,
  text: 'hello', images: [], sentAt: new Date().toISOString(), groupReceipt: `signed-${id}`,
  delivery: { direction: 'incoming', status: 'read', confirmed: 'delivered', attemptedAt: Date.now() } });
const rejection = (message: LoungeMessage) => ({ type: 'group-receipt-rejected', code: INVALID_GROUP_RECEIPT,
  receiptType: 'group-read', id: message.id, from: admin.id, to: reader.id,
  groupReceipt: message.groupReceipt! } satisfies GroupReceiptRejection);

function archive(initial: LoungeMessage[] = []) {
  const rows = new Map(initial.map(message => [historyKey(message), message]));
  const store: LoungeHistoryStore = {
    get: async key => rows.get(key),
    save: async message => {
      const delivery = mergeDelivery(rows.get(historyKey(message))?.delivery, message.delivery);
      // Serialize through the same public parser as the durable browser/native archives.
      rows.set(historyKey(message), parseMessage(JSON.parse(JSON.stringify({ ...message, delivery })))!);
    },
    page: async query => ({ messages: [...rows.values()]
      .filter(message => !query.pendingOnly || needsDeliveryWork(message.delivery)) }),
  };
  return { rows, store };
}

function fixture(options: { store: LoungeHistoryStore; self?: LoungeAccount }) {
  const frames: Record<string, unknown>[] = [];
  const state = { connected: true };
  const engine = new LoungeDirectDelivery({ self: () => options.self ?? reader,
    enabled: () => state.connected, groupEnabled: () => true, online: () => false,
    readable: () => true, allowed: () => true, find: key => options.store.get!(key), page: options.store.page,
    publish: message => options.store.save(message), error: () => { throw new Error('archive failed'); },
    transmit: frame => { frames.push(frame); return true; } });
  engines.push(engine); engine.start();
  return { engine, frames, state };
}

afterEach(() => { engines.splice(0).forEach(engine => engine.stop()); vi.useRealTimers(); });

it('durably stops only the rejected capability across reconnect, restart, replay and stale writes', async () => {
  vi.useFakeTimers();
  const stale = announcement(); const valid = announcement('valid');
  const { store, rows } = archive([stale, valid]);
  const first = fixture({ store }); await settle();
  await vi.advanceTimersByTimeAsync(6000);
  expect(first.frames.filter(frame => frame.type === 'group-read')).toHaveLength(2);
  first.engine.receipt(rejection(stale)); await settle();
  const saved = rows.get(historyKey(stale))!;
  expect(saved.delivery).toMatchObject({ status: 'read', confirmed: 'delivered',
    groupReceiptError: INVALID_GROUP_RECEIPT });
  expect(needsDeliveryWork(saved.delivery)).toBe(false);
  expect((await store.page({ query: '', pendingOnly: true })).messages.map(row => row.id)).toEqual(['valid']);
  await store.save(stale); // A late window write cannot resurrect the retry.
  first.state.connected = false; await vi.advanceTimersByTimeAsync(6000);
  first.state.connected = true; await vi.advanceTimersByTimeAsync(6000);
  expect(first.frames.filter(frame => frame.id === stale.id)).toHaveLength(1);
  first.engine.stop();
  const reopened = fixture({ store }); await settle();
  reopened.engine.restoreGroups([stale]); // Even a stale in-memory snapshot rechecks the archive.
  reopened.engine.receive(stale); await settle();
  await vi.advanceTimersByTimeAsync(12000);
  expect(reopened.frames.some(frame => frame.id === stale.id)).toBe(false);
  expect(reopened.frames.filter(frame => frame.id === valid.id).length).toBeGreaterThan(0);
  reopened.engine.receipt({ type: 'group-read-confirm', id: valid.id, from: admin.id, to: reader.id,
    groupReceipt: valid.groupReceipt }); await settle();
  const count = reopened.frames.length;
  await vi.advanceTimersByTimeAsync(12000);
  expect(reopened.frames).toHaveLength(count);
  expect(rows.get(historyKey(valid))?.delivery?.confirmed).toBe('read');
});

it('ignores unknown errors, unrelated message/author/token/direction and private-message rejections', async () => {
  const stale = announcement(); const { store, rows } = archive([stale]);
  const { engine } = fixture({ store }); await settle();
  for (const override of [{ code: 'temporarily-unavailable' }, { to: 'someone' }, { from: 'someone' },
    { id: 'other' }, { groupReceipt: 'other-token' }, { receiptType: 'group-read-confirm' },
    { type: 'rejected' }]) engine.receipt({ ...rejection(stale), ...override });
  await settle();
  expect(rows.get(historyKey(stale))?.delivery?.groupReceiptError).toBeUndefined();
  expect(needsDeliveryWork(rows.get(historyKey(stale))?.delivery)).toBe(true);
  const direct = { ...announcement('private'), recipient: reader, receipts: true };
  await store.save(direct); engine.receipt(rejection(direct)); await settle();
  expect(rows.get(historyKey(direct))?.delivery?.groupReceiptError).toBeUndefined();
});

it('terminates rejected confirmations without fabricating readers or acknowledgements', async () => {
  const sent: LoungeMessage = { ...announcement(), delivery: { direction: 'outgoing', status: 'read',
    readers: [reader] } };
  const { store, rows } = archive([sent]);
  const { engine, frames } = fixture({ store, self: admin }); await settle();
  engine.receipt({ ...rejection(sent), receiptType: 'group-read-confirm', from: reader.id, to: admin.id });
  await settle();
  engine.receipt({ type: 'group-read', id: sent.id, from: reader.id, to: admin.id, reader,
    groupReceipt: sent.groupReceipt }); await settle();
  expect(frames).toEqual([]);
  expect(rows.get(historyKey(sent))?.delivery).toMatchObject({ status: 'read', readers: [reader],
    groupReceiptError: INVALID_GROUP_RECEIPT });
  expect(rows.get(historyKey(sent))?.delivery?.confirmed).toBeUndefined();
});

it('synchronizes a permanent failure even when read status and reader lists did not change', async () => {
  const stale = announcement();
  const failed: LoungeMessage = { ...stale,
    delivery: { ...stale.delivery!, groupReceiptError: INVALID_GROUP_RECEIPT } };
  const target = archive([stale]); const restored = vi.fn();
  const sync = new SyncArchive({ owner: reader.id, store: target.store, flush: async () => {},
    current: () => true, accept: () => true, restored });
  const access = { generations: async () => ({}) };
  const manifest = parseManifest({ entries: [syncEntry(failed)] });
  expect(await sync.missing(manifest.entries, access)).toEqual([historyKey(stale)]);
  await sync.import(historyKey(stale), failed, access);
  expect(restored).toHaveBeenCalledTimes(1);
  expect(needsDeliveryWork(target.rows.get(historyKey(stale))?.delivery)).toBe(false);
  await sync.import(historyKey(stale), stale, access);
  expect(target.rows.get(historyKey(stale))?.delivery?.groupReceiptError).toBe(INVALID_GROUP_RECEIPT);
  expect(await sync.missing(manifest.entries, access)).toEqual([]);
  expect(() => parseManifest({ entries: [{ ...syncEntry(failed), groupReceiptError: 'unknown' }] })).toThrow();
  expect(() => parseManifest({ entries: [null] })).toThrow('invalid-history-entry');
  expect(parseMessage({ ...stale, delivery: { ...stale.delivery, groupReceiptError: 'unknown' } })
    ?.delivery?.groupReceiptError).toBeUndefined();
});
