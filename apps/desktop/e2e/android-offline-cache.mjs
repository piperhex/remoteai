import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adb, apiPort, apiUrl, output, prepare, waitFor, waitText, tap, input, nodes,
  screenshot, serverState, hasText, send } from './android-chat-driver.mjs';

const report = { passed: false };
const app = 'com.codexswitch.mobile';
async function sidebar(action) {
  const response = await fetch(`${apiUrl}/test/sidebar`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
  assert.equal(response.ok, true);
}
async function scrollOlder() {
  const scroll = (await nodes()).find((node) => node.scrollable === 'true');
  assert.ok(scroll, 'message list is scrollable');
  const [left, top, right, bottom] = scroll.rect;
  const x = String(Math.round((left + right) / 2));
  await adb('shell', 'input', 'swipe', x, String(top + 80), x, String(bottom - 80), '350');
}
async function openThread(title) {
  await tap('打开聊天列表');
  await waitText(title);
  await tap(title);
}
try {
  report.device = await prepare();
  await waitFor(async () => (await adb('logcat', '-d', '-s', 'ReactNativeJS')).includes('Running "main"'),
    'release app starts', 60_000);
  await waitText('云端服务器地址');
  await input(0, apiUrl); await input(1, 'mobile-test@example.test'); await input(2, 'local-test');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('登录并查看');
  await waitFor(async () => (await hasText('P2P')) || (await hasText('Relay')), 'connected');
  await sidebar('history-pages');
  await openThread('移动端聊天体验');
  await waitText('历史消息 35');
  const before = (await serverState()).synchronization.length;
  const loadedOlder = async () => (await serverState()).synchronization.slice(before)
    .some((entry) => entry.changedItems > 0);
  for (let index = 0; index < 10 && !await loadedOlder(); index++) await scrollOlder();
  await waitFor(loadedOlder, 'older page cached');
  if (await hasText('回到底部')) await tap('回到底部');
  await send('test local image preview');
  await waitText('放大查看：本地图片');
  await tap('放大查看：本地图片');
  await waitText('保存到相册');
  await waitFor(async () => !await hasText('正在加载原图…'), 'original loaded');
  assert.equal(await hasText('原图加载失败'), false);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('打开聊天列表'); await tap('新聊天');
  await send('offline second conversation');
  await waitFor(async () => !(await serverState()).threads.some((thread) =>
    thread.turns?.some((turn) => turn.status === 'inProgress')), 'second reply completed');
  await waitText('手机新聊天');
  assert.equal(await hasText('部分内容未能缓存'), false);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  // Give the background flush a chance to complete before simulating process death.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await adb('shell', 'am', 'force-stop', app);
  await adb('reverse', '--remove', `tcp:${apiPort}`);
  const count = (await serverState()).operations.length;
  await adb('logcat', '-c');
  await adb('shell', 'am', 'start', '-n', `${app}/.MainActivity`);
  await waitFor(async () => (await adb('logcat', '-d', '-s', 'ReactNativeJS')).includes('Running "main"'),
    'offline release app starts', 60_000);
  await waitText('连接后发消息');
  await openThread('手机新聊天');
  await waitText('second conversation');
  await screenshot('offline-second-conversation');
  await openThread('移动端聊天体验');
  await waitText('放大查看：本地图片');
  await tap('放大查看：本地图片');
  await waitText('保存到相册');
  await waitFor(async () => !await hasText('正在加载原图…'), 'cached original loaded');
  assert.equal(await hasText('原图加载失败'), false);
  await screenshot('offline-image');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  for (let index = 0; index < 18 && !await hasText('历史消息 19'); index++) await scrollOlder();
  await waitText('历史消息 19');
  await screenshot('offline-older-history');
  assert.equal((await serverState()).operations.length, count, 'offline browsing made no PC requests');
  const sendButton = (await nodes()).find((node) => node['content-desc'] === '发送消息');
  assert.ok(!sendButton || sendButton.enabled === 'false', 'offline composer cannot send');
  report.offlineRestart = true;
  await sidebar('history-pages');
  await adb('reverse', `tcp:${apiPort}`, `tcp:${apiPort}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  await adb('shell', 'am', 'start', '-n', `${app}/.MainActivity`);
  await waitFor(async () => (await hasText('P2P')) || (await hasText('Relay')), 'reconnected');
  if (await hasText('回到底部')) await tap('回到底部');
  await waitText('历史消息 35');
  assert.equal(await hasText('放大查看：本地图片'), false, 'server replacement removes stale cached messages');
  await screenshot('offline-reconnected');
  assert.deepEqual((await serverState()).streamErrors, []);
  report.passed = true;
  console.log('PASS offline restart, conversation switching, pagination, image and reconnect');
} catch (error) {
  report.error = String(error);
  await screenshot('offline-failed');
  throw error;
} finally {
  await adb('reverse', `tcp:${apiPort}`, `tcp:${apiPort}`);
  await writeFile(path.join(output, 'offline-report.json'), JSON.stringify(report, null, 2));
}
