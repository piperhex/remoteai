// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoungeController } from '../../../../shared/lounge/controller';
import { notificationSettingsUpdate, notificationUnread } from '../../../../shared/lounge/notificationSettings';

class Socket {
  static instances: Socket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn();
  constructor() { Socket.instances.push(this); }
  frame(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  ready(muted: string[] = []) { this.frame({ type: 'ready', user: { id: 'alice', account: 'alice@test' },
    direct: true, receipts: true, notificationSettings: true, mutedConversations: muted }); }
  message(id: string, direct = false) { this.frame({ type: 'message', id, text: id, images: [],
    sender: { id: 'bob', account: 'bob@test' }, sentAt: new Date().toISOString(),
    ...(direct ? { recipient: { id: 'alice', account: 'alice@test' } } : {}) }); }
}
let controller: LoungeController;
beforeEach(async () => {
  vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal('WebSocket', Socket);
  controller = new LoungeController({ baseUrl: 'https://test', trackUnreadDirectMessages: true,
    authorize: async () => ({ ticket: 'test' }) });
  controller.start();
  for (let index = 0; index < 8; index++) await Promise.resolve();
});
afterEach(() => { controller.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps raw list counts while filtering every entry total, and restores badges when unmuted', async () => {
  const socket = Socket.instances[0]; socket.ready();
  for (let index = 0; index < 105; index++) socket.message(`group-${index}`);
  socket.message('private', true);
  expect(controller.snapshot().unread).toBe(106);
  const save = controller.setNotificationsMuted('', true);
  const request = JSON.parse(socket.send.mock.calls.at(-1)![0]);
  expect(request).toMatchObject({ type: 'notification-setting', conversation: '', muted: true });
  expect(controller.snapshot().unread).toBe(106);
  socket.frame({ type: 'notification-settings', conversation: '', muted: true });
  socket.frame({ type: 'updated', id: request.id }); await save;
  expect(controller.snapshot().unread).toBe(1);
  expect(controller.snapshot().unreadByConversation).toEqual({ '': 105, bob: 1 });
  socket.frame({ type: 'notification-settings', conversation: 'bob', muted: true });
  socket.message('new-private', true);
  expect(controller.snapshot().unread).toBe(0);
  expect(controller.snapshot().unreadByConversation.bob).toBe(2);
  socket.frame({ type: 'notification-settings', conversation: '', muted: false });
  expect(controller.snapshot().unread).toBe(105);
});

it('loads authoritative preferences on reconnect and clears them with the account lifecycle', () => {
  const socket = Socket.instances[0]; socket.ready(['bob']); socket.message('private', true);
  expect(controller.snapshot().unread).toBe(0);
  socket.ready([]); expect(controller.snapshot().unread).toBe(1);
  socket.ready(['bob']); controller.stop();
  expect(controller.snapshot().mutedConversations).toEqual([]);
});

it('preserves counts on failed writes and rejects unavailable settings without sending', async () => {
  const socket = Socket.instances[0]; socket.ready(); socket.message('unread');
  const save = controller.setNotificationsMuted('', true);
  const assertion = expect(save).rejects.toThrow('client.lounge.notificationSaveFailed');
  const request = JSON.parse(socket.send.mock.calls.at(-1)![0]);
  socket.frame({ type: 'rejected', id: request.id, code: 'internal failure' }); await assertion;
  expect(controller.snapshot().unread).toBe(1);
  expect(controller.snapshot().mutedConversations).toEqual([]);
  socket.frame({ type: 'ready', user: { id: 'alice', account: 'alice@test' } });
  const previous = socket.send.mock.calls.length;
  await expect(controller.setNotificationsMuted('', true)).rejects.toThrow();
  expect(socket.send.mock.calls.length).toBe(previous);
});

it('ignores malformed updates and handles identifiers without object prototype collisions', () => {
  const snapshot = controller.snapshot();
  expect(notificationSettingsUpdate(snapshot, { type: 'notification-settings', muted: true })).toBeUndefined();
  expect(notificationUnread({ unreadByConversation: { '': 99, bob: 3 }, mutedConversations: [''] })).toBe(3);
  expect(notificationUnread({ unreadByConversation: { constructor: 2 }, mutedConversations: [] })).toBe(2);
});

it('retains individual live private alerts beyond the transcript limit and honors mute and read changes', () => {
  const socket = Socket.instances[0];
  socket.ready();
  socket.message('group');
  for (let index = 0; index < 205; index++) socket.message(`private-${index}`, true);
  const alerts = () => controller.unreadDirectNotifications().map(entry => entry.reference.id);
  expect(alerts()).toHaveLength(205);
  expect(alerts()[0]).toBe('private-204');
  expect(alerts().at(-1)).toBe('private-0');

  socket.frame({ type: 'notification-settings', conversation: 'bob', muted: true });
  socket.message('muted-private', true);
  expect(alerts()).toEqual([]);
  expect(controller.snapshot().unreadByConversation.bob).toBe(206);

  socket.frame({ type: 'notification-settings', conversation: 'bob', muted: false });
  socket.message('new-private', true);
  expect(alerts()).toEqual(['new-private']);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  controller.selectConversation({ id: 'bob', account: 'bob@test' });
  controller.setViewing(true);
  expect(alerts()).toEqual([]);
  expect(controller.snapshot().unreadByConversation.bob).toBe(0);
});
