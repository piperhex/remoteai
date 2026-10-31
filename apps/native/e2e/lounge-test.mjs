import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { verifyNativeAvatar } from './lounge-avatar-check.mjs';
import { verifyNativeImage } from './lounge-image-check.mjs';
import { verifyNativeEmoji } from './lounge-emoji-check.mjs';
import { verifyNativeText } from './lounge-text-check.mjs';
import { verifyNativePresence } from './lounge-presence-check.mjs';
import { verifyNativeProfile } from './lounge-profile-check.mjs';
import { verifyNativePreview } from './lounge-preview-check.mjs';
import { verifyNativeNewChat } from './lounge-new-chat-check.mjs';
import { verifyNativeOrdering } from './lounge-ordering-check.mjs';
import { verifyNativeChatActions } from './lounge-chat-actions-check.mjs';
import { verifyNativeNames } from './lounge-names-check.mjs';
import { createNamesFixture } from './lounge-names-fixture.mjs';
import { verifyNativeContacts } from './lounge-contacts-check.mjs';
import { loadHistorySource, verifyNativeSync } from './lounge-sync-check.mjs';
import { verifyNativeNotifications } from './lounge-notifications-check.mjs';
import { verifyNativeAdminBadge } from './lounge-admin-badge-check.mjs';
import { verifyNativeAccountPrivacy } from './lounge-account-privacy-check.mjs';
import { verifyNativeGestures } from './lounge-gestures-check.mjs';
import { verifyNativeLoungeScroll } from './lounge-scroll-check.mjs';
import { verifyNativePrivateScroll } from './lounge-private-scroll-check.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to a physical test device');
const output = path.join(root, process.env.LOUNGE_TEST_OUTPUT ?? (process.env.LOUNGE_TEXT_ONLY === '1'
  ? `.codex-tmp/lounge-text-${serial}` : '.codex-tmp/lounge-android'));
const app = process.env.LOUNGE_TEST_APP ?? 'com.codexswitch.mobile.loungetest';
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args], {
  encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
})).stdout.trim();
const image = 'data:image/png;base64,' + (await readFile(path.join(root,
  'apps/desktop/src-tauri/icons/32x32.png'))).toString('base64');
