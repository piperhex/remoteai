import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hierarchy, prepareHierarchy } from '../../desktop/e2e/android-hierarchy.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/work-drawer-native');
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to the connected phone');
const app = 'com.codexswitch.mobile.workdrawertest';
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args],
  { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout.trim();
const decode = text => text.replace(/&#(\d+);/g, (_, value) => String.fromCharCode(Number(value)))
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const bounds = node => [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
const matches = (node, label) => node.text === label || node['content-desc'] === label;

async function nodes() {
  const xml = await hierarchy(adb);
  await writeFile(path.join(output, 'latest.xml'), xml);
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(value => [value[1], decode(value[2])])));
}
async function find(label) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const node = (await nodes()).find(value => matches(value, label));
    if (node) return node;
  }
  assert.fail(`Missing native control: ${label}`);
}
async function tap(label) {
  const [left, top, right, bottom] = bounds(await find(label));
  // Target the summary label instead of blank space inside its full-width accessibility node.
  const x = label.startsWith('查看处理过程')
    ? left + Math.min(right - left, bottom - top) / 2 : (left + right) / 2;
  // Allow focus and layout to settle around the hierarchy probe and injected touch.
  await new Promise(resolve => setTimeout(resolve, 300));
  await adb('shell', 'input', 'tap', String(Math.round(x)), String((top + bottom) >> 1));
  await new Promise(resolve => setTimeout(resolve, 300));
}
async function screenshot(name) {
  await adb('shell', 'screencap', '-p', '/sdcard/work-drawer-result.png');
  await adb('pull', '/sdcard/work-drawer-result.png', path.join(output, `${name}.png`));
}
async function verifyCollapsed(name) {
  const close = await find('关闭正在处理');
  const tree = await nodes();
  assert.ok(!tree.some(node => /FIRST_OUTPUT|LIVE_OUTPUT_|TOOL_OUTPUT|LAST_OUTPUT|LINE_/.test(node.text)),
    'Collapsed details are absent from the native tree');
  assert.ok(!tree.some(node => matches(node, '复制命令')), 'Collapsed commands have no detail controls');
  assert.ok(bounds(close)[1] < 200, 'The sheet header reaches the top safe area');
  assert.ok(!tree.some(node => matches(node, '返回上一层')), 'No second detail sheet');
  await screenshot(name);
}
async function verifyExpanded(name) {
  await tap('已运行 git status --short');
  const first = (await nodes()).find(node => node.text.includes('FIRST_OUTPUT'));
  assert.ok(first, 'Clicking the command mounts its output inline');
  assert.ok(!(await nodes()).some(node => node.text.includes('LIVE_OUTPUT_')), 'Other commands stay unmounted');
  await screenshot(name);
  await tap('已运行 git status --short');
  await verifyCollapsed(`${name}-collapsed-again`);
}
async function verifyLive() {
  await tap('正在运行 npm run check');
  const value = tree => tree.find(node => node.text.includes('LIVE_OUTPUT_'))?.text;
  const first = value(await nodes());
  assert.ok(first, 'The running command expands');
  let updated = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (value(await nodes()) !== first) { updated = true; break; }
  }
  assert.ok(updated, 'Expanded output keeps receiving live updates');
  await tap('正在运行 npm run check');
}
async function scrollOutput(toEnd) {
  const tree = await nodes();
  const pane = tree.find(node => node['resource-id'] === 'command-output');
  assert.ok(pane, 'Expanded command has a scrolling output pane');
  const [left, top, right, bottom] = bounds(pane);
  const x = String((left + right) >> 1);
  const from = String(toEnd ? bottom - 30 : top + 30);
  const to = String(toEnd ? top + 30 : bottom - 30);
  await adb('shell', 'input', 'swipe', x, from, x, to, '180');
}
async function verifyVirtual(name) {
  await tap('已运行 Get-Content shared/chat/activityTimeline.ts; Get-Content apps/native/src/chat/ChatWorkDrawer.tsx');
  await find('复制输出');
  // Move the outer drawer while keeping the gesture outside the nested text pane.
  await adb('shell', 'input', 'swipe', '8', '2000', '8', '700', '350');
  let tree = await nodes();
  assert.ok(tree.some(node => node.text.includes('LINE_0 ')));
  assert.ok(!tree.some(node => /内容较长|上一段|下一段/.test(node.text)));
  await screenshot(`${name}-output-start`);
  for (let attempt = 0; attempt < 65 && !tree.some(node => node.text.includes('OUTPUT_END')); attempt++) {
    await scrollOutput(true);
    tree = await nodes();
    if (attempt === 6) await screenshot(`${name}-output-scrolled`);
  }
  assert.ok(tree.some(node => node.text.includes('OUTPUT_END')), 'Scrolling automatically reaches all output');
  assert.ok(!tree.some(node => node.text.includes('LINE_0 ')), 'Earlier output is recycled');
  assert.ok(tree.filter(node => node['resource-id'].startsWith('virtual-text-')).length < 8);
  // The final chunk can be mounted in overscan before its last line enters the viewport.
  await scrollOutput(true);
  await scrollOutput(true);
  await screenshot(`${name}-output-end`);
  await scrollOutput(false);
  await scrollOutput(false);
  assert.ok(!(await nodes()).some(node => node.text.includes('OUTPUT_END')), 'Scrolling back restores earlier output');
  await screenshot(`${name}-output-back`);
  await tap('复制输出');
  await tap('关闭正在处理');
  await tap('Read clipboard');
  const fullOutput = Array.from({ length: 160 }, (_, i) =>
    `LINE_${i} 检查记录 🙂 packages/cua/vendor/libs/cua-driver/scripts/install-windows-regression.ps1`).join('\n')
    + '\nOUTPUT_END';
  await find(`COPIED:${fullOutput.length}:true`);
  await tap('查看处理过程，5 项活动');
  await verifyCollapsed(`${name}-reopen-collapsed`);
  console.log(`PASS: ${name} virtual scrolling, recycling, scrolling back and full copy`);
}
async function verifyScale(scale) {
  await adb('shell', 'settings', 'put', 'system', 'font_scale', scale);
  await adb('shell', 'am', 'force-stop', app);
  await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
  await tap('查看处理过程，5 项活动');
  await verifyCollapsed(`android-light-font-${scale}-list`);
  await verifyExpanded(`android-light-font-${scale}-expanded`);
  await verifyLive();
  await verifyVirtual(`android-light-font-${scale}`);
  await tap('关闭正在处理');
  await find('查看处理过程，5 项活动');
  await tap('Toggle theme');
  await tap('查看处理过程，5 项活动');
  await verifyCollapsed(`android-dark-font-${scale}-list`);
  await verifyExpanded(`android-dark-font-${scale}-expanded`);
  await verifyVirtual(`android-dark-font-${scale}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await find('查看处理过程，5 项活动');
}

await mkdir(output, { recursive: true });
await prepareHierarchy({ adb, output });
await adb('install', '-r', path.join(root, 'apps/native/android/app/build-work-drawer/outputs/apk/debug/app-debug.apk'));
const originalScale = await adb('shell', 'settings', 'get', 'system', 'font_scale');
try {
  for (const scale of ['1.0', '1.3']) await verifyScale(scale);
  const pid = await adb('shell', 'pidof', app);
  const errors = await adb('logcat', '-d', '-t', '1000', `--pid=${pid}`, '-s', 'ReactNativeJS:E', 'AndroidRuntime:E');
  assert.doesNotMatch(errors, /FATAL EXCEPTION|TypeError|ReferenceError/);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ serial, passed: true,
    scales: ['1.0', '1.3'], cases: ['fullscreen', 'lazy details', 'inline toggle', 'live updates', 'close', 'back',
      'reopen collapsed', 'light and dark', 'virtual scrolling beyond 8000 characters', 'full output copy'],
  }, null, 2));
  console.log('PASS: Android fullscreen activity drawer, lazy inline output, live updates and font scales');
} finally {
  if (originalScale === 'null') await adb('shell', 'settings', 'delete', 'system', 'font_scale');
  else await adb('shell', 'settings', 'put', 'system', 'font_scale', originalScale);
  await adb('shell', 'am', 'force-stop', app);
}
