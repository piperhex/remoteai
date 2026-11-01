import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/project-editor/android');
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to the test device');
const applicationId = 'com.codexswitch.mobile.filebrowsertest';
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adbCommand = sdk ? path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
const adb = async (...args) => (await exec(adbCommand, ['-s', serial, ...args],
  { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout;
const decode = text => text.replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const bounds = node => [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));

async function nodes() {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/project-editor-layout.xml');
  const xml = await adb('shell', 'cat', '/sdcard/project-editor-layout.xml');
  await writeFile(path.join(output, 'latest-layout.xml'), xml);
  return [...xml.matchAll(/<node\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)=("([^"]*)"|'([^']*)')/g)]
      .map(value => [value[1], decode(value[3] ?? value[4])])))
    .filter(node => node.package === applicationId);
}
async function find(label, ready = () => true) {
  const deadline = Date.now() + 20_000;
  do {
    const match = (await nodes()).find(node => (node.text === label || node['content-desc'] === label
      || (label === '文件内容' && node.class.endsWith('EditText') && node.text.includes('padding'))) && ready(node));
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(`Control not visible: ${label}`);
}
async function tap(label) {
  // The native drawer animates after launch; accessibility can expose its intermediate coordinates.
  let control = await find(label, node => node.enabled !== 'false');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const next = await find(label, node => node.enabled !== 'false');
    if (control.bounds === next.bounds) break;
    control = next;
    assert.ok(attempt < 4, `Control never settled: ${label}`);
  }
  const [left, top, right, bottom] = bounds(control);
  console.log(`Tap ${label}: ${control.bounds}`);
  await adb('shell', 'input', 'tap', String((left + right) >> 1), String((top + bottom) >> 1));
}
async function screenshot(name) {
  await adb('shell', 'screencap', '-p', '/sdcard/project-editor-result.png');
  await adb('pull', '/sdcard/project-editor-result.png', path.join(output, `${name}.png`));
}

async function verifyFixtureApk(apk) {
  assert.ok(sdk, 'ANDROID_HOME or ANDROID_SDK_ROOT is required to verify the fixture package');
  const versions = (await readdir(path.join(sdk, 'build-tools')))
    .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }));
  const aapt = path.join(sdk, 'build-tools', versions[0], process.platform === 'win32' ? 'aapt.exe' : 'aapt');
  const { stdout } = await exec(aapt, ['dump', 'badging', apk], { encoding: 'utf8', windowsHide: true });
  assert.equal(stdout.match(/package: name='([^']+)'/)?.[1], applicationId,
    'Only the independent fixture APK may be installed; never replace the main app');
  await writeFile(path.join(output, 'apk-badging.txt'), stdout);
}

await mkdir(output, { recursive: true });
const apk = path.join(root, 'apps/native/android/app/build/outputs/apk/release/project-browser-fixture.apk');
await verifyFixtureApk(apk);
const fontScale = (await adb('shell', 'settings', 'get', 'system', 'font_scale')).trim();
const focus = (await adb('shell', 'dumpsys', 'window')).match(/mCurrentFocus=.* u0 ([\w.$]+\/[\w.$]+)/)?.[1];
await writeFile(path.join(output, 'device-before.json'), JSON.stringify({ serial, fontScale, focus }, null, 2));
await adb('install', '-r', apk);
let passed = false;
try {
  for (const scale of [1, 1.3]) {
    await adb('shell', 'settings', 'put', 'system', 'font_scale', String(scale));
    await adb('shell', 'am', 'force-stop', applicationId);
    await adb('shell', 'am', 'start', '-W', '-n', `${applicationId}/com.codexswitch.mobile.MainActivity`);
    await tap('large.ts');
    await find('文件内容', node => node.text.includes('const needle'));
    await screenshot(`android-page-${scale}-initial`);
    await tap('下一页');
    await find('文件内容', node => node.text.includes('padding') && !node.text.includes('const needle'));
    await tap('第一页');
    await find('文件内容', node => node.text.includes('const needle'));
    await screenshot(`android-page-${scale}-returned`);
    if (scale === 1) {
      const [left, top] = bounds(await find('文件内容'));
      await adb('shell', 'input', 'tap', String(left + 80), String(top + 20));
      await adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_HOME');
      await adb('shell', 'input', 'text', 'native_window_edit');
      await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      await tap('下一页');
      await find('保留文件修改？');
      await screenshot('android-page-unsaved');
      await tap('保存并继续');
      await tap('第一页');
      await find('文件内容', node => node.text.includes('native_window_edit'));
      await screenshot('android-page-saved');
    }
    await tap('返回文件列表');
    await find('large.ts');
    await screenshot(`android-page-${scale}-back`);
  }
  passed = true;
} catch (error) {
  await screenshot('android-failed');
  throw error;
} finally {
  const cleanupErrors = [];
  const cleanup = async operation => {
    try { await operation(); } catch (error) { cleanupErrors.push(String(error)); }
  };
  await cleanup(async () => {
    if (fontScale === 'null') await adb('shell', 'settings', 'delete', 'system', 'font_scale');
    else await adb('shell', 'settings', 'put', 'system', 'font_scale', fontScale);
    assert.equal((await adb('shell', 'settings', 'get', 'system', 'font_scale')).trim(), fontScale);
  });
  await cleanup(() => adb('shell', 'am', 'force-stop', applicationId));
  await cleanup(() => adb('uninstall', applicationId));
  if (focus && !focus.startsWith(applicationId)) {
    await cleanup(() => adb('shell', 'am', 'start', '-W', '-n', focus));
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: passed && !cleanupErrors.length,
    serial, fontScales: [1, 1.3], originalFontScale: fontScale, cleanupErrors }, null, 2));
  assert.deepEqual(cleanupErrors, [], 'Device cleanup must finish before declaring verification complete');
}
console.log('PASS: physical Android page navigation, unsaved save guard, retained edit, and back navigation at fonts 1.0/1.3');
