import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to a physical test device');
const app = 'com.codexswitch.mobile.avatarcachetest';
const output = path.join(root, '.codex-tmp/lounge-avatar-cache-native');
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args], {
  encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
})).stdout.trim();
const image = 'data:image/png;base64,' + (await readFile(path.join(root,
  'apps/desktop/src-tauri/icons/128x128.png'))).toString('base64');
const version = value => createHash('sha256').update(value).digest('hex');
const avatars = new Map([['alice', image], ['bob', image]]);
const transfers = [];
const sent = [];
let snapshot;
let client;
let versions = {};
let watching = [];
let connections = 0;
function sync() {
  const profiles = watching.flatMap(id => {
    const avatar = avatars.get(id) ?? '';
    if (versions[id] === version(avatar)) return [];
    versions[id] = version(avatar); transfers.push(id);
    return [{ id, avatar, version: versions[id] }];
  });
  if (profiles.length) client.send(JSON.stringify({ type: 'profiles', profiles }));
}
const server = createServer(async (request, response) => {
  if (request.url === '/snapshot') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    snapshot = JSON.parse(Buffer.concat(chunks).toString());
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ticket: 'fixture-ticket' }));
});
const sockets = new WebSocket.Server({ server });
sockets.on('connection', socket => {
  client = socket; watching = []; versions = {}; connections++;
  socket.on('message', raw => {
    const frame = JSON.parse(String(raw));
    if (frame.type === 'authenticate') {
      assert.equal(frame.avatarCache, true);
      socket.send(JSON.stringify({ type: 'ready', profiles: true, avatarCache: true,
        user: { id: 'alice', account: 'alice' }, groupAcks: true }));
      socket.send(JSON.stringify({ type: 'message', id: `bob-${connections}`, text: '头像只在变化时同步',
        images: [], sender: { id: 'bob', account: 'bob' }, sentAt: new Date().toISOString() }));
    }
    if (frame.type === 'profile-watch') {
      versions = Object.fromEntries(frame.watch.map(id => [id,
        watching.includes(id) ? versions[id] : frame.avatarVersions[id]]));
      watching = frame.watch; sync();
    }
    if (frame.type === 'message') {
      assert.equal(Object.hasOwn(frame, 'avatar'), false); sent.push(frame);
      socket.send(JSON.stringify({ type: 'accepted', id: frame.id, sentAt: new Date().toISOString() }));
    }
    if (frame.type === 'ping') socket.send('{"type":"pong"}');
  });
});
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(200); }
  assert.fail(label);
}
async function openGroup() {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/avatar-cache-layout.xml');
  const xml = await adb('shell', 'cat', '/sdcard/avatar-cache-layout.xml');
  const node = [...xml.matchAll(/<node\b[^>]*>/g)].find(([value]) => /text="群聊"/.test(value))?.[0];
  assert.ok(node, 'Group chat entry must be visible');
  const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
  await adb('shell', 'input', 'tap', String(Math.round((bounds[0] + bounds[2]) / 2)),
    String(Math.round((bounds[1] + bounds[3]) / 2)));
  await delay(600);
}
async function screenshot(state) {
  await delay(400);
  await adb('shell', 'screencap', '-p', '/sdcard/avatar-cache-result.png');
  await adb('pull', '/sdcard/avatar-cache-result.png', path.join(output, `${state}.png`));
}
const launch = () => adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
try {
  await mkdir(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await adb('reverse', 'tcp:1499', `tcp:${server.address().port}`);
  await adb('install', '-r', path.join(root,
    'apps/native/android/app/build/outputs/apk/release/lounge-avatar-cache-fixture.apk'));
  await adb('shell', 'pm', 'clear', app); await launch();
  const matches = avatar => snapshot?.self === version(image)
    && snapshot.messages.some(message => message.sender === 'bob' && message.avatar === version(avatar));
  await until(() => matches(image) && sent.length === 1, 'Initial profile and message synchronization');
  assert.equal(transfers.length, 2);
  await openGroup(); await screenshot('native-light-cached');
  await adb('shell', 'am', 'force-stop', app); snapshot = undefined; await launch();
  await until(() => matches(image) && connections === 2 && sent.length === 2, 'Cache survives app restart');
  assert.equal(transfers.length, 2, 'Restart must not download the same avatars');
  await openGroup(); await screenshot('native-light-restarted');
  avatars.set('bob', ''); sync();
  await until(() => matches(''), 'Remote avatar reset updates existing messages');
  await screenshot('native-light-reset');
  avatars.set('bob', image); sync();
  await until(() => matches(image), 'Remote avatar change updates existing messages');
  assert.equal(transfers.length, 4);
  await screenshot('native-light-changed');
  console.log('PASS native cached avatars: first sync, restart reuse, reset, update, no avatar in messages');
} finally {
  await adb('shell', 'am', 'force-stop', app);
  await adb('reverse', '--remove', 'tcp:1499');
  for (const socket of sockets.clients) socket.terminate();
  sockets.close(); server.close();
}
