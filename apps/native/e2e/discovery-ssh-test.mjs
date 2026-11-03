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
const output = fileURLToPath(new URL('../../../.codex-tmp/discovery-ssh-editor-android/', import.meta.url));
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
async function input(label, value) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await nodes();
    const field = current.find(node => node.class === 'android.widget.EditText' && node['content-desc'] === label
      && node.bounds !== '[0,0][0,0]');
    if (field) {
      const [left, top, right, bottom] = [...field.bounds.matchAll(/\d+/g)].map(item => Number(item[0]));
      await adb('shell', 'input', 'tap', String((left + right) >> 1), String((top + bottom) >> 1));
      await delay(500);
      await adb('shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A');
      // Debug Android builds interpret two rapidly injected R keys as Reload.
      for (const character of value) {
        await adb('shell', 'input', 'text', character); await delay(300);
      }
      await delay(500);
      const entered = (await nodes()).find(node => node.class === 'android.widget.EditText'
        && node['content-desc'] === label);
      assert.equal(entered?.text, value, `Entered ${label}`);
      if ((await adb('shell', 'dumpsys', 'input_method')).includes('mInputShown=true')) {
        await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await delay(400);
      }
      return;
    }
    const view = current.filter(node => node.scrollable === 'true').at(-1);
    assert.ok(view, `Scrollable form for ${label}`);
    const [left, top, right, bottom] = [...view.bounds.matchAll(/\d+/g)].map(item => Number(item[0]));
    await adb('shell', 'input', 'swipe', String((left + right) >> 1), String(bottom - 30),
      String((left + right) >> 1), String(top + 30), '300');
  }
  throw new Error(`Missing input ${label}`);
}
async function verifyEditor(scale) {
  await tap('新建'); await find('连接名称（可选）');
  await screenshot(`android-light-ssh-create-${scale}`);
  await input('连接名称（可选）', 'New-server');
  await input('IP 或主机名', 'new.test'); await input('用户名', 'dev');
  await tap('保存');
  await find('连接配置未能保存到账号，请重试。');
  await screenshot(`android-light-ssh-save-error-${scale}`);
  await tap('保存'); await find('编辑 New-server');
  await tap('编辑 New-server'); await find('编辑 SSH 连接');
  await input('连接名称（可选）', 'Cancelled');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await find('编辑 New-server');
  await tap('编辑 Saved on Discovery'); await find('编辑 SSH 连接');
  await input('连接名称（可选）', 'Saved-edited');
  await screenshot(`android-light-ssh-edit-${scale}`);
  await tap('保存'); await find('编辑 Saved-edited');
  await tap('DARK'); await tap('编辑 Key server'); await find('编辑 SSH 连接');
  await input('连接名称（可选）', 'Key-edited');
  await screenshot(`android-dark-ssh-edit-key-${scale}`);
  await tap('保存'); await find('编辑 Key-edited');
  await screenshot(`android-dark-ssh-updated-list-${scale}`);
  await tap('Key-edited'); await find('远程文件浏览');
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await tap('LIGHT');
  console.log(`PASS Android add, retry, cancel, edit and preserved private key at scale ${scale}`);
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
  await verifyEditor(scale);
  await tap('Saved-edited'); await find('远程终端'); await find('切换横屏');
  await screenshot(`android-light-ssh-terminal-${scale}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await find('Saved-edited');
  await tap('Password server'); await find('密码');
  await screenshot(`android-light-ssh-login-${scale}`);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await find('Saved-edited');
  await tap('DARK');
  await screenshot(`android-dark-ssh-list-${scale}`);
  await tap('EMPTY'); await find('还没有保存的连接');
  await screenshot(`android-dark-ssh-empty-${scale}`);
  await tap('ERROR'); await find('无法读取已保存的 SSH 连接，请检查网络后刷新。');
  await screenshot(`android-dark-ssh-error-${scale}`);
  await tap('SAVED'); await find('Saved-edited');
  await find('新建');
  assert.ok(!(await nodes()).some(node => node['content-desc'] === '选择电脑'));
  await tap('Saved-edited'); await find('远程终端');
  await screenshot(`android-dark-ssh-direct-${scale}`);
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