const sent = [];
const moderated = [];
let online = true;
let blocked = false;
let avatar = '';
let rejectAvatar = false;
const avatarSaves = [];
const resetAvailable = process.env.LOUNGE_PROFILE_ONLY === '1' || process.env.LOUNGE_CHAT_ACTIONS_ONLY === '1';
let generation = 0;
let directState = 'new';
let failDelete = false;
let lookupReply = true;
const lookups = [];
const contactsMode = process.env.LOUNGE_CONTACTS_ONLY === '1';
const syncMode = process.env.LOUNGE_DEVICE_SYNC_ONLY === '1';
if (syncMode) globalThis.WebSocket = WebSocket;
const syncSource = syncMode ? await loadHistorySource(root) : undefined;
let savedContacts = [];
const server = createServer((request, response) => {
  response.writeHead(online ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ticket: 'fixture-ticket' }));
});
const sockets = new WebSocket.Server({ noServer: true });
const syncSockets = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const target = request.url === '/device-chat' && syncSource ? syncSockets : sockets;
  target.handleUpgrade(request, socket, head, client => target.emit('connection', client));
});
syncSockets.on('connection', socket => {
  const client = syncSource.broker.attach({ send: data => socket.send(data), close: () => socket.close(1001) });
  socket.on('message', data => client.receive(Buffer.from(data).subarray(0, 4).toString() === 'CSB1'
    ? new Uint8Array(data) : String(data)));
  socket.on('close', client.disconnect);
});
function incoming(text, images = []) {
  return { type: 'message', id: crypto.randomUUID(), text, images,
    sender: { id: 'bob', account: 'bob@example.test' }, sentAt: new Date().toISOString() };
}
function broadcast(frame) { for (const socket of sockets.clients) socket.send(JSON.stringify(frame)); }
const notifications = { muted: new Set(), fail: false, update(conversation, muted) {
  if (muted) this.muted.add(conversation); else this.muted.delete(conversation);
  broadcast({ type: 'notification-settings', conversation, muted });
} };
const names = createNamesFixture(broadcast);
sockets.on('connection', socket => socket.on('message', raw => {
  const frame = JSON.parse(String(raw));
  if (process.env.LOUNGE_NAMES_ONLY === '1') names.handle(socket, frame);
  if (frame.type === 'authenticate') {
    socket.send(JSON.stringify({ type: 'ready', profiles: true, accountLookup: true,
      savedContacts: contactsMode, deviceSync: syncMode,
      notificationSettings: true, mutedConversations: [...notifications.muted],
      names: process.env.LOUNGE_NAMES_ONLY === '1',
      user: { id: 'alice', account: 'alice@example.test', avatar, nickname: names.nicknames.get('alice') ?? '',
        moderator: true },
      policy: { moderator: true, mutedUntil: null }, onlineCount: 2, direct: true, receipts: true,
      directReset: resetAvailable,
      blocked: blocked ? [{ id: 'bob', account: 'bob@example.test' }] : [] }));
    socket.send(JSON.stringify(incoming('真机中文测试：忙里偷闲，聊点轻松的 ☕', [image])));
  }
  if (frame.type === 'ping') socket.send('{"type":"pong"}');
  if (frame.type === 'notification-setting') {
    if (notifications.fail) socket.send(JSON.stringify({ type: 'rejected', id: frame.id,
      code: 'client.lounge.notificationSaveFailed' }));
    else {
      notifications.update(frame.conversation, frame.muted);
      socket.send(JSON.stringify({ type: 'updated', id: frame.id }));
    }
  }
  if (frame.type === 'sync-contacts' && contactsMode) {
    socket.send(JSON.stringify({ type: 'saved-contacts', id: frame.id, users: savedContacts }));
  }
  if (frame.type === 'lookup-account') {
    lookups.push(frame.query);
    if (!lookupReply) return;
    const query = frame.query.toLowerCase();
    const suffix = query === 'shared' ? 'Ambiguous' : query === 'alice@example.test' ? 'Self' : 'NotFound';
    socket.send(JSON.stringify(query === 'bob' || query === 'bob@example.test'
      ? { type: 'account-found', id: frame.id, user: { id: 'bob', account: 'bob@example.test' } }
      : { type: 'rejected', id: frame.id, code: `client.lounge.accountLookup${suffix}` }));
  }
  if (frame.type === 'watch' && resetAvailable) socket.send(JSON.stringify({ type: 'direct-permissions',
    states: Object.fromEntries(frame.watch.map(id => [id, directState])),
    generations: Object.fromEntries(frame.watch.map(id => [id, generation])) }));
  if (frame.type === 'delete-direct') {
    if (failDelete) socket.send(JSON.stringify({ type: 'rejected', id: frame.id, code: 'client.lounge.deleteFailed' }));
    else {
      generation++; directState = 'new';
      broadcast({ type: 'direct-permissions', states: { bob: directState }, generations: { bob: generation } });
      socket.send(JSON.stringify({ type: 'updated', id: frame.id, userId: 'bob', generation }));
    }
  }
  if (frame.type === 'avatar') {
    if (rejectAvatar) socket.send(JSON.stringify({ type: 'rejected', id: frame.id,
      code: 'client.lounge.avatarSaveFailed' }));
    else {
      avatar = frame.avatar; avatarSaves.push(avatar);
      broadcast({ type: 'profiles', profiles: [{ id: 'alice', avatar }] });
      socket.send(JSON.stringify({ type: 'updated', id: frame.id }));
    }
  }
  if (frame.type === 'watch') socket.send(JSON.stringify({ type: 'contacts',
    contacts: frame.watch.map(id => ({ id, online: true })) }));
  if (frame.type === 'block') {
    blocked = frame.blocked;
    socket.send(JSON.stringify({ type: 'privacy', blocked: blocked ? [{ id: 'bob', account: 'bob@example.test' }] : [] }));
    socket.send(JSON.stringify({ type: 'updated', id: frame.id }));
  }
  if (frame.type === 'message') {
    if (frame.to && resetAvailable && directState === 'new') directState = 'waiting';
    sent.push(frame);
    socket.send(JSON.stringify({ ...frame, sender: { id: 'alice', account: 'alice@example.test', avatar: frame.avatar,
      moderator: true },
      ...(frame.to ? { recipient: { id: frame.to, account: `${frame.to}@example.test` } } : {}),
      sentAt: new Date().toISOString() }));
    if (frame.to) socket.send(JSON.stringify({ type: 'receipt', id: frame.id, from: frame.to,
      to: 'alice', status: 'delivered' }));
  }
  if (frame.type === 'receipt') socket.send(JSON.stringify({ type: 'receipt-confirm', id: frame.id,
    from: frame.to, to: 'alice', status: frame.status }));
  if (frame.type === 'moderate') {
    moderated.push(frame); socket.send(JSON.stringify({ type: 'moderated', id: frame.id }));
  }
}));

