import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { hierarchy, prepareHierarchy } from '../../desktop/e2e/android-hierarchy.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/dictation-native');
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to a physical test device');
const app = 'com.codexswitch.mobile.dictationtest';
const port = 17941;
const calls = [];
const replies = [];
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args], {
  encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
})).stdout.trim();
const decode = text => text.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
async function nodes() {
  const xml = await hierarchy(adb);
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], decode(attribute[2])])));
}
async function find(label) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tree = await nodes();
    const node = tree.find(value => value['content-desc'] === label) ?? tree.find(value => value.text === label);
    if (node) return node;
    if (label === '正在录音' && tree.some(value => value.text.includes('麦克风'))) {
      const allow = tree.find(value => value.text === '仅在使用中允许');
      if (allow) await tapNode(allow);
    }
    await delay(300);
  }
  assert.fail(`Missing native label: ${label}`);
}
async function tapNode(node) {
  const [left, top, right, bottom] = [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
  await adb('shell', 'input', 'tap', String((left + right) >> 1), String((top + bottom) >> 1));
  await delay(250);
}
async function tap(label) { await tapNode(await find(label)); }
async function screenshot(name) {
  await adb('shell', 'screencap', '-p', '/sdcard/dictation-result.png');
  await adb('pull', '/sdcard/dictation-result.png', path.join(output, `${name}.png`));
}
async function waitFor(check) {
  for (let index = 0; index < 80; index++) { if (check()) return; await delay(100); }
  assert.fail('Timed out waiting for the dictation request');
}
async function startApp() {
  await adb('shell', 'am', 'force-stop', app);
  await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
  await find('语音输入');
  await delay(400);
}

async function record() {
  const previous = calls.length;
  for (let attempt = 0; attempt < 3 && calls.length === previous; attempt++) await tap('语音输入');
  await find('正在录音');
}
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  calls.push(body);
  response.setHeader('Content-Type', 'application/json');
  if (body.action === 'transcribe') { replies.push(response); return; }
  response.end(JSON.stringify(body.action === 'prepare' ? { sessionId: `test-${calls.length}` } : {}));
});
const reply = (value, status = 200) => {
  const response = replies.shift(); assert.ok(response);
  response.statusCode = status; response.end(JSON.stringify(value));
};
await mkdir(output, { recursive: true });
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const originalScale = await adb('shell', 'settings', 'get', 'system', 'font_scale');
try {
  await adb('install', '-r', path.join(root, 'apps/native/android/app/build-dictation/outputs/apk/debug/app-debug.apk'));
  await adb('reverse', `tcp:${port}`, `tcp:${port}`);
  await prepareHierarchy({ adb, output });
  await adb('shell', 'pm', 'revoke', app, 'android.permission.RECORD_AUDIO');
  for (const scale of ['1.0', '1.3']) {
    await adb('shell', 'settings', 'put', 'system', 'font_scale', scale);
    await startApp();
    for (const mode of ['light', 'dark']) {
      if (mode === 'dark') await tap('切换主题');
      const name = `android-${mode}-font-${scale}`;
      assert.equal((await find('语音输入')).enabled, 'true');
      await screenshot(`${name}-empty`);
      await record();
      await screenshot(`${name}-recording`);
      await tap('结束录音并转写');
      await waitFor(() => replies.length === 1);
      const upload = calls.at(-1);
      assert.equal(upload.mimeType, 'audio/mp4');
      const bytes = Buffer.from(upload.data, 'base64');
      assert.ok(bytes.length > 100, 'The real microphone produced audio');
      assert.equal(bytes.subarray(4, 8).toString(), 'ftyp', 'Native audio is an MPEG-4 container');
      await screenshot(`${name}-transcribing`);
      reply({ text: '请检查代码。' });
      assert.equal((await find('聊天消息')).text, '请检查代码。');
      assert.equal((await find('已发送')).text, '', 'Transcription does not send the draft');
      await screenshot(`${name}-draft`);
      await tap('发送消息');
      assert.equal((await find('已发送')).text, '请检查代码。');
      await find('语音输入');
      await tap('切换运行'); await find('暂停生成');
      await screenshot(`${name}-pause`);
      await tap('暂停生成'); await find('继续生成');
      await screenshot(`${name}-continue`);
      await tap('切换中断');
      // Reset the sent evidence before the next theme without modifying the installed production app.
      if (mode === 'light') await startApp();
      console.log(`PASS: ${name} recording, draft, pause, continue and screenshot checks`);
    }
  }
  await startApp();
  const uploads = () => calls.filter(call => call.action === 'transcribe');
  const beforeCancel = uploads().length;
  await record(); await tap('取消语音输入');
  await find('语音输入'); assert.equal(uploads().length, beforeCancel);
  await record(); await tap('结束录音并转写');
  await waitFor(() => replies.length === 1);
  reply({ error: 'client.dictation.transcriptionFailedPleaseRetry' }, 400);
  await find('重试转写'); await screenshot('android-transcription-error');
  const originalUpload = uploads().at(-1);
  await tap('重试转写'); await waitFor(() => replies.length === 1);
  assert.deepEqual(uploads().at(-1), originalUpload, 'Retry sends the original recording');
  await tap('取消语音输入'); reply({ text: '不应出现的旧结果' });
  await find('语音输入'); assert.equal((await find('聊天消息')).text, '');
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true,
    recordingCount: uploads().length, scales: [1, 1.3], themes: ['light', 'dark'],
    transcription: 'Mock host response; real device recording and shared transport' }, null, 2));
  console.log('PASS: cancellation, retry and stale transcript suppression');
} catch (error) {
  await screenshot('android-failure');
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ message: String(error),
    nodes: await nodes(), calls: calls.map(({ data, ...call }) => ({ ...call, audioBytes: data?.length })) }, null, 2));
  throw error;
} finally {
  for (const response of replies) response.end(JSON.stringify({ text: '' }));
  server.close();
  await adb('shell', 'am', 'force-stop', app);
  await adb('shell', 'settings', 'put', 'system', 'font_scale', originalScale);
  await adb('reverse', '--remove', `tcp:${port}`);
}
