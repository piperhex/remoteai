import { afterEach, expect, it, vi } from 'vitest';
import { defaultLanguage } from '../i18n';
import { deviceLanguage, systemLanguage } from '../../../../shared/i18n/language';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['zh', 'zh-CN', 'zh-TW', 'zh-Hant-HK', 'zh_CN.UTF-8', 'zh.UTF-8', ' ZH_cn@pinyin '])(
  'opens in Chinese for the Chinese locale %s', locale => {
    expect(systemLanguage(locale)).toBe('zh');
    expect(defaultLanguage(locale)).toBe('zh');
  },
);

it.each(['en-US', 'en_GB.UTF-8', 'fr-FR', 'de_DE.UTF-8', 'ja-JP', 'ru_RU', 'C', 'C.UTF-8', 'POSIX', '', 'zhuang'])(
  'opens in English for the non-Chinese or unknown locale %s', locale => {
    expect(systemLanguage(locale)).toBe('en');
    expect(defaultLanguage(locale)).toBe('en');
  },
);

it('uses the WebView language before the date-formatting locale', () => {
  vi.stubGlobal('navigator', { language: 'zh-TW' });
  expect(deviceLanguage()).toBe('zh');
  vi.stubGlobal('navigator', { language: 'fr-FR' });
  expect(deviceLanguage()).toBe('en');
});

it('honors the Linux message locale even when WebKit reports another language', () => {
  vi.stubGlobal('navigator', { language: 'en-US' });
  vi.stubGlobal('__REMOTE_AI_SYSTEM_LOCALE__', 'zh_CN.UTF-8');
  expect(deviceLanguage()).toBe('zh');
  vi.stubGlobal('__REMOTE_AI_SYSTEM_LOCALE__', 'C.UTF-8');
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  expect(deviceLanguage()).toBe('en');
});

it('uses Intl in native environments without a browser language', () => {
  vi.stubGlobal('navigator', undefined);
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    locale: 'zh-CN', calendar: 'gregory', numberingSystem: 'latn', timeZone: 'UTC',
  });
  expect(deviceLanguage()).toBe('zh');
});

it('keeps startup working in English when locale detection is unavailable', () => {
  vi.stubGlobal('navigator', undefined);
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
    throw new Error('locale unavailable');
  });
  expect(deviceLanguage()).toBe('en');
});