async function nodes() {
  let dumped = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      dumped = await adb('shell', 'uiautomator', 'dump', '/sdcard/lounge-layout.xml');
    } catch (failure) {
      if (failure.code !== 137 || attempt === 2) throw failure;
      // Android can reclaim the dumper during app startup; retry without using stale coordinates.
    }
    if (dumped.includes('dumped to:')) break;
    await delay(750);
  }
  assert.ok(dumped.includes('dumped to:'), 'UI hierarchy dump failed; never read stale touch coordinates');
  const xml = await adb('shell', 'cat', '/sdcard/lounge-layout.xml');
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))])));
}
async function find(label) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const node = (await nodes()).sort((a, b) => Number(b.clickable === 'true') - Number(a.clickable === 'true')).find(value => {
      if (value.text !== label && value['content-desc'] !== label) return false;
      const [left, top, right, bottom] = [...value.bounds.matchAll(/\d+/g)].map(number => Number(number[0]));
      return right > left && bottom > top;
    });
    if (node) return node;
    await delay(500);
  }
  assert.fail(`Missing native label: ${label}`);
}
async function tap(label) {
  const node = await find(label);
  const [left, top, right, bottom] = [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
  const x = String(Math.round((left + right) / 2)); const y = String(Math.round((top + bottom) / 2));
  // Give the native responder a frame between down/up, as a real finger tap does.
  await adb('shell', 'input', 'touchscreen', 'motionevent', 'DOWN', x, y);
  await delay(100);
  await adb('shell', 'input', 'touchscreen', 'motionevent', 'UP', x, y);
  await delay(350);
}
async function longPress(label) {
  const node = await find(label);
  console.log(`Long press ${label}: ${node.bounds}`);
  const [left, top, right, bottom] = [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
  const x = String(Math.round((left + right) / 2)); const y = String(Math.round((top + bottom) / 2));
  await adb('shell', 'input', 'swipe', x, y, x, y, '750'); await delay(350);
}
async function longPressBesideMessage(label) {
  const node = await find(label);
  const [, top, , bottom] = [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
  const width = Number((await adb('shell', 'wm', 'size')).match(/(\d+)x\d+/)[1]);
  const x = String(width - 5); const y = String(Math.round((top + bottom) / 2));
  await adb('shell', 'input', 'swipe', x, y, x, y, '750'); await delay(350);
  assert.ok(!(await nodes()).some(value => value.text === '引用回复'), 'Blank space cannot open the message menu');
}
async function screenshot(name) {
  await adb('shell', 'screencap', '-p', '/sdcard/lounge-result.png');
  await adb('pull', '/sdcard/lounge-result.png', path.join(output, `${name}.png`));
  console.log(`Captured native lounge: ${name}`);
}
async function hideKeyboard() {
  const state = await adb('shell', 'dumpsys', 'input_method');
  if (state.includes('mInputShown=true')) {
    await adb('shell', 'input', 'keyevent', '4'); await delay(500);
  }
}
async function assertEventually(predicate, label) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await delay(250);
  }
  assert.fail(label);
}

const originalScale = await adb('shell', 'settings', 'get', 'system', 'font_scale');
try {
  await mkdir(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  if (syncSource) {
    syncSource.add('来自另一台设备的群聊记录 SyncGroup', [image]);
    syncSource.add('来自另一台设备的私聊记录', [image], true);
    syncSource.start(`http://127.0.0.1:${server.address().port}`);
  }
  await adb('reverse', 'tcp:1497', `tcp:${server.address().port}`);
  await adb('install', '-r', process.env.LOUNGE_TEST_APK
    ?? path.join(root, 'apps/native/android/app/build/outputs/apk/release/lounge-fixture.apk'));
  for (const scale of [1, 1.3]) {
    notifications.muted.clear(); notifications.fail = false;
    names.reset();
    savedContacts = [{ id: 'bob', account: 'bob@example.test' }];
    online = true;
    blocked = false;
    generation = 0; directState = 'new'; failDelete = false;
    const unique = `Hello-native-${Date.now()}`;
    const sentBefore = sent.length;
    const moderatedBefore = moderated.length;
    await adb('shell', 'settings', 'put', 'system', 'font_scale', String(scale));
    await adb('shell', 'am', 'force-stop', app);
    await adb('shell', 'pm', 'clear', app);
    await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
    await find('在线交流'); if (scale === 1.3) await tap('Light fixture');
    await find('1'); await screenshot(`discovery-${scale}`);
    await tap('在线交流'); await find('搜索聊天');
    if (process.env.LOUNGE_PRIVATE_SCROLL_ONLY === '1') {
      await verifyNativePrivateScroll({ adb, tap, find, nodes, screenshot, scale, broadcast, incoming, image });
      continue;
    }
    if (process.env.LOUNGE_PRIVACY_ONLY === '1') {
      await verifyNativeAccountPrivacy({ tap, find, nodes, screenshot, scale, broadcast, incoming });
      continue;
    }
    if (process.env.LOUNGE_SCROLL_ONLY === '1') {
      await verifyNativeLoungeScroll({ adb, tap, find, nodes, screenshot, scale, broadcast, incoming, app });
      continue;
    }
    if (syncSource) {
      await verifyNativeSync({ adb, tap, find, screenshot, scale, source: syncSource, assertEventually, hideKeyboard });
      continue;
    }
    if (process.env.LOUNGE_NOTIFICATIONS_ONLY === '1') {
      await verifyNativeNotifications({ adb, tap, find, nodes, screenshot, longPress, scale,
        broadcast, incoming, notifications, restart: async () => {
          await adb('shell', 'am', 'force-stop', app); await adb('shell', 'pm', 'clear', app);
          await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
          await find('在线交流'); if (scale === 1.3) await tap('Light fixture');
          await tap('在线交流'); await find('搜索聊天');
        } });
      continue;
    }
    if (contactsMode) {
      await verifyNativeContacts({ tap, find, nodes, screenshot, scale,
        addContact: user => { savedContacts.push(user); broadcast({ type: 'saved-contacts-changed' }); },
        restart: async () => {
          await adb('shell', 'am', 'force-stop', app); await adb('shell', 'pm', 'clear', app);
          await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
          await find('在线交流'); if (scale === 1.3) await tap('Light fixture');
          await tap('在线交流'); await find('搜索聊天');
        } });
      continue;
    }
    if (process.env.LOUNGE_NAMES_ONLY === '1') {
      await verifyNativeNames({ adb, tap, find, nodes, screenshot, hideKeyboard, longPress,
        scale, names, broadcast, incoming, restart: async () => {
          await adb('shell', 'am', 'force-stop', app); await adb('shell', 'pm', 'clear', app);
          await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
          await find('在线交流'); if (scale === 1.3) await tap('Light fixture');
          await tap('在线交流'); await find('搜索聊天');
        } });
      continue;
    }
    if (process.env.LOUNGE_CHAT_ACTIONS_ONLY === '1') {
      await verifyNativeChatActions({ adb, tap, find, nodes, screenshot, longPress, scale, broadcast, incoming });
      continue;
    }
    if (process.env.LOUNGE_ORDERING_ONLY === '1') {
      await verifyNativeOrdering({ adb, tap, find, nodes, screenshot, longPress, hideKeyboard, scale, broadcast, incoming,
        restart: async () => {
          online = false;
          await adb('shell', 'am', 'force-stop', app);
          await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
          await find('在线交流'); await tap('在线交流'); await find('搜索聊天');
        } });
      continue;
    }
    if (process.env.LOUNGE_NEW_CHAT_ONLY === '1') {
      await verifyNativeNewChat({ adb, tap, find, nodes, screenshot, hideKeyboard, scale, sent, lookups,
        lookupReply: value => { lookupReply = value; } });
      continue;
    }
    if (process.env.LOUNGE_PREVIEW_ONLY === '1') {
      await verifyNativePreview({ adb, tap, find, nodes, screenshot, scale, broadcast, incoming });
      continue;
    }
    if (resetAvailable) {
      await verifyNativeProfile({ adb, tap, find, nodes, screenshot, hideKeyboard, longPress, scale, sent,
        failDelete: value => { failDelete = value; },
        reply: text => { directState = 'open'; broadcast({ ...incoming(text), generation, receipts: true,
          recipient: { id: 'alice', account: 'alice@example.test' } }); },
        restart: async () => {
          await adb('shell', 'am', 'force-stop', app);
          await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
          await find('在线交流'); await tap('在线交流'); await find('搜索聊天');
        },
      });
      continue;
    }
    if (process.env.LOUNGE_PRESENCE_ONLY === '1') {
      await verifyNativePresence({ adb, tap, find, nodes, screenshot, scale, broadcast, incoming, image });
      continue;
    }
    await tap('群聊'); await find('真机中文测试：忙里偷闲，聊点轻松的 ☕');
    if (process.env.LOUNGE_GESTURES_ONLY === '1') {
      await verifyNativeGestures({ adb, tap, find, nodes, screenshot, hideKeyboard, longPress,
        scale, sent, broadcast, incoming });
      continue;
    }
    if (process.env.LOUNGE_ADMIN_BADGE_ONLY === '1') {
      await verifyNativeAdminBadge({ adb, tap, find, nodes, screenshot, hideKeyboard, scale, broadcast, incoming });
      continue;
    }
    if (process.env.LOUNGE_TEXT_ONLY === '1') {
      await verifyNativeText({ adb, tap, find, screenshot, hideKeyboard, scale, broadcast, incoming, image,
        fail: value => { rejectAvatar = value; }, saves: () => avatarSaves,
        profile: value => { avatar = value; broadcast({ type: 'profiles', profiles: [{ id: 'alice', avatar }] }); },
      });
      continue;
    }
    if (process.env.LOUNGE_EMOJI_ONLY === '1') {
      await verifyNativeEmoji({ adb, tap, find, nodes, screenshot, scale, sent });
      continue;
    }
    if (process.env.LOUNGE_IMAGE_ONLY === '1') {
      await verifyNativeImage({ adb, tap, find, screenshot, output, scale });
      continue;
    }
    if (process.env.LOUNGE_AVATAR_ONLY === '1') {
      await verifyNativeAvatar({ tap, find, screenshot, image, scale, saves: () => avatarSaves,
        fail: value => { rejectAvatar = value; },
        profile: value => { avatar = value; broadcast({ type: 'profiles', profiles: [{ id: 'alice', avatar }] }); },
        restart: async clear => {
          await adb('shell', 'am', 'force-stop', app);
          if (clear) await adb('shell', 'pm', 'clear', app);
          await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
          await find('在线交流');
        },
      });
      continue;
    }
    await find('真机中文测试：忙里偷闲，聊点轻松的 ☕'); await screenshot(`chat-${scale}`);
    await longPressBesideMessage('真机中文测试：忙里偷闲，聊点轻松的 ☕');
    await tap('聊天'); await find('新聊天');
    assert.ok(!(await nodes()).some(node => node['content-desc'] === '与 bob 私聊'),
      'Group participants must not appear in the private chat list');
    await screenshot(`people-empty-${scale}`); await tap('返回聊天');
    await find('2 人在线'); broadcast({ type: 'presence', onlineCount: 3 }); await find('3 人在线');
    await longPress('真机中文测试：忙里偷闲，聊点轻松的 ☕'); await find('引用回复');
    await screenshot(`message-actions-${scale}`); await tap('引用回复'); await find('回复 bob');
    await tap('取消引用'); await hideKeyboard();
    await longPress('真机中文测试：忙里偷闲，聊点轻松的 ☕'); await tap('引用回复');
    await tap('消息'); await adb('shell', 'input', 'text', unique); await screenshot(`keyboard-${scale}`);
    await tap('发送');
    await assertEventually(() => sent.length > sentBefore && sent.at(-1).text === unique, 'Send ack');
    assert.equal(sent.at(-1).reply?.account, 'bob');
    assert.equal(sent.at(-1).reply?.imageCount, 1);
    await tap('消息'); await adb('shell', 'input', 'text', 'Draft');
    await hideKeyboard();
    await tap('添加内容'); await tap('历史记录'); await tap('搜索消息或账户'); await adb('shell', 'input', 'text', unique);
    await find('本页 1 条记录'); await hideKeyboard(); await screenshot(`history-${scale}`);
    await find('查看原消息');
    await tap('返回聊天'); await find('Draft');
    broadcast(incoming('私聊入口测试'));
    await longPress('私聊入口测试'); await tap('发起私聊');
    await tap('聊天'); await screenshot(`people-${scale}`);
    await longPress('与 bob 私聊'); await tap('发起私聊'); await find('在线');
    await tap('消息'); await adb('shell', 'input', 'text', `Private-${unique}`); await tap('发送');
    await assertEventually(() => sent.at(-1)?.to === 'bob', 'Private recipient');
    await find('对方已收到');
    broadcast({ type: 'receipt', id: sent.at(-1).id, from: 'bob', to: 'alice', status: 'read' });
    await find('对方已阅读');
    const beforeReply = sent.length;
    await tap('消息'); await adb('shell', 'input', 'text', 'waiting-draft'); await tap('发送');
    await find('对方回复后才能继续发送。'); await find('waiting-draft');
    assert.equal(sent.length, beforeReply, 'A read receipt must not unlock a second private message');
    await hideKeyboard(); await screenshot(`opening-limit-${scale}`);
    broadcast({ ...incoming('收到你的问候啦'), recipient: { id: 'alice', account: 'alice@example.test' }, receipts: true });
    await find('收到你的问候啦'); await tap('发送');
    await assertEventually(() => sent.length === beforeReply + 1 && sent.at(-1).text === 'waiting-draft',
      'The retained draft can be sent after a reply');
    await tap('消息'); await adb('shell', 'input', 'text', 'free-chat'); await tap('发送');
    await assertEventually(() => sent.at(-1).text === 'free-chat', 'Later private messages do not need another reply');
    await hideKeyboard(); await screenshot(`private-${scale}`);
    await tap('添加内容'); await tap('屏蔽此人'); await screenshot(`block-confirm-${scale}`); await tap('屏蔽此人');
    await find('在线');
    broadcast({ ...incoming('blocked-private'), recipient: { id: 'alice', account: 'alice@example.test' } });
    broadcast(incoming('blocked-group'));
    await tap('消息'); await adb('shell', 'input', 'text', 'blocker-outbound'); await tap('发送');
    await assertEventually(() => sent.at(-1)?.text === 'blocker-outbound', 'Blocker may initiate private chat');
    await hideKeyboard();
    assert.ok(!(await nodes()).some(node => node.text === 'blocked-private'), 'Block filters private messages');
    await tap('添加内容'); await tap('取消屏蔽'); await tap('取消屏蔽');
    broadcast({ type: 'contacts', contacts: [{ id: 'bob', online: null }] }); await find('在线状态不可见');
    await screenshot(`private-hidden-${scale}`);
    await tap('聊天'); await tap('群聊');
    assert.ok(!(await nodes()).some(node => node.text === 'blocked-group'), 'Block filters new group messages');
    broadcast(incoming('管理入口测试')); await find('管理入口测试');
    await tap('管理 bob 的发言权限'); await find('禁言时长（分钟）');
    await screenshot(`moderation-${scale}`); await tap('禁言');
    await assertEventually(() => moderated.length > moderatedBefore, 'Moderation ack');
    await tap('添加内容'); await tap('设置头像'); await find('选择图片'); await screenshot(`avatar-${scale}`); await tap('取消');
    broadcast({ type: 'policy', policy: { moderator: false, mutedUntil: new Date(Date.now() + 60000).toISOString() } });
    await delay(500); await screenshot(`muted-${scale}`);
    assert.ok(!(await nodes()).some(node => node.text === '3 人在线'), 'Ordinary users cannot see presence');
    await tap('聊天'); await tap('返回发现'); await find('在线交流');
    broadcast(incoming('后台未读消息')); await find('1');
    await tap('在线交流'); await tap('群聊'); await find('后台未读消息');
    await adb('shell', 'input', 'keyevent', '3');
    broadcast(incoming('切回应用后收到')); await delay(300);
    await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
    await find('切回应用后收到');
    await adb('shell', 'input', 'keyevent', '4'); await tap('返回发现');
    await tap('English'); await tap('Online Chat'); await tap('Group chat');
    await find('Chats'); await screenshot(`english-${scale}`);
    await adb('shell', 'input', 'keyevent', '4'); await tap('Back to Discover');
    await tap('Sign out fixture'); await find('Signed out fixture');
    await assertEventually(() => sockets.clients.size === 0, 'Sign out closes socket');
    online = false;
    await adb('shell', 'am', 'force-stop', app);
    await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
    await find('在线交流');
    assert.ok(!(await nodes()).some(node => node.text === '1'), 'Restored messages must not add unread');
    await tap('在线交流'); await tap('群聊');
    await tap('添加内容'); await tap('历史记录'); await tap('搜索消息或账户');
    await adb('shell', 'input', 'text', unique); await find('本页 1 条记录'); await find(unique);
    await find('查看原消息');
    await hideKeyboard(); await screenshot(`offline-restart-${scale}`);
    await tap('返回聊天'); await tap('聊天'); await tap('与 bob 私聊');
    await tap('添加内容'); await tap('历史记录'); await tap('搜索消息或账户'); await adb('shell', 'input', 'text', `Private-${unique}`);
    await find('本页 1 条记录'); await find('对方已阅读');
    await hideKeyboard(); await screenshot(`private-offline-${scale}`);
    assert.equal(sockets.clients.size, 0, 'Search must work without a connection');
    console.log(`PASS native lounge at font scale ${scale}: history survives offline restart; discovery, send, moderation`);
  }
} catch (error) {
  await screenshot('failed');
  throw error;
} finally {
  if (originalScale === 'null') await adb('shell', 'settings', 'delete', 'system', 'font_scale');
  else await adb('shell', 'settings', 'put', 'system', 'font_scale', originalScale);
  await adb('shell', 'am', 'force-stop', app);
  await adb('reverse', '--remove', 'tcp:1497');
  for (const socket of sockets.clients) socket.terminate();
  syncSource?.stop();
  for (const socket of syncSockets.clients) socket.terminate();
  syncSockets.close();
  sockets.close(); server.close();
  const packages = await adb('shell', 'pm', 'list', 'packages', 'com.codexswitch.mobile');
  if (packages.split(/\r?\n/).includes('package:com.codexswitch.mobile')) {
    await adb('shell', 'am', 'start', '-W', '-n', 'com.codexswitch.mobile/com.codexswitch.mobile.MainActivity');
  }
}
