// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoungeController } from '../../../../shared/lounge/controller';
import { browserAvatarStore } from '../../../../shared/lounge/avatar';
import { loungeAvatarVersion } from '../../../../shared/lounge/avatarCache';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  bufferedAmount = 0;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  constructor(readonly url: string) { Socket.instances.push(this); }
  frame(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  ready() { this.frame({ type: 'ready', user: { id: 'self', account: 'alice@example.test' } }); }
  message(id: string, own = false) {
    this.frame({ type: 'message', id, sender: { id: own ? 'self' : 'other', account: 'bob@example.test' },
      text: 'hello 😀', images: [], sentAt: new Date().toISOString() });
  }
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let controller: LoungeController;
let authorization = vi.fn(async () => ({ ticket: 'ticket' }));
beforeEach(async () => {
  vi.useFakeTimers(); Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  authorization = vi.fn(async () => ({ ticket: 'ticket' }));
  localStorage.clear();
  controller = new LoungeController({ baseUrl: 'https://example.test', authorize: authorization,
    avatars: browserAvatarStore('https://example.test') });
  controller.start(); await settle();
});
afterEach(() => { controller.stop(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('application lifetime lounge', () => {
  it('loads cached avatars on reconnect, repairs misses and persists remote resets', async () => {
    const store = browserAvatarStore('https://example.test');
    const avatar = 'data:image/png;base64,AAAA';
    store.save('self', avatar);
    const socket = Socket.instances[0];
    const ready = () => socket.frame({ type: 'ready', profiles: true, avatarCache: true,
      user: { id: 'self', account: 'alice@example.test' } });
    ready();
    expect(controller.snapshot().user?.avatar).toBe(avatar);
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({ type: 'profile-watch', watch: ['self'],
      clientVersions: true,
      avatarVersions: { self: loungeAvatarVersion(avatar) } });
    socket.message('first');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toMatchObject({ watch: ['self', 'other'],
      avatarVersions: { self: loungeAvatarVersion(avatar) } });
    socket.frame({ type: 'profiles', profiles: [{ id: 'other', avatar }] });
    const requests = socket.send.mock.calls.length;
    socket.message('second');
    expect(socket.send.mock.calls).toHaveLength(requests);
    expect(controller.snapshot().messages.every(message => message.sender.avatar === avatar)).toBe(true);
    expect(store.load('other')).toBe(avatar);
    ready();
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0]).avatarVersions)
      .toEqual({ self: loungeAvatarVersion(avatar), other: loungeAvatarVersion(avatar) });
    socket.frame({ type: 'profiles', profiles: [{ id: 'self', avatar: '' }, { id: 'other', avatar: '' }] });
    ready();
    expect(controller.snapshot().user?.avatar).toBeUndefined();
    expect(controller.snapshot().messages.every(message => !message.sender.avatar)).toBe(true);
    expect(store.load('other')).toBe('');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0]).avatarVersions)
      .toEqual({ self: loungeAvatarVersion(''), other: loungeAvatarVersion('') });
  });

  it('looks up unknown accounts without adding contacts until selected and refuses unsupported servers', async () => {
    const socket = Socket.instances[0]; socket.ready();
    const abort = new AbortController();
    await expect(controller.findAccount('bob', abort.signal)).rejects.toThrow('client.lounge.accountLookupFailed');
    socket.frame({ type: 'ready', direct: true, receipts: true, accountLookup: true,
      user: { id: 'self', account: 'alice@example.test' } });
    const result = controller.findAccount('bob', abort.signal);
    const request = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    socket.frame({ type: 'account-found', id: request.id, user: { id: 'bob', account: 'bob@example.test' } });
    const user = await result;
    expect(controller.snapshot().contacts).toEqual([]);
    expect(controller.snapshot().conversation).toBe('');
    controller.selectConversation(user);
    expect(controller.snapshot().conversation).toBe('bob');
    expect(controller.snapshot().contacts[0]).toMatchObject({ user: { ...user, account: 'bob' }, direct: true });
    const pending = controller.findAccount('carol', abort.signal).catch((error: Error) => error.message);
    socket.onclose?.();
    expect(await pending).toBe('client.lounge.accountLookupFailed');
  });
  it('shows current online counts only with moderator permission and clears stale counts', async () => {
    const socket = Socket.instances[0]; socket.ready();
    socket.frame({ type: 'presence', onlineCount: 5 });
    expect(controller.snapshot().onlineCount).toBeUndefined();
    socket.frame({ type: 'policy', policy: { moderator: true, mutedUntil: null }, onlineCount: 5 });
    expect(controller.snapshot().onlineCount).toBe(5);
    expect(controller.snapshot().user?.moderator).toBe(true);
    socket.frame({ type: 'presence', onlineCount: 6 });
    expect(controller.snapshot().onlineCount).toBe(6); expect(controller.snapshot().unread).toBe(0);
    socket.frame({ type: 'policy', policy: { moderator: false, mutedUntil: null } });
    expect(controller.snapshot().onlineCount).toBeUndefined();
    expect(controller.snapshot().user?.moderator).toBe(false);
    socket.frame({ type: 'policy', policy: { moderator: true, mutedUntil: null }, onlineCount: 6 });
    socket.onclose?.(); expect(controller.snapshot().onlineCount).toBeUndefined();
  });
  it('uses server avatars across devices and never lets stale local data undo a reset', async () => {
    const avatar = 'data:image/png;base64,AAAA';
    const socket = Socket.instances[0];
    const ready = (value = '') => socket.frame({ type: 'ready', profiles: true,
      user: { id: 'self', account: 'alice@example.test', avatar: value } });
    ready();
    const saving = controller.setAvatar(avatar);
    const request = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    expect(request).toMatchObject({ type: 'avatar', avatar });
    expect(controller.snapshot().user?.avatar).toBeUndefined();
    socket.frame({ type: 'profiles', profiles: [{ id: 'self', avatar }] });
    socket.frame({ type: 'updated', id: request.id }); await saving;
    expect(controller.snapshot().user?.avatar).toBe(avatar);
    const sending = controller.send({ text: 'private message', images: [] });
    const frame = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    expect(frame).not.toHaveProperty('avatar');
    socket.message(frame.id, true); await sending;
    ready(avatar); expect(controller.snapshot().user?.avatar).toBe(avatar);
    expect(JSON.stringify(localStorage)).not.toContain('private message');
    socket.frame({ type: 'profiles', profiles: [{ id: 'self', avatar: '' }] });
    expect(controller.snapshot().user?.avatar).toBeUndefined();
    browserAvatarStore('https://example.test').save('self', avatar);
    ready(); expect(controller.snapshot().user?.avatar).toBeUndefined();
    expect(browserAvatarStore('https://example.test').load('self')).toBe('');
  });
  it('keeps the accepted profile when saving fails and refuses local-only saves', async () => {
    const socket = Socket.instances[0]; socket.ready();
    await expect(controller.setAvatar('')).rejects.toThrow('client.lounge.avatarSaveFailed');
    const avatar = 'data:image/png;base64,AAAA';
    socket.frame({ type: 'ready', profiles: true, user: { id: 'self', account: 'alice@example.test', avatar } });
    const failed = controller.setAvatar('').catch(error => error.message);
    const request = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    socket.frame({ type: 'rejected', id: request.id, code: 'client.lounge.avatarSaveFailed' });
    expect(await failed).toBe('client.lounge.avatarSaveFailed');
    expect(controller.snapshot().user?.avatar).toBe(avatar);
    await expect(controller.setAvatar('https://tracker.test')).rejects.toThrow('client.lounge.imageFailed');
    const disconnected = controller.setAvatar('').catch(error => error.message);
    socket.onclose?.(); expect(await disconnected).toBe('client.lounge.avatarSaveFailed');
  });
  it('synchronizes known contact avatars in chat and history without changing message content', async () => {
    const socket = Socket.instances[0];
    socket.frame({ type: 'ready', profiles: true, user: { id: 'self', account: 'alice@example.test' } });
    socket.message('original');
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({ type: 'profile-watch', watch: ['other'],
      clientVersions: true });
    const avatar = 'data:image/png;base64,AAAA';
    socket.frame({ type: 'profiles', profiles: [{ id: 'other', avatar }] });
    expect(controller.snapshot().contacts[0].user.avatar).toBe(avatar);
    expect(controller.snapshot().messages[0].sender.avatar).toBe(avatar);
    expect((await controller.searchHistory({ query: '', limit: 50 })).messages[0].sender.avatar).toBe(avatar);
    const messages = controller.snapshot().messages;
    socket.frame({ type: 'profiles', profiles: [{ id: 'self', avatar }] });
    socket.frame({ type: 'contacts', contacts: [{ id: 'other', online: true }] });
    expect(controller.snapshot().messages).toBe(messages);
    socket.frame({ type: 'profiles', profiles: [{ id: 'other', avatar: '' }] });
    expect(controller.snapshot().messages[0].sender.avatar).toBeUndefined();
    expect(controller.snapshot().messages[0].id).toBe('original');
    expect(controller.snapshot().unread).toBe(1);
  });
  it('connects without opening the page, counts background messages, and clears only when visible', () => {
    const socket = Socket.instances[0];
    expect(String(socket.url)).toBe('wss://example.test/lounge/socket');
    socket.onopen?.(); expect(socket.send).toHaveBeenCalledWith(
      '{"type":"authenticate","ticket":"ticket","direct":true,"receipts":true,"groupAcks":true,"groupReads":true,"avatarCache":true}');
    socket.ready(); socket.message('one'); socket.message('one'); socket.message('own', true);
    expect(controller.snapshot().unread).toBe(1);
    expect(controller.snapshot().messages).toHaveLength(2);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    controller.setViewing(true); socket.message('two'); expect(controller.snapshot().unread).toBe(2);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    window.dispatchEvent(new Event('focus')); expect(controller.snapshot().unread).toBe(0);
    controller.setViewing(false); socket.message('three'); expect(controller.snapshot().unread).toBe(1);
  });
  it('reconnects after loss without requesting missed messages or resending pending messages', async () => {
    const socket = Socket.instances[0]; socket.ready(); socket.message('before');
    const sent = controller.send({ text: 'draft', images: [] }).catch(error => error.message);
    socket.onclose?.(); expect(await sent).toBe('client.lounge.sendFailed');
    await vi.advanceTimersByTimeAsync(1000); await settle();
    const next = Socket.instances[1]; next.onopen?.(); next.ready();
    expect(next.send.mock.calls).toEqual([
      ['{"type":"authenticate","ticket":"ticket","direct":true,"receipts":true,"groupAcks":true,"groupReads":true,"avatarCache":true}']]);
    expect(controller.snapshot().messages).toHaveLength(1);
  });
  it('acknowledges only the authenticated sender echo and keeps renewal on the same connection', async () => {
    const socket = Socket.instances[0]; socket.ready();
    let confirmed = false;
    const sending = controller.send({ text: 'draft', images: [] }).then(() => { confirmed = true; });
    const id = JSON.parse(socket.send.mock.calls[0][0]).id as string;
    socket.message(id); await settle(); expect(confirmed).toBe(false);
    socket.message(id, true); await sending; expect(confirmed).toBe(true);
    for (let i = 0; i < 13; i++) {
      socket.frame({ type: 'pong' }); await vi.advanceTimersByTimeAsync(20_000);
      if (i === 11) socket.ready();
    }
    expect(authorization).toHaveBeenCalledTimes(2);
    expect(Socket.instances).toHaveLength(1);
  });
  it('finishes a group send on server acceptance without an echo or waiting for local history', async () => {
    controller.stop();
    let finishSave!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finishSave = resolve; }));
    controller = new LoungeController({ baseUrl: 'https://example.test', authorize: authorization,
      history: { page: async () => ({ messages: [] }), save } });
    controller.start(); await settle();
    const socket = Socket.instances.at(-1)!; socket.ready();
    const image = 'data:image/png;base64,AAAA';
    const reply = { id: 'quoted', senderId: 'other', account: 'bob', text: 'quote', imageCount: 0 };
    const draft = { text: 'original', images: [image], reply };
    let confirmed = false;
    const sending = controller.send(draft).then(() => { confirmed = true; });
    const { id } = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    await settle(); expect(confirmed).toBe(false);
    draft.text = 'edited'; draft.images.length = 0; draft.reply.text = 'edited quote';
    const accepted = { type: 'accepted', id, sentAt: '2026-10-29T01:00:00Z' };
    socket.frame(accepted); await sending;
    expect(confirmed).toBe(true);
    expect(controller.snapshot().messages).toEqual([expect.objectContaining({ id, text: 'original',
      images: [image], reply: expect.objectContaining({ text: 'quote' }), sentAt: accepted.sentAt })]);
    expect(controller.snapshot().unread).toBe(0);
    socket.frame(accepted); socket.message(id, true); await settle();
    expect(controller.snapshot().messages).toHaveLength(1);
    expect(save).toHaveBeenCalledOnce();
    finishSave(); await settle();
  });
  it('ignores unknown or malformed acceptances and never uses group acknowledgements for actions', async () => {
    const socket = Socket.instances[0]; socket.ready();
    let confirmed = false;
    const sending = controller.send({ text: 'draft', images: [] }).then(() => { confirmed = true; });
    const { id } = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    socket.frame({ type: 'accepted', id: 'unknown', sentAt: new Date().toISOString() });
    socket.frame({ type: 'accepted', id, sentAt: 'invalid' });
    await settle(); expect(confirmed).toBe(false); expect(controller.snapshot().messages).toEqual([]);
    socket.frame({ type: 'accepted', id, sentAt: new Date().toISOString() }); await sending;
    let moderated = false;
    const action = controller.moderate('other', 1).then(() => { moderated = true; });
    const actionID = JSON.parse(socket.send.mock.calls.at(-1)![0]).id;
    socket.frame({ type: 'accepted', id: actionID, sentAt: new Date().toISOString() });
    await settle(); expect(moderated).toBe(false);
    socket.frame({ type: 'moderated', id: actionID }); await action;
  });
  it('keeps rejected and timed-out group sends out of history and ignores late confirmations', async () => {
    const socket = Socket.instances[0]; socket.ready();
    const rejected = controller.send({ text: 'rejected', images: [] }).catch(error => error.message);
    const rejectedID = JSON.parse(socket.send.mock.calls.at(-1)![0]).id;
    socket.frame({ type: 'rejected', id: rejectedID, code: 'client.lounge.muted' });
    expect(await rejected).toBe('client.lounge.muted');
    const timedOut = controller.send({ text: 'timeout', images: [] }).catch(error => error.message);
    const timeoutID = JSON.parse(socket.send.mock.calls.at(-1)![0]).id;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await timedOut).toBe('client.lounge.sendFailed');
    for (const id of [rejectedID, timeoutID]) socket.frame({ type: 'accepted', id, sentAt: new Date().toISOString() });
    expect(controller.snapshot().messages).toEqual([]);
  });
  it('recovers stale connections and rejects oversized or malformed incoming images', async () => {
    const socket = Socket.instances[0]; socket.ready();
    socket.frame({ type: 'message', id: 'bad', sender: { id: 'other', account: 'bob' },
      text: 'x', images: ['https://tracking.example/pixel'], sentAt: new Date().toISOString() });
    expect(controller.snapshot().messages).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(81_000);
    expect(socket.close).toHaveBeenCalled(); expect(Socket.instances.length).toBeGreaterThan(1);
  });
  it('bounds received history and clears it on logout', () => {
    const socket = Socket.instances[0]; socket.ready();
    for (let i = 0; i < 240; i++) socket.message(`message-${i}`);
    expect(controller.snapshot().messages).toHaveLength(200);
    controller.stop(); expect(controller.snapshot().messages).toHaveLength(0);
    expect(controller.snapshot().unread).toBe(0);
  });
  it('applies moderation without unread messages and refuses sending until the mute expires', async () => {
    const socket = Socket.instances[0]; socket.ready();
    socket.frame({ type: 'policy', policy: { moderator: true, mutedUntil: null } });
    expect(controller.snapshot().policy.moderator).toBe(true);
    const updating = controller.moderate('target', 60);
    const request = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    expect(request).toMatchObject({ type: 'moderate', userId: 'target', minutes: 60 });
    socket.frame({ type: 'moderated', id: request.id }); await updating;
    socket.frame({ type: 'policy', policy: { moderator: false, mutedUntil: new Date(Date.now() + 1000).toISOString() } });
    await expect(controller.send({ text: 'blocked', images: [] })).rejects.toThrow('client.lounge.muted');
    expect(controller.snapshot().unread).toBe(0);
    expect(controller.snapshot().messages).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1001);
    const sending = controller.send({ text: 'after expiry', images: [] });
    socket.message(JSON.parse(socket.send.mock.calls.at(-1)![0]).id, true);
    await sending;
  });
});
