import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateNativeEntries } = require('./verify-apk.cjs') as {
  validateNativeEntries: (entries: string[]) => string;
};
const architectures = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];
const runtimeLibraries = [
  'csw_chat_connectivity', 'csw_ssh_mobile', 'appmodules', 'c++_shared', 'expo-modules-core', 'expo-sqlite', 'fbjni',
  'gesturehandler', 'hermes', 'reactnative', 'reanimated', 'worklets',
];
const completeApk = architectures.flatMap((abi) => runtimeLibraries.map((name) => `lib/${abi}/lib${name}.so`));

describe('release APK native libraries', () => {
  it('accepts complete libraries for phones and emulators', () => {
    expect(validateNativeEntries([...completeApk, 'classes.dex', 'assets/index.android.bundle']))
      .toContain('arm64-v8a: 12 libraries');
  });

  it('rejects the mixed APK where only the emulator has Expo, gestures and animations', () => {
    const emulatorOnly = /lib(expo-modules-core|gesturehandler|reanimated|worklets)\.so$/;
    const brokenApk = completeApk.filter((entry) => entry.includes('/x86_64/') || !emulatorOnly.test(entry));
    expect(() => validateNativeEntries(brokenApk)).toThrow('lib/arm64-v8a/libexpo-modules-core.so');
  });

  it('rejects an emulator-only APK even when its runtime is complete', () => {
    expect(() => validateNativeEntries(completeApk.filter((entry) => entry.includes('/x86_64/'))))
      .toThrow('lib/arm64-v8a/libreactnative.so');
  });

  it('rejects a runtime library omitted from every architecture', () => {
    expect(() => validateNativeEntries(completeApk.filter((entry) => !entry.endsWith('/libexpo-modules-core.so'))))
      .toThrow('lib/arm64-v8a/libexpo-modules-core.so');
  });

  it('checks additional dependency libraries for every architecture', () => {
    expect(() => validateNativeEntries([...completeApk, 'lib/x86_64/libadditional-module.so']))
      .toThrow('lib/arm64-v8a/libadditional-module.so');
  });

  const targetLibraries = architectures.map((abi, index) => (
    `lib/${abi}/libeasytier_core-${String(index).repeat(16)}.so`
  ));

  it('accepts different Rust library fingerprints for different CPU architectures', () => {
    expect(validateNativeEntries([...completeApk, ...targetLibraries]))
      .toContain('arm64-v8a: 13 libraries');
  });

  it('still rejects a missing architecture of a fingerprinted library', () => {
    expect(() => validateNativeEntries([...completeApk, ...targetLibraries.slice(1)]))
      .toThrow('lib/armeabi-v7a/libeasytier_core.so');
  });

  it('rejects stale duplicate builds within one architecture', () => {
    expect(() => validateNativeEntries([
      ...completeApk, ...targetLibraries, 'lib/arm64-v8a/libeasytier_core-ffffffffffffffff.so',
    ])).toThrow('Multiple EasyTier builds packaged for arm64-v8a');
  });

  it('requires the connectivity bridge in every architecture', () => {
    expect(() => validateNativeEntries(completeApk.filter((entry) => !entry.includes('csw_chat_connectivity'))))
      .toThrow('lib/arm64-v8a/libcsw_chat_connectivity.so');
  });

  it('rejects archives with no native libraries', () => {
    expect(() => validateNativeEntries(['classes.dex'])).toThrow('APK is missing native libraries');
  });
});
