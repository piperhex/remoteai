import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/tool-details');
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to the connected phone');
const applicationId = 'com.codexswitch.mobile.tooldetailstest';
const reported = JSON.parse(await readFile(path.join(root, 'shared/chat/toolDetailsFixture.json'), 'utf8'));
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args],
  { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout;
const decode = text => text.replace(/&#(\d+);/g, (_, value) => String.fromCharCode(Number(value)))
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const bounds = node => [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
const matches = (node, label) => node.text?.replace(/\uFFFC/g, '') === label || node['content-desc'] === label;

async function nodes() {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/tool-details-layout.xml');
  const xml = await adb('shell', 'cat', '/sdcard/tool-details-layout.xml');
  await writeFile(path.join(output, 'latest.xml'), xml);
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)=(["'])(.*?)\2/g)].map(value => [value[1], decode(value[3])])));
}

async function find(label) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const target = (await nodes()).find(node => matches(node, label));
    if (target) return target;
  }
  throw new Error(`Control not visible: ${label}`);
}

async function tap(label) {
  const [left, top, right, bottom] = bounds(await find(label));
  await adb('shell', 'input', 'tap', String((left + right) >> 1), String((top + bottom) >> 1));
}

async function screenshot(name) {
  await adb('shell', 'screencap', '-p', '/sdcard/tool-details-result.png');
  await adb('pull', '/sdcard/tool-details-result.png', path.join(output, `${name}.png`));
}

async function verifyStructured(name) {
  const tree = await nodes();
  const structured = tree.find(node => node.text?.includes('"elements": 100'));
  assert.ok(structured, 'Structured data is readable without opening another sheet');
  assert.ok(reported.result.content.every(part => !tree.some(node => node.text?.includes(part.text))),
    'Raw text is not duplicated above the structured result');
  assert.ok(!tree.some(node => matches(node, '查看结构化结果')), 'No nested structured-result disclosure');
  const copies = tree.filter(node => node['content-desc'] === '复制原始数据');
  assert.equal(copies.length, 1, 'Only one raw copy entry');
  const contentBounds = bounds(structured);
  const copyBounds = bounds(copies[0]);
  assert.ok(copyBounds[1] >= contentBounds[3], 'Raw copy entry is below the structured result');
  await screenshot(name);
  return { contentBounds, copyBounds };
}

async function verifyNested() {
  await tap('查看输入');
  await find('复制输入');
  await screenshot('input');
  await tap('关闭输入');
  await find('复制原始数据');
  await find('关闭使用工具');
}

async function scrollTo(label) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const tree = await nodes();
    if (tree.some(node => matches(node, label))) return;
    const scroll = tree.find(node => node.scrollable === 'true');
    assert.ok(scroll, 'Long output has a scrollable viewport');
    const [left, top, right, bottom] = bounds(scroll);
    const x = String((left + right) >> 1);
    await adb('shell', 'input', 'swipe', x, String(bottom - 50), x, String(top + 50), '100');
  }
  throw new Error(`Unable to scroll to ${label}`);
}

await mkdir(output, { recursive: true });
const originalFontScale = (await adb('shell', 'settings', 'get', 'system', 'font_scale')).trim();
try {
await adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
await adb('install', '-r', path.join(root,
  'apps/native/android/app/build/outputs/apk/release/tool-details-fixture.apk'));
await adb('shell', 'am', 'force-stop', applicationId);
await adb('shell', 'am', 'start', '-W', '-n', `${applicationId}/com.codexswitch.mobile.MainActivity`);
await find('关闭使用工具');
const light = await verifyStructured('android-light-font-1');
await verifyNested();
await tap('复制原始数据');
await find('已复制');
await tap('关闭使用工具');
await tap('检查复制内容');
await find(JSON.stringify(reported.result, null, 2));
await tap('切换主题');
await tap('reported');
const dark = await verifyStructured('android-dark-font-1');
await tap('返回上一层');
await tap('literal');
await find('<div>literal output</div>\n**keep these characters**');
await screenshot('literal');
await tap('关闭使用工具');
await tap('long');
await scrollTo('下一段');
await tap('下一段');
await scrollTo('复制完整内容');
assert.ok((await nodes()).some(node => node.text?.includes('OUTPUT_END')), 'The final page remains readable');
await screenshot('last-page');
await tap('复制完整内容');
await find('已复制');
await tap('关闭使用工具');
await tap('检查复制内容');
const copied = (await nodes()).find(node => node['resource-id'] === 'copied-output')?.text;
assert.ok(copied?.length > 8_000 && copied.endsWith('OUTPUT_END'), 'Paging still copies the complete output');
await tap('切换主题');
await tap('reported');
await adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3');
await find('复制原始数据');
const enlarged = await verifyStructured('android-light-font-1.3');
await tap('返回上一层');
await tap('切换主题');
await tap('reported');
await verifyStructured('android-dark-font-1.3');
const pid = (await adb('shell', 'pidof', applicationId)).trim();
assert.match(pid, /^\d+$/);
const errors = await adb('logcat', '-d', '-t', '1000', `--pid=${pid}`, '-s', 'ReactNativeJS:E', 'AndroidRuntime:E');
assert.doesNotMatch(errors, /FATAL EXCEPTION|TypeError|ReferenceError/);
await writeFile(path.join(output, 'result.json'), JSON.stringify({ serial, light, dark, enlarged, passed: true,
  cases: ['direct structured output', 'input sheet', 'raw copy', 'themes', 'literal text', 'paging full copy',
    'font scales 1.0 and 1.3'] }, null, 2));
console.log('PASS: real Android structured results, raw copy, input sheet, themes, fonts and pagination');
} finally {
  await adb('shell', 'settings', 'put', 'system', 'font_scale', originalFontScale);
}
