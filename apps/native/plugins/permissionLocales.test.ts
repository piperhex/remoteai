import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const { expo } = readJson('app.json') as {
  expo: { locales: Record<string, string>; plugins: (string | [string, Record<string, unknown>])[] };
};
const { LOCAL_NETWORK_USAGE, MICROPHONE_USAGE } = require('./withChatTransport.cjs') as {
  LOCAL_NETWORK_USAGE: string; MICROPHONE_USAGE: string;
};

// withChatTransport supplies the microphone prompt from the generated locale resource.
const OPTION_KEYS: Record<string, string> = {
  cameraPermission: 'NSCameraUsageDescription',
  photosPermission: 'NSPhotoLibraryUsageDescription',
  savePhotosPermission: 'NSPhotoLibraryAddUsageDescription',
  motionPermission: 'NSMotionUsageDescription',
};

function baseUsageDescriptions() {
  const base: Record<string, string> = {
    NSLocalNetworkUsageDescription: LOCAL_NETWORK_USAGE, NSMicrophoneUsageDescription: MICROPHONE_USAGE,
  };
  for (const plugin of expo.plugins) {
    if (!Array.isArray(plugin)) continue;
    for (const [option, value] of Object.entries(plugin[1])) {
      const key = OPTION_KEYS[option];
      if (!key || typeof value !== 'string') continue;
      // Several plugins write the same key; whichever runs last must not change the prompt.
      expect(base[key] ?? value, `${plugin[0]}.${option}`).toBe(value);
      base[key] = value;
    }
  }
  return base;
}

it('localizes every iOS permission prompt for English, Russian, Chinese and Japanese', () => {
  const base = baseUsageDescriptions();
  expect(Object.keys(expo.locales).sort()).toEqual(['en', 'ja', 'ru', 'zh-Hans', 'zh-Hant']);
  for (const [language, path] of Object.entries(expo.locales)) {
    const locale = readJson(path) as { ios?: Record<string, string> };
    // Platform-neutral keys would also be written to Android string resources.
    expect(Object.keys(locale), language).toEqual(['ios']);
    const strings = locale.ios ?? {};
    expect(Object.keys(strings).sort(), language).toEqual(Object.keys(base).sort());
    for (const [key, value] of Object.entries(strings)) {
      // Expo writes InfoPlist.strings without escaping.
      expect(value, `${language} ${key}`).not.toMatch(/["\\\n]/);
      if (language.startsWith('zh')) expect(value, key).toBe(base[key]);
      else if (language === 'ja') expect(value, `${language} ${key}`).toMatch(/[\u3040-\u30ff]/);
      else expect(value, `${language} ${key}`).not.toMatch(/[㐀-鿿]/);
    }
  }
});
