import { expect, type Page, type WebSocketRoute } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { LoungeReply } from '../../../shared/lounge/reply';
import type { LoungeAccount } from '../../../shared/lounge/types';
import type { LoungeClientInfo } from '../../../shared/lounge/clientVersion';
import { LoungeNamesFixture } from './lounge-names-support';
import type { LoungeContactsFixture } from './lounge-contact-support';
import { LoungeNotificationsFixture } from './lounge-notifications-support';
import { LoungeAvatarCacheFixture } from './lounge-avatar-cache-support';

export const pixel = 'data:image/png;base64,'
  + readFileSync(new URL('../src-tauri/icons/32x32.png', import.meta.url)).toString('base64');
export async function setupLounge(page: Page, web = false, reset = false, savedContacts?: LoungeContactsFixture) {
  const names = new LoungeNamesFixture();
  const notifications = new LoungeNotificationsFixture();
  const avatarCache = new LoungeAvatarCacheFixture();
  let socket: WebSocketRoute;
  let connections = 0;
  let authentications = 0;
  let ticketsAvailable = true;
  let blocked = false;
  let acknowledge = true;
  let groupReply: 'echo' | 'manual' = 'echo';
  let contactOnline: boolean | null = true;
  let avatar = '';
  let rejectAvatar = false;
  let generation = 0;
  let rejectDelete = false;
  let directState = 'new';
  let lookupReply = true;
  let deviceSync = false;
  const reportedVersions: string[] = [];
  const lookups: string[] = [];
  const receipts: { type: string; id: string; to: string; status: string }[] = [];
  const moderation: { userId: string; minutes: number }[] = [];
  const sent: { id: string; text: string; images: string[]; avatar?: string; reply?: LoungeReply; to?: string }[] = [];
  const bob = { id: 'bob', account: 'bob@example.test' };
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.route('https://lounge.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/lounge/ticket' && !ticketsAvailable) return route.fulfill({ status: 503, body: '{}' });
    const data = path === '/lounge/ticket' ? { ticket: 'fixture-ticket' }
      : path === '/auth/me' ? { id: 'alice', email: 'alice@example.test', role: 'user' }
        : path === '/devices' ? { devices: [] } : path === '/devices/providers' ? { providers: [] }
          : path === '/sync/accounts/web-summary' ? { accounts: [] } : {};
    return route.fulfill({ json: data });
  });
  await page.routeWebSocket('**/lounge/socket', route => {
    socket = route; connections++;
    route.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (avatarCache.handle(route, frame)) return;
      names.handle(route, frame);
      notifications.handle(route, frame);
      savedContacts?.handle(route, frame);
      if (frame.type === 'authenticate') {
        if (typeof frame.clientVersion === 'string') reportedVersions.push(frame.clientVersion);
        route.send(JSON.stringify({ type: 'ready', profiles: true, accountLookup: true, names: names.enabled,
          avatarCache: avatarCache.enabled,
          savedContacts: !!savedContacts, deviceSync,
          notificationSettings: true, mutedConversations: notifications.muted,
          user: { id: 'alice', account: 'alice@example.test', avatar: avatarCache.enabled ? undefined : avatar,
            nickname: names.nicknames.get('alice') ?? '' },
          direct: true, receipts: true, directReset: reset, blocked: blocked ? [bob] : [] }));
        authentications++;
      }
      if (frame.type === 'ping') route.send('{"type":"pong"}');
      if (frame.type === 'lookup-account') {
        lookups.push(frame.query);
        if (!lookupReply) return;
        const query = frame.query.toLowerCase();
        const suffix = query === 'shared' ? 'Ambiguous' : query === 'alice@example.test' ? 'Self' : 'NotFound';
        route.send(JSON.stringify(query === 'bob' || query === bob.account
          ? { type: 'account-found', id: frame.id, user: bob }
          : { type: 'rejected', id: frame.id, code: `client.lounge.accountLookup${suffix}` }));
      }
      if (frame.type === 'watch' && reset) route.send(JSON.stringify({ type: 'direct-permissions',
        states: Object.fromEntries(frame.watch.map((id: string) => [id, directState])),
        generations: Object.fromEntries(frame.watch.map((id: string) => [id, generation])) }));
      if (frame.type === 'delete-direct') {
        if (rejectDelete) route.send(JSON.stringify({ type: 'rejected', id: frame.id, code: 'client.lounge.deleteFailed' }));
        else {
          generation++; directState = 'new';
          route.send(JSON.stringify({ type: 'direct-permissions', states: { bob: directState },
            generations: { bob: generation } }));
          route.send(JSON.stringify({ type: 'updated', id: frame.id, userId: 'bob', generation }));
        }
      }
      if (frame.type === 'avatar') {
        if (rejectAvatar) route.send(JSON.stringify({ type: 'rejected', id: frame.id,
          code: 'client.lounge.avatarSaveFailed' }));
        else {
          avatar = frame.avatar;
          route.send(JSON.stringify({ type: 'profiles', profiles: [{ id: 'alice', avatar }] }));
          route.send(JSON.stringify({ type: 'updated', id: frame.id }));
        }
      }
      if (frame.type === 'watch') route.send(JSON.stringify({ type: 'contacts',
        contacts: frame.watch.map((id: string) => ({ id, online: id === 'bob' ? contactOnline : true })) }));
      if (frame.type === 'block') {
        blocked = frame.blocked;
        route.send(JSON.stringify({ type: 'privacy', blocked: blocked ? [bob] : [] }));
        route.send(JSON.stringify({ type: 'updated', id: frame.id }));
      }
      if (frame.type === 'message') {
        if (frame.to && reset && directState === 'new') directState = 'waiting';
        sent.push(frame);
        if (!frame.to && groupReply === 'manual') return;
        route.send(JSON.stringify({ ...frame, sender: { id: 'alice', account: 'alice@example.test', avatar: frame.avatar },
          ...(frame.to ? { recipient: bob } : {}),
          sentAt: new Date().toISOString() }));
        if (frame.to && acknowledge) route.send(JSON.stringify({ type: 'receipt', id: frame.id,
          from: frame.to, to: 'alice', status: 'delivered' }));
      }
      if (frame.type === 'receipt') route.send(JSON.stringify({ type: 'receipt-confirm', id: frame.id,
        from: frame.to, to: 'alice', status: frame.status }));
      if (frame.type === 'receipt' || frame.type === 'receipt-confirm') receipts.push(frame);
      if (frame.type === 'moderate') {
        moderation.push(frame);
        route.send(JSON.stringify({ type: 'moderated', id: frame.id }));
      }
    });
  });
  await page.routeWebSocket('**/device-switch', route => route.onMessage(() => {}));
  await page.addInitScript(web => {
    localStorage.setItem('codex-switch:language', 'zh');
    localStorage.setItem('codex-switch.web.language.v1', 'zh');
    localStorage.setItem('codex-switch.web.session.v1', JSON.stringify({ baseUrl: 'https://lounge.test',
      accessToken: 'fixture', refreshToken: 'fixture', email: 'alice@example.test' }));
    Object.defineProperty(window, 'Notification', { configurable: true, value: class {
      constructor() { throw new Error('System notifications are forbidden'); }
      static requestPermission() { throw new Error('Notification permission is forbidden'); }
    } });
    if (!web) Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: (command: string) => {
        if (command === 'cloud_lounge_ticket') return sessionStorage.getItem('lounge-test-offline')
          ? Promise.reject(new Error('offline')) : Promise.resolve({ ticket: 'fixture-ticket' });
        throw new Error(`Unexpected native operation: ${command}`);
      },
    } });
  }, web);
  return {
    reportedVersions,
    versions: (clientVersions: string[], clients?: LoungeClientInfo[]) => socket.send(JSON.stringify({
      type: 'client-versions', users: [{ id: 'bob', clientVersions, clients }] })),
    avatarCache,
    notifications,
    enableDeviceSync: () => { deviceSync = true; },
    frame: (frame: object) => socket.send(JSON.stringify(frame)),
    names,
    groupReply: (value: typeof groupReply) => { groupReply = value; },
    acceptGroup: (index: number) => socket.send(JSON.stringify({ type: 'accepted', id: sent[index].id,
      sentAt: new Date().toISOString() })),
    echoGroup: (index: number) => socket.send(JSON.stringify({ ...sent[index], type: 'message',
      sender: { id: 'alice', account: 'alice@example.test' }, sentAt: new Date().toISOString() })),
    rejectGroup: (index: number) => socket.send(JSON.stringify({ type: 'rejected', id: sent[index].id,
      code: 'client.lounge.unavailable' })),
    lookups, lookupReply: (value: boolean) => { lookupReply = value; },
    rejectDelete: (value: boolean) => { rejectDelete = value; },
    sent, moderation, receipts, count: () => connections,
    avatar: (value: string) => {
      avatar = value;
      socket.send(JSON.stringify({ type: 'profiles', profiles: [{ id: 'alice', avatar }] }));
    },
    savedAvatar: () => avatar,
    rejectAvatar: (reject: boolean) => { rejectAvatar = reject; },
    acknowledge: (enabled: boolean) => { acknowledge = enabled; },
    receipt: (id: string, status: 'delivered' | 'read') => socket.send(JSON.stringify({
      type: 'receipt', id, from: 'bob', to: 'alice', status })),
    offline: () => { ticketsAvailable = false; },
    policy: (moderator: boolean, mutedUntil: string | null = null) => socket.send(JSON.stringify({
      type: 'policy', policy: { moderator, mutedUntil }, ...(moderator ? { onlineCount: 2 } : {}),
    })),
    presence: (onlineCount: number) => socket.send(JSON.stringify({ type: 'presence', onlineCount })),
    contact: (online: boolean | null) => {
      contactOnline = online;
      socket.send(JSON.stringify({ type: 'contacts', contacts: [{ id: 'bob', online }] }));
    },
    private: (text: string, sender: LoungeAccount = bob, id = crypto.randomUUID()) => {
      directState = 'open';
      socket.send(JSON.stringify({ type: 'message', id, text, images: [], sender,
        recipient: { id: 'alice', account: 'alice@example.test' }, generation,
        receipts: true, sentAt: new Date().toISOString() }));
      return id;
    },
    ready: () => expect.poll(() => authentications).toBeGreaterThan(0),
    close: () => socket.close({ code: 1001 }),
    push: (text: string, images: string[] = [], reply?: LoungeReply) => {
      const id = crypto.randomUUID();
      socket.send(JSON.stringify({ type: 'message', id, text, images, reply, sender: bob,
        sentAt: new Date().toISOString() }));
      return { id, senderId: bob.id, account: bob.account, text, imageCount: images.length };
    },
  };
}
