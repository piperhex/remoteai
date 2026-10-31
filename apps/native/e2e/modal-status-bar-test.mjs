import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hierarchy, prepareHierarchy } from '../../desktop/e2e/android-hierarchy.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/image-preview-status-bar', process.argv[2] ?? 'android');
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to the physical test device');
const app = 'com.codexswitch.mobile.modalstatustest';
const scale = process.argv[3] ?? '1.0';
assert.ok(['1.0', '1.3'].includes(scale), 'Supported font scales: 1.0 and 1.3');
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args], {
  encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
})).stdout.trim();
const matches = (node, label) => node.text === label || node['content-desc'] === label;
const bounds = node => [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));

async function nodes() {
  const xml = await hierarchy(adb);
  assert.ok(xml.includes(`package="${app}"`), 'Another application took the test device foreground');
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(value => [value[1], value[2]])));
}
async function find(label) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const node = (await nodes()).find(value => matches(value, label));
    if (node) return node;
    await delay(250);
  }
  assert.fail(`Missing native control: ${label}`);
}
async function tap(label) {
  const [left, top, right, bottom] = bounds(await find(label));
  await adb('shell', 'input', 'tap', String((left + right) >> 1), String((top + bottom) >> 1));
}
async function capture(name, samples = 1) {
  const darkTheme = name.includes('-dark-') !== name.includes('-theme-changed');
  for (let sample = 0; sample < samples; sample++) {
    await adb('shell', 'screencap', '-p', '/sdcard/modal-status-result.png');
    await adb('pull', '/sdcard/modal-status-result.png', path.join(output, `${name}-${sample}.png`));
    const windows = await adb('shell', 'dumpsys', 'window', 'windows');
    await writeFile(path.join(output, `${name}-${sample}-windows.txt`), windows);
    const window = windows.split(/\n\s*Window #\d+/).find(block => block.split('\n')[0].includes(app)
      && block.includes('mHasSurface=true') && block.includes('isReadyForDisplay()=true'));
    assert.ok(window, 'The test window is visible');
    const attributes = window.split('mViewVisibility')[0];
    assert.equal(/apr=[^\n]*\bLIGHT_STATUS_BARS\b/.test(attributes), !darkTheme, `${name}: status-bar icon contrast`);
    await delay(200);
  }
  if (name.endsWith('-editor')) {
    const recording = '/sdcard/modal-status-recording.mp4';
    await adb('shell', 'screenrecord', '--size', '720x1600', '--time-limit', '4', recording);
    await adb('pull', recording, path.join(output, `${name}.mp4`));
  }
}
async function editor(theme) {
  await tap('打开图片标注');
  await find('完成');
  await capture(`android-${theme}-editor`, 3);
  await tap('取消');
  await find('打开图片标注');
  await capture(`android-${theme}-editor-closed`);
  await tap('打开图片标注');
  await find('完成');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await find('打开图片标注');
}
async function keyboard(theme) {
  const label = '键盘避让验证';
  const originalBottom = bounds(await find(label))[3];
  await tap(label);
  await delay(600);
  const resizedBottom = bounds(await find(label))[3];
  assert.ok(originalBottom - resizedBottom > 100, 'The dialog resizes above the keyboard');
  await capture(`android-${theme}-keyboard`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await find('关闭设置');
}
async function sheets(theme) {
  await tap('打开设置抽屉');
  await find('关闭设置');
  await capture(`android-${theme}-sheet`, 3);
  await keyboard(theme);
  await tap('打开下一层');
  await find('关闭下一层');
  await capture(`android-${theme}-nested`, 3);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await find('关闭设置');
  await capture(`android-${theme}-nested-closed`);
  await tap('切换主题');
  await capture(`android-${theme}-theme-changed`, 3);
  await tap('切换主题');
  await tap('关闭设置');
  await find('打开设置抽屉');
  await capture(`android-${theme}-sheet-closed`);
}

await mkdir(output, { recursive: true });
await prepareHierarchy({ adb, output });
await adb('install', '-r', path.join(root,
  'apps/native/android/app/build-modal-status-bar/outputs/apk/debug/app-debug.apk'));
const previousScale = await adb('shell', 'settings', 'get', 'system', 'font_scale');
try {
  await adb('shell', 'settings', 'put', 'system', 'font_scale', scale);
  await adb('shell', 'am', 'force-stop', app);
  await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
  for (const theme of ['light', 'dark']) {
    await find('打开图片标注');
    await capture(`android-${theme}-home`);
    await editor(theme);
    await sheets(theme);
    await tap('切换主题');
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ serial, fontScale: scale, passed: true,
    cases: ['photo annotation', 'sheet', 'nested sheets', 'theme changes while open',
      'keyboard resize', 'cancel', 'back', 'reopen'],
    visualReviewRequired: true,
  }, null, 2));
  console.log('PASS: modal interaction matrix; inspect screenshots for status-bar contrast and stability');
} finally {
  await adb('shell', 'am', 'force-stop', app);
  if (previousScale === 'null') await adb('shell', 'settings', 'delete', 'system', 'font_scale');
  else await adb('shell', 'settings', 'put', 'system', 'font_scale', previousScale);
}
