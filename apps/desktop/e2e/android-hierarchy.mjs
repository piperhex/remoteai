import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);

export async function prepareHierarchy({ adb, output }) {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK directory.');
  const platform = path.join(sdk, 'platforms', 'android-35');
  const build = path.join(output, 'hierarchy');
  await mkdir(build, { recursive: true });
  const binaries = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin') : '';
  const executable = (name) =>
    binaries ? path.join(binaries, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;
  const libraries = ['android.jar', 'uiautomator.jar', 'optional/android.test.base.jar']
    .map((name) => path.join(platform, name));
  const source = fileURLToPath(new URL('./android/HierarchyDump.java', import.meta.url));
  const gestures = fileURLToPath(new URL('./android/ImageGestureTest.java', import.meta.url));
  const quotes = fileURLToPath(new URL('./android/QuoteMenuTest.java', import.meta.url));
  const desktop = fileURLToPath(new URL('./android/RemoteDesktopGestureTest.java', import.meta.url));
  await exec(executable('javac'), ['--release', '8', '-encoding', 'UTF-8',
    '-cp', libraries.join(path.delimiter), '-d', build, source, gestures, quotes, desktop]);
  const compiler = path.join(sdk, 'build-tools', '35.0.0', 'lib', 'd8.jar');
  const outputJar = path.join(build, 'hierarchy.jar');
  const args = ['-cp', compiler, 'com.android.tools.r8.D8'];
  for (const library of libraries) args.push('--lib', library);
  args.push('--output', outputJar, path.join(build, 'dev/codexswitch/testing/HierarchyDump.class'),
    path.join(build, 'dev/codexswitch/testing/ImageGestureTest.class'),
    path.join(build, 'dev/codexswitch/testing/QuoteMenuTest.class'),
    path.join(build, 'dev/codexswitch/testing/RemoteDesktopGestureTest.class'));
  await exec(executable('java'), args);
  await adb('push', outputJar, '/data/local/tmp/chat-hierarchy.jar');
}

export async function hierarchy(adb) {
  const result = await adb('shell', 'uiautomator', 'runtest', '/system/framework/android.test.base.jar',
    '/data/local/tmp/chat-hierarchy.jar', '-c', 'dev.codexswitch.testing.HierarchyDump');
  if (!result.includes('OK (1 test)') || result.includes('shortMsg=')) {
    throw new Error(`Hierarchy read failed: ${result}`);
  }
  const xml = await adb('exec-out', 'cat', '/data/local/tmp/chat-live.xml');
  if (!xml.includes('<hierarchy')) throw new Error('Hierarchy read did not return XML.');
  return xml;
}
