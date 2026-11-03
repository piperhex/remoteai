import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/custom-groups');
const serial = process.env.ANDROID_SERIAL;
assert.ok(serial, 'Set ANDROID_SERIAL to a physical device');
const app = 'com.codexswitch.mobile.customgroupstest';
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args], {
  encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
})).stdout.trim();

async function nodes() {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/custom-groups.xml');
  const xml = await adb('shell', 'cat', '/sdcard/custom-groups.xml');
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])));
}
const matches = (node, label) => node['content-desc'] === label || node.text === label;
async function find(label, scroll = false) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const found = (await nodes()).filter(value => matches(value, label));
    const node = found.find(value => value.class === 'android.widget.EditText') ?? found[0];
    if (node) return node;
    if (scroll) await adb('shell', 'input', 'swipe', '540', '1850', '540', '900', '300');
    await delay(400);
  }
  assert.fail(`Missing native label: ${label}`);
}
const center = node => {
  const [left, top, right, bottom] = [...node.bounds.matchAll(/\d+/g)].map(value => Number(value[0]));
  return [Math.round((left + right) / 2), Math.round((top + bottom) / 2)].map(String);
};
async function tap(label, scroll = false) { await adb('shell', 'input', 'tap', ...center(await find(label, scroll))); }
async function hold(label) {
  const point = center(await find(label));
  await adb('shell', 'input', 'swipe', ...point, ...point, '800');
}
async function screenshot(name) {
  await delay(500);
  await adb('shell', 'screencap', '-p', '/sdcard/custom-groups.png');
  await adb('pull', '/sdcard/custom-groups.png', path.join(output, `${name}.png`));
}
async function dismissKeyboard() {
  const keyboard = await adb('shell', 'dumpsys', 'input_method');
  if (/mInputShown=true|isInputViewShown=true/.test(keyboard)) await adb('shell', 'input', 'keyevent', '4');
}

async function verifyRemoval(scale) {
  await hold('项目里的对话');
  await tap('移动到分组');
  await find('取消分组');
  assert.ok(!(await nodes()).some(node => matches(node, '未分组')));
  await screenshot(`android-cancel-picker-${scale}`);
  await tap('取消分组');
  await tap('折叠项目：项目文件夹中文显示测试');
  assert.ok(!(await nodes()).some(node => matches(node, '项目里的对话')));
  await tap('展开项目：项目文件夹中文显示测试');
  await find('项目里的对话');
  await hold('无项目对话');
  await tap('移动到分组');
  await tap('研究');
  await tap('折叠分组：研究');
  assert.ok(!(await nodes()).some(node => matches(node, '无项目对话')));
  await tap('展开分组：研究');
  await hold('无项目对话');
  await tap('移动到分组');
  await tap('取消分组');
  await tap('折叠分组：工作');
  await tap('折叠分组：研究');
  await tap('折叠项目：其他项目');
  await find('无项目对话');
  await screenshot(`android-projectless-restored-${scale}`);
  await tap('展开分组：工作');
  await tap('展开分组：研究');
  await tap('展开项目：其他项目');
  await screenshot(`android-project-restored-${scale}`);
}

async function verify(scale) {
  await hold('折叠项目：项目文件夹中文显示测试');
  await find('移动到分组');
  await screenshot(`android-menu-${scale}`);
  await tap('移动到分组');
  await find('管理分组');
  await screenshot(`android-picker-${scale}`);
  await tap('工作 / 客户端');
  await tap('折叠分组：工作');
  assert.ok(!(await nodes()).some(node => matches(node, '项目里的对话')));
  await tap('展开分组：工作');
  await hold('项目里的对话');
  await tap('移动到分组');
  await tap('研究');
  await find('项目里的对话');
  await screenshot(`android-tree-${scale}`);
  await verifyRemoval(scale);
  await hold('折叠分组：工作');
  await find('管理分组');
  await tap('新增分组');
  await tap('分组名称');
  await adb('shell', 'input', 'text', 'Plan');
  await dismissKeyboard();
  await screenshot(`android-editor-${scale}`);
  await tap('保存');
  await find('Plan', true);
  await screenshot(`android-groups-${scale}`);
  await tap('Plan 的更多操作', true);
  await find('编辑分组');
  await find('删除分组');
  await screenshot(`android-group-menu-${scale}`);
  await tap('编辑分组');
  await find('分组名称');
  await dismissKeyboard();
  await tap('取消');
  await tap('Plan 的更多操作', true);
  await tap('删除分组');
  await find('删除“Plan”？');
  await tap('取消');
  await tap('项目与对话');
  await tap('选择 项目里的对话', true);
  await tap('选择 其他项目的对话', true);
  await adb('shell', 'input', 'swipe', '540', '750', '540', '1900', '350');
  await adb('shell', 'input', 'swipe', '540', '750', '540', '1900', '350');
  await tap('移动到分组');
  await tap('Plan');
  await tap('搜索项目或对话');
  await adb('shell', 'input', 'text', 'project');
  await adb('shell', 'input', 'keyevent', '4');
  await find('选择 项目里的对话', true);
  await screenshot(`android-members-${scale}`);
  await adb('shell', 'input', 'keyevent', '4');
  await find('折叠分组：Plan');
  await tap('折叠分组：Plan');
  assert.ok(!(await nodes()).some(node => matches(node, '项目里的对话')));
  await verifyBatchRemoval(scale);
  console.log(`PASS native groups, batch membership and navigation at font scale ${scale}`);
}

async function verifyBatchRemoval(scale) {
  await tap('管理分组');
  await tap('项目与对话');
  await tap('选择 项目里的对话', true);
  await tap('选择 其他项目的对话', true);
  await adb('shell', 'input', 'swipe', '540', '750', '540', '1900', '350');
  await tap('移动到分组');
  await tap('取消分组');
  await adb('shell', 'input', 'keyevent', '4');
  await find('项目里的对话');
  await find('其他项目的对话', true);
  await screenshot(`android-batch-restored-${scale}`);
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
