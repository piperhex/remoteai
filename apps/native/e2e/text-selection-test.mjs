import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/text-selection');
const sdk = process.env.ANDROID_HOME;
const serial = process.env.ANDROID_SERIAL ?? 'emulator-5580';
const applicationId = 'com.codexswitch.mobile.selectiontest';
const adb = async (...args) => (await exec('adb', ['-s', serial, ...args], { timeout: 60_000 })).stdout;
const java = name => path.join(process.env.JAVA_HOME, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
assert.ok(sdk && process.env.JAVA_HOME, 'ANDROID_HOME and JAVA_HOME are required');
await mkdir(output, { recursive: true });
const libraries = ['android.jar', 'uiautomator.jar', 'optional/android.test.base.jar']
  .map(name => path.join(sdk, 'platforms/android-35', name));
await exec(java('javac'), ['--release', '8', '-encoding', 'UTF-8', '-cp', libraries.join(path.delimiter),
  '-d', output, fileURLToPath(new URL('./TextSelectionGestureTest.java', import.meta.url))]);
const jar = path.join(output, 'text-selection-tests.jar');
await exec(java('java'), ['-cp', path.join(sdk, 'build-tools/35.0.0/lib/d8.jar'), 'com.android.tools.r8.D8',
  ...libraries.flatMap(library => ['--lib', library]), '--output', jar,
  path.join(output, 'dev/codexswitch/testing/TextSelectionGestureTest.class')]);
const apk = path.join(root, 'apps/native/android/app/build/outputs/apk/release/text-selection-fixture.apk');
await adb('install', '-r', apk);
await adb('push', jar, '/data/local/tmp/text-selection-tests.jar');
await adb('shell', 'am', 'force-stop', applicationId);
await adb('shell', 'am', 'start', '-W', '-n', `${applicationId}/com.codexswitch.mobile.MainActivity`);
const result = await adb('shell', 'uiautomator', 'runtest', '/system/framework/android.test.base.jar',
  '/data/local/tmp/text-selection-tests.jar', '-c', 'dev.codexswitch.testing.TextSelectionGestureTest');
await writeFile(path.join(output, 'native-results.txt'), result);
await adb('shell', 'screencap', '-p', '/data/local/tmp/text-selection.png');
await adb('pull', '/data/local/tmp/text-selection.png', path.join(output, 'native-result.png'));
console.log(result);
assert.ok(result.includes('OK (1 test)'), 'Native text-selection gestures failed');
