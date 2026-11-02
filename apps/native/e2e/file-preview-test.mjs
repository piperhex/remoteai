import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/file-preview-android');
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to a physical test device');
const assetsOnly = process.argv.includes('--assets-only');
const scaleArgument = process.argv.slice(2).find(value => !value.startsWith('--'));
const scales = scaleArgument ? [scaleArgument] : ['1.0', '1.3'];
assert.ok(scales.every(scale => ['1.0', '1.3'].includes(scale)), 'Supported font scales: 1.0 and 1.3');
const app = 'com.codexswitch.mobile.filepreviewtest';
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args], {
  encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
})).stdout.trim();
const bounds = node => [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
const matches = (node, label) => node['content-desc'] === label || node.text === label;

async function nodes() {
  const focus = await adb('shell', 'dumpsys', 'window');
  assert.ok(focus.split('\n').some(line => line.includes('mCurrentFocus') && line.includes(app)),
    'Preview test lost focus; another task may be using the device');
  await adb('shell', 'uiautomator', 'dump', '/sdcard/file-preview-layout.xml').catch(error => {
    // Some vendor ROMs kill the helper after it has successfully written the snapshot.
    if (error.code !== 137 || !error.stdout?.includes('UI hierchary dumped to:')) throw error;
  });
  const xml = await adb('shell', 'cat', '/sdcard/file-preview-layout.xml');
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])));
}
async function find(label) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const node = (await nodes()).find(value => matches(value, label));
    if (node) return node;
    await delay(400);
  }
  assert.fail(`Missing native label: ${label}`);
}
async function tap(label) {
  const [left, top, right, bottom] = bounds(await find(label));
  await adb('shell', 'input', 'tap', String((left + right) >> 1), String((top + bottom) >> 1));
  await delay(250);
}
async function screenshot(name) {
  await adb('shell', 'screencap', '-p', '/sdcard/file-preview-result.png');
  await adb('pull', '/sdcard/file-preview-result.png', path.join(output, `${name}.png`));
}
async function verifyHtml(scale) {
  await tap('页面预览.html');
  const title = bounds(await find('文件'));
  const initial = (await nodes()).find(node => node.class === 'android.webkit.WebView');
  assert.ok(initial, 'HTML WebView is visible');
  const initialBounds = bounds(initial);
  assert.ok(title[1] < 400, 'The drawer expands near the top of the phone');
  await screenshot(`html-drawer-${scale}`);
  await tap('全屏浏览');
  await find('退出全屏');
  const tree = await nodes();
  const expanded = bounds(tree.find(node => node.class === 'android.webkit.WebView'));
  assert.ok(expanded[3] - expanded[1] > initialBounds[3] - initialBounds[1], 'Fullscreen enlarges HTML');
  assert.ok(!tree.some(node => matches(node, '下载')), 'Fullscreen hides the download footer');
  await tap('保留预览状态');
  await find('已点击');
  await screenshot(`html-fullscreen-${scale}`);
  await tap('退出全屏');
  await find('已点击');
  await tap('源码');
  await tap('全屏浏览');
  assert.ok(!(await nodes()).some(node => node.class === 'android.webkit.WebView'), 'Source mode is retained');
  await screenshot(`html-source-${scale}`);
  await adb('shell', 'input', 'keyevent', '4');
  await find('全屏浏览');
  await tap('预览');
  await tap('关闭文件');
  await find('页面预览.html');
  return { title, initialBounds, expanded };
}
async function verifyText(scale, name, source) {
  await tap(name);
  await tap('全屏浏览');
  await find('退出全屏');
  if (source) { await tap(source); await find('自动换行'); }
  await screenshot(`${name.split('.').at(-1)}-fullscreen-${scale}`);
  await adb('shell', 'input', 'swipe', '500', '1800', '500', '700', '400');
  await find('退出全屏');
  await tap('退出全屏');
  await find('下载');
  await tap('关闭文件');
  await find(name);
}

async function verifyHtmlAssets(scale) {
  await tap('相对资源.html');
  // UIAutomator waits for animations to settle, which can outlast the loading indicator.
  await delay(1500);
  await screenshot(`html-assets-loading-${scale}`);
  await find('资源加载成功');
  await screenshot(`html-assets-ready-${scale}`);
  await tap('保留预览状态');
  await find('已点击');
  await verifyImageLink(scale);
  await tap('源码');
  await find('自动换行');
  assert.ok(!(await nodes()).some(node => node.class === 'android.webkit.WebView'), 'Source replaces HTML');
  await screenshot(`html-assets-source-${scale}`);
  await tap('关闭文件');
  await tap('缺失资源.html');
  await find('部分图片或媒体未能加载，可以重新打开预览再试。');
  await screenshot(`html-assets-missing-${scale}`);
  await tap('关闭文件');
  await tap('PNG 资源.html');
  await find('资源加载成功');
  await tap('保留预览状态');
  await verifyImageLink(`png-${scale}`);
  await tap('关闭文件');
}

async function verifyImageLink(scale) {
  await tap('相邻图片');
  await delay(1500);
  await screenshot(`html-link-loading-${scale}`);
  await find('关闭图片');
  for (let attempt = 0; attempt < 8; attempt++) {
    const tree = await nodes();
    if (tree.some(node => node.class === 'android.webkit.WebView')
      && !tree.some(node => matches(node, '正在加载原图…'))) break;
    await delay(400);
  }
  assert.ok(!(await nodes()).some(node => matches(node, '正在加载原图…')), 'The original finishes decoding');
  await screenshot(`html-link-opened-${scale}`);
  await tap('关闭图片');
  await find('已点击');
  await screenshot(`html-link-returned-${scale}`);
  await tap('相邻图片');
  await find('关闭图片');
  await adb('shell', 'input', 'keyevent', '4');
  await find('已点击');
}

await mkdir(output, { recursive: true });
const previousScale = await adb('shell', 'settings', 'get', 'system', 'font_scale');
if (!process.argv.includes('--skip-install')) {
  await adb('install', '-r', path.join(root, 'apps/native/android/app/build-file-preview/outputs/apk/debug/app-debug.apk'));
}
try {
  const results = {};
  for (const scale of scales) {
    await adb('shell', 'settings', 'put', 'system', 'font_scale', scale);
    await adb('shell', 'am', 'force-stop', app);
    await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
    if (!assetsOnly) results[scale] = await verifyHtml(scale);
    await verifyHtmlAssets(scale);
    if (assetsOnly) { results[scale] = { assets: 'passed' }; continue; }
    await verifyText(scale, '说明文档.md', '原文');
    await verifyText(scale, '代码预览.ts');
    await tap('安装包.apk');
    assert.ok(!(await nodes()).some(node => matches(node, '全屏浏览')), 'Download-only files stay compact');
    await find('下载');
    await tap('关闭文件');
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, results }, null, 2));
  console.log(`PASS: ${assetsOnly ? 'HTML assets, loading, source and missing-file states'
    : 'filled drawer, HTML/source state, fullscreen, scrolling, close/back'} at font scales ${scales.join(', ')}`);
} finally {
  const focus = await adb('shell', 'dumpsys', 'window');
  const focused = focus.split('\n').some(line => line.includes('mCurrentFocus') && line.includes(app));
  await adb('shell', 'settings', 'put', 'system', 'font_scale', previousScale);
  await adb('shell', 'am', 'force-stop', app);
  if (focused) await adb('shell', 'am', 'start', '-W', '-n', 'com.codexswitch.mobile/com.codexswitch.mobile.MainActivity');
}
