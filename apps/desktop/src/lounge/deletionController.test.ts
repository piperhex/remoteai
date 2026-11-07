// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { LoungeController } from '../../../../shared/lounge/controller';
import type { LoungeHistoryStore } from '../../../../shared/lounge/archive';

const alice = { id: 'alice', account: 'alice' };
const bob = { id: 'bob', account: 'bob' };
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  onopen = null; onclose = null; onerror = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 1; bufferedAmount = 0;
  send = vi.fn(); close() {}
  constructor() { Socket.instances.push(this); }
  frame(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const controllers: LoungeController[] = [];
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const message = (id: string, time: number) => ({ type: 'message', id, sender: bob, recipient: alice,
  text: id, images: [], receipts: true, sentAt: new Date(time).toISOString() });
async function start(history?: LoungeHistoryStore) {
  vi.stubGlobal('WebSocket', Socket);
  const controller = new LoungeController({ baseUrl: 'https://chat.test', account: alice.account, history,
    authorize: async () => ({ ticket: 'fixture' }) });
  controllers.push(controller); controller.start(); await settle();
  const socket = Socket.instances.at(-1)!;
  socket.frame({ type: 'ready', user: alice, direct: true, receipts: true });
  return { controller, socket };
}
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.stop());
  Socket.instances = []; vi.unstubAllGlobals();
});

it('deletes locally without resetting either participant permissions and rejects old deliveries and quotes', async () => {
  const { controller, socket } = await start();
  socket.frame({ type: 'direct-permissions', states: { bob: 'open' } });
  const before = Date.now() - 1000;
  socket.frame(message('old', before)); await settle(); controller.selectConversation(bob);
  await controller.deleteContact('bob');
  expect(controller.snapshot().contacts).toHaveLength(0);
  expect(controller.snapshot().unread).toBe(0);
  expect(controller.snapshot().deletedConversations?.bob).toBeGreaterThan(before);
  expect(socket.send.mock.calls.map(([frame]) => JSON.parse(frame).type)).not.toContain('delete-direct');
  socket.frame(message('late-old', before)); await settle();
  expect(controller.snapshot().contacts).toHaveLength(0);
  expect(await controller.lookupMessage({ id: 'old', senderId: 'bob' }, 'bob')).toBeUndefined();
  controller.selectConversation(bob); await settle();
  expect(controller.snapshot().messages).toEqual([]);
  const freshTime = controller.snapshot().deletedConversations!.bob + 1;
  socket.frame(message('new', freshTime)); await settle();
  expect(controller.snapshot().messages.map(row => row.id)).toEqual(['new']);
  expect((await controller.searchHistory({ query: '' })).messages.map(row => row.id)).toEqual(['new']);
});

it('preserves visible history when writing the local deletion marker fails', async () => {
  const history: LoungeHistoryStore = { save: async () => {}, page: async () => ({ messages: [] }),
    deleteBefore: async () => { throw new Error('storage unavailable'); } };
  const { controller, socket } = await start(history);
  socket.frame(message('keep', Date.now() - 1000)); await settle(); controller.selectConversation(bob);
  await expect(controller.deleteContact('bob')).rejects.toThrow('storage unavailable');
  expect(controller.snapshot().contacts).toHaveLength(1);
  expect(controller.snapshot().messages.map(row => row.id)).toEqual(['keep']);
  expect(controller.snapshot().deletedConversations).toEqual({});
});

it('loads tombstones before restoring private contacts and suppresses cloud contact resurrection', async () => {
  const history: LoungeHistoryStore = { save: async () => {}, page: async () => ({ messages: [] }),
    deletions: async () => ({ bob: 1000 }), contacts: async () => [], deleteBefore: async () => {} };
  const { controller, socket } = await start(history);
  socket.frame({ type: 'ready', user: alice, direct: true, receipts: true, savedContacts: true });
  const request = socket.send.mock.calls.map(([value]) => JSON.parse(value)).find(frame => frame.type === 'sync-contacts');
  socket.frame({ type: 'saved-contacts', id: request.id, users: [bob] });
  socket.frame(message('offline-old', 999)); await settle();
  expect(controller.snapshot().contacts).toEqual([]);
  socket.frame(message('after-cutoff', 1001)); await settle();
  expect(controller.snapshot().contacts.map(row => row.user.id)).toEqual(['bob']);
});

it('retries failed tombstone loading before connecting and keeps new local sends after the cutoff', async () => {
  const cutoff = Date.now() + 1000;
  const deletions = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue({ bob: cutoff });
  vi.stubGlobal('WebSocket', Socket);
  const controller = new LoungeController({ baseUrl: 'https://chat.test', account: alice.account,
    history: { save: async () => {}, page: async () => ({ messages: [] }), deletions },
    authorize: async () => ({ ticket: 'fixture' }) });
  controllers.push(controller); controller.start(); await settle();
  expect(controller.snapshot().historyError).toBe(true);
  expect(Socket.instances).toHaveLength(0);
  await controller.retryHistory(); await settle();
  const socket = Socket.instances.at(-1)!;
  socket.frame({ type: 'ready', user: alice, direct: true, receipts: true });
  socket.frame({ type: 'direct-permissions', states: { bob: 'open' } });
  controller.selectConversation(bob);
  await controller.send({ text: 'fresh local send', images: [], to: bob.id });
  expect(controller.snapshot().messages[0].text).toBe('fresh local send');
  expect(Date.parse(controller.snapshot().messages[0].sentAt)).toBeGreaterThan(cutoff);
});

it('deletes already received messages even when their timestamp is ahead of this device clock', async () => {
  const { controller, socket } = await start();
  const ahead = Date.now() + 1000;
  socket.frame(message('clock-ahead', ahead)); await settle();
  controller.selectConversation(bob);
  await controller.deleteContact(bob.id);
  expect(controller.snapshot().deletedConversations?.bob).toBeGreaterThanOrEqual(ahead);
  expect(controller.snapshot().contacts).toHaveLength(0);
  expect(controller.snapshot().messages).toHaveLength(0);
});
