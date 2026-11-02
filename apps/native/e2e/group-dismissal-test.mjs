import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/group-dismissal');
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to a physical device');
const app = 'com.codexswitch.mobile.customgroupstest';
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args], {
  encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
})).stdout.trim();

async function nodes() {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/group-dismissal.xml');
  const xml = await adb('shell', 'cat', '/sdcard/group-dismissal.xml');
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])));
}
async function find(label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const node = (await nodes()).find(value => value['content-desc'] === label || value.text === label);
    if (node) return node;
    await delay(300);
  }
  assert.fail(`Missing native label: ${label}`);
}
function center(node) {
  const [left, top, right, bottom] = [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
  return [Math.round((left + right) / 2), Math.round((top + bottom) / 2)].map(String);
}
async function tap(label) { await adb('shell', 'input', 'tap', ...center(await find(label))); }
async function screenshot(name) {
  await adb('shell', 'screencap', '-p', '/sdcard/group-dismissal.png');
  await adb('pull', '/sdcard/group-dismissal.png', path.join(output, `${name}.png`));
}
async function closed() {
  await delay(500);
  const tree = await nodes();
  assert.ok(!tree.some(node => node.text === '管理分组'), 'A group sheet remained after dismissal');
  assert.ok(!tree.some(node => node.text === '请更新电脑端 Remote AI 后重试。'), 'An error sheet reopened');
  assert.ok(tree.some(node => node['content-desc'] === 'fixture-legacy'), 'The underlying page is inaccessible');
}
async function verify(scale) {
  await tap('fixture-legacy');
  await tap('管理分组');
  await find('请更新电脑端 Remote AI 后重试。');
  await screenshot(`android-${scale}-legacy-error`);
  await tap('关闭管理分组');
  await closed();
  await screenshot(`android-${scale}-closed`);
  await tap('管理分组');
  await find('请更新电脑端 Remote AI 后重试。');
  await adb('shell', 'input', 'keyevent', '4');
  await closed();
  await tap('管理分组');
  const handle = await find('下拉关闭');
  const [x, y] = center(handle);
  await adb('shell', 'input', 'swipe', x, y, x, String(Number(y) + 700), '350');
  await closed();
  await tap('fixture-delayed');
  await tap('管理分组');
  await tap('关闭管理分组');
  await delay(6500);
  await closed();
  await screenshot(`android-${scale}-late-error-closed`);
  await tap('fixture-none');
  await tap('管理分组');
  await find('新增分组');
  await tap('关闭管理分组');
  await closed();
  console.log(`PASS native group dismissal, back, drag and delayed failure at font scale ${scale}`);
}

const original = await adb('shell', 'settings', 'get', 'system', 'font_scale');
try {
  await mkdir(output, { recursive: true });
  await adb('install', '-r', path.join(root,
    'apps/native/android/app/build-custom-groups/outputs/apk/debug/app-debug.apk'));
  for (const scale of [1, 1.3]) {
    await adb('shell', 'settings', 'put', 'system', 'font_scale', String(scale));
    await adb('shell', 'am', 'force-stop', app);
    await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
    await verify(scale);
  }
  await writeFile(path.join(output, 'android-result.json'), JSON.stringify({ passed: true, fontScales: [1, 1.3] }));
} finally {
  if (original === 'null') await adb('shell', 'settings', 'delete', 'system', 'font_scale');
  else await adb('shell', 'settings', 'put', 'system', 'font_scale', original);
  await adb('shell', 'am', 'force-stop', app);
}
