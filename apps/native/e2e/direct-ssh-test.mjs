import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { hierarchy, prepareHierarchy } from '../../desktop/e2e/android-hierarchy.mjs';

const exec = promisify(execFile);
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to a physical Android device');
const app = 'com.codexswitch.mobile.directsshtest';
const output = fileURLToPath(new URL('../../../.codex-tmp/direct-ssh/', import.meta.url));
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args], {
  encoding: 'utf8', timeout: 30_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
})).stdout.trim();

async function nodes() {
  const xml = await hierarchy(adb);
  await writeFile(`${output}/latest.xml`, xml);
  assert.ok(xml.includes(`package="${app}"`), 'The isolated test app must remain in front');
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(value => [value[1], value[2]])));
}
async function find(label) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const matches = (await nodes()).filter(node => node.text === label || node['content-desc'] === label
      || node['content-desc']?.includes(label));
    const node = matches.find(value => value.clickable === 'true') ?? matches[0];
    if (node) return node;
    await delay(400);
  }
  throw new Error(`Missing ${label}`);
}
async function tap(label) {
  const node = await find(label);
  const [left, top, right, bottom] = [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
  await adb('shell', 'input', 'tap', String((left + right) >> 1), String((top + bottom) >> 1));
  await delay(400);
}
async function screenshot(name) {
  const { stdout } = await exec('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  await writeFile(`${output}/${name}.png`, stdout);
}
async function verify(scale) {
  await adb('shell', 'settings', 'put', 'system', 'font_scale', String(scale));
  await adb('shell', 'am', 'force-stop', app);
  await adb('shell', 'am', 'start', '-W', '-n', `${app}/com.codexswitch.mobile.MainActivity`);
  await find('Direct SSH checks passed');
  const result = JSON.parse(await readFile(`${output}/native-result.json`, 'utf8'));
  assert.equal(result.passed, true);
  await tap('LIGHT'); await tap('SSH');
  await find('新建');
  assert.ok(!(await nodes()).some(node => node['content-desc'] === '选择电脑'));
  await screenshot(`android-light-direct-list-font-${scale}`);
  await tap('SSH password server'); await find('信任并连接');
  await screenshot(`android-light-direct-trust-font-${scale}`);
  await tap('信任并连接'); await find('远程文件浏览');
  await screenshot(`android-light-direct-terminal-font-${scale}`);
  await tap('远程文件浏览'); await find('hello.txt');
  await screenshot(`android-light-direct-files-font-${scale}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await find('SSH password server');
  await tap('返回发现'); await find('SSH'); await tap('SSH');
  await tap('终端'); await find('远程文件浏览');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('返回发现'); await tap('DARK'); await tap('SSH');
  await screenshot(`android-dark-direct-list-font-${scale}`);
  await tap('SSH key server'); await find('远程文件浏览');
  await screenshot(`android-dark-direct-key-terminal-font-${scale}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('新建'); await find('IP 或主机名');
  await screenshot(`android-dark-direct-create-font-${scale}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await tap('返回发现'); await find('SSH');
  console.log(`PASS Android direct SSH, trust, files, retained sessions, back, light/dark at font ${scale}`);
}

await mkdir(output, { recursive: true });
const originalScale = await adb('shell', 'settings', 'get', 'system', 'font_scale');
try {
  await prepareHierarchy({ adb, output });
  for (const scale of [1, 1.3]) await verify(scale);
} catch (error) { await screenshot('failure'); throw error; }
finally {
  await adb('shell', 'settings', 'put', 'system', 'font_scale', originalScale);
  await adb('shell', 'am', 'force-stop', app);
}
