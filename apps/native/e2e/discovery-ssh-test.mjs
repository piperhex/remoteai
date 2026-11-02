import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { hierarchy, prepareHierarchy } from '../../desktop/e2e/android-hierarchy.mjs';

const exec = promisify(execFile);
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to a physical Android device');
const app = 'com.codexswitch.mobile.discoverysshtest';
const output = fileURLToPath(new URL('../../../.codex-tmp/discovery-ssh-android/', import.meta.url));
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
  for (let attempt = 0; attempt < 10; attempt++) {
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
  await find('SSH');
  await screenshot(`android-light-discover-${scale}`);
  await tap('SSH'); await find('Saved on Discovery'); await find('Key server');
  await screenshot(`android-light-ssh-list-${scale}`);
  await tap('Saved on Discovery'); await find('远程终端'); await find('切换横屏');
  await screenshot(`android-light-ssh-terminal-${scale}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await find('Saved on Discovery');
  await tap('Password server'); await find('密码');
  await screenshot(`android-light-ssh-login-${scale}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await find('Saved on Discovery');
  await tap('DARK');
  await screenshot(`android-dark-ssh-list-${scale}`);
  await tap('EMPTY'); await find('还没有保存的连接');
  await screenshot(`android-dark-ssh-empty-${scale}`);
  await tap('ERROR'); await find('无法读取已保存的 SSH 连接，请检查网络后刷新。');
  await screenshot(`android-dark-ssh-error-${scale}`);
  await tap('SAVED'); await find('Saved on Discovery');
  await tap('OFFLINE'); await tap('Saved on Discovery'); await find('选择一台在线电脑以打开 SSH 终端。');
  await screenshot(`android-dark-ssh-offline-${scale}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('返回发现'); await find('SSH');
  console.log(`PASS Android discovery, saved terminal, login, empty, error, offline, back at scale ${scale}`);
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
