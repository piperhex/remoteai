import { expect, it } from 'vitest';
import { SyncArchive, syncEntry } from '../../../../shared/lounge/syncArchive';
import { historyKey } from '../../../../shared/lounge/archive';
import type { LoungeMessage } from '../../../../shared/lounge/types';

const bob = { id: 'bob', account: 'bob', nickname: '小波' };
const carol = { id: 'carol', account: 'carol' };
const sent: LoungeMessage = { type: 'message', id: 'group', sender: { id: 'admin', account: 'admin', moderator: true },
  text: 'announcement', images: [], sentAt: '2026-11-06T00:00:00Z', groupReceipt: 'signed-capability',
  delivery: { direction: 'outgoing', status: 'read', readers: [bob] } };

it('unions different readers from two administrator devices even when their read counts are equal', async () => {
  let saved = sent;
  const restored: LoungeMessage[] = [];
  const archive = new SyncArchive({ owner: 'admin', current: () => true, accept: () => true,
    flush: async () => {}, restored: messages => restored.push(...messages),
    store: { save: async message => { saved = message; }, get: async () => saved,
      page: async () => ({ messages: [saved] }) } });
  const incoming: LoungeMessage = { ...sent, delivery: { ...sent.delivery!, readers: [carol] } };
  const access = { generations: async () => ({}) };
  expect(await archive.missing([syncEntry(incoming)], access)).toEqual([historyKey(sent)]);
  await archive.import(historyKey(sent), incoming, access);
  expect(saved.delivery?.readers).toEqual([bob, carol]);
  expect(restored.at(-1)?.delivery?.readers).toHaveLength(2);
});

it('keeps an unconfirmed actual read retryable when another device imports its local history', async () => {
  const incoming: LoungeMessage = { ...sent,
    delivery: { direction: 'incoming', status: 'read', confirmed: 'delivered' } };
  let saved: LoungeMessage | undefined;
  const archive = new SyncArchive({ owner: 'viewer', current: () => true, accept: () => true,
    flush: async () => {}, restored: () => {},
    store: { save: async message => { saved = message; }, get: async () => saved,
      page: async () => ({ messages: [] }) } });
  await archive.import(historyKey(incoming), incoming, { generations: async () => ({}) });
  expect(saved?.delivery?.direction).toBe('incoming');
  expect(saved?.delivery?.status).toBe('read');
  expect(saved?.delivery?.confirmed).toBe('delivered');
  expect(saved?.delivery?.readers).toBeUndefined();
});
