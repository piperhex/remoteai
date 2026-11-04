import { describe, expect, it, vi } from 'vitest';
import { applications, createI18n, fallbackChain, isAppLanguage, languageOptions, resolveLanguage } from '../src';
import { resources } from '../src/catalogs/common';
import { resources as desktop } from '../src/catalogs/desktop';
import { loadResource } from '../src/catalogs/loader';

describe('language registration and release policies', () => {
  it('registers Japanese and enables it in prepared applications', () => {
    expect(resolveLanguage(' JA_jp.UTF-8 ')).toBe('ja');
    expect(resolveLanguage('zh-Hant-HK')).toBe('zh');
    expect(resolveLanguage('zhuang')).toBeUndefined();
    for (const app of Object.keys(applications) as (keyof typeof applications)[]) {
      expect(isAppLanguage(app, 'ja')).toBe(app !== 'admin');
      expect(languageOptions(applications[app]).map(option => option.value)).toEqual(applications[app]);
    }
  });

  it('accepts only enabled language IDs and leaves state unchanged on rejection', () => {
    const instance = createI18n({ locale: 'en', enabledLanguages: ['en'] });
    expect(() => instance.setLocale('ja')).toThrow('not enabled');
    expect(instance.getLocale()).toBe('en');
    expect(() => createI18n({ locale: 'ja', enabledLanguages: ['en'] })).toThrow();
  });
});

describe('translations', () => {
  it('isolates instances and does not mutate caller resources or business data', () => {
    const draft = { ...resources.en };
    const first = createI18n({ locale: 'en', enabledLanguages: ['en', 'zh'], resources: { en: draft, zh: resources.zh } });
    const second = createI18n({ locale: 'ru', resources });
    const business = Object.freeze({ status: 'active', message: '复制', user: '{name}' });
    first.setLocale('zh');
    first.addResources('en', { 'common.actions.copy': 'Duplicate' });
    expect(first.t('common.actions.copy')).toBe('复制');
    expect(second.t('common.actions.copy')).toBe('Копировать');
    expect(draft['common.actions.copy']).toBe('Copy');
    expect(business).toEqual({ status: 'active', message: '复制', user: '{name}' });
  });

  it('uses Japanese resources and falls back for incomplete drafts', () => {
    const instance = createI18n({ locale: 'ja', resources: {
      en: resources.en, ja: { 'common.actions.copy': 'コピー' },
    } });
    expect(instance.t('common.actions.copy')).toBe('コピー');
    expect(instance.t('common.greeting', { name: '$&{name}' })).toBe('Hello, $&{name}');
    expect(instance.text('missing.{id}', { id: 5 })).toBe('missing.5');
    expect(fallbackChain('ja', 'zh')).toEqual(['ja', 'en', 'zh']);
  });

  it('keeps contextual semantic keys separate', () => {
    const instance = createI18n({ locale: 'en', resources: { en: { ...resources.en, ...desktop.en } } });
    expect(instance.t('common.actions.apply')).toBe('Apply');
    expect(instance.t('downloads.title')).toBe('Downloads');
  });

  it.each([
    ['en', 1, '1 item'], ['en', 2, '2 items'], ['ru', 1, '1 элемент'],
    ['ru', 2, '2 элемента'], ['ru', 5, '5 элементов'], ['ru', 21, '21 элемент'], ['ja', 2, '2 件'],
  ] as const)('uses plural rules for %s with count %s', (locale, count, expected) => {
    expect(createI18n({ locale, resources }).t('common.items.count', { count })).toBe(expected);
  });

  it('uses the fallback message language for plurals and supports exact counts', () => {
    const instance = createI18n({ locale: 'ja', resources: { en: resources.en } });
    expect(instance.t('common.items.count', { count: 1 })).toBe('1 item');
    instance.addResources('en', { 'common.items.count': { '=0': 'Empty', other: '{count} items' } });
    expect(instance.t('common.items.count', { count: 0 })).toBe('Empty');
    expect(() => instance.text('common.items.count', { count: '1' })).toThrow(TypeError);
    for (const key of ['__proto__', 'constructor', 'toString']) expect(instance.text(key)).toBe(key);
  });

  it('formats numbers and dates without browser APIs', () => {
    const instance = createI18n({ locale: 'ru' });
    expect(instance.formatNumber(1234.5)).toBe(new Intl.NumberFormat('ru-RU').format(1234.5));
    expect(instance.formatDate('2026-01-02', { timeZone: 'UTC' })).toBe('02.01.2026');
    expect(instance.formatDate('invalid')).toBe('invalid');
  });
});

describe('resource loading', () => {
  it('loads released Japanese resources across independent modules', async () => {
    const instance = createI18n({ locale: 'ja', loadResource });
    await instance.load('ja', ['common', 'desktop']);
    expect(instance.t('common.actions.copy')).toBe('コピー');
    expect(instance.t('downloads.title')).toBe('ダウンロード');
  });

  it('loads just requested modules and their fallback language', async () => {
    const loader = vi.fn(loadResource);
    const instance = createI18n({ locale: 'ja', loadResource: loader });
    await Promise.all([instance.load('ja', ['common']), instance.load('ja', ['common'])]);
    expect(loader.mock.calls).toEqual([['ja', 'common'], ['en', 'common']]);
    expect(instance.t('common.actions.copy')).toBe('コピー');
    expect(instance.t('common.actions.cancel')).toBe('キャンセル');
    expect(instance.text('downloads.title')).toBe('downloads.title');
  });

  it('retries failed loads and a late load never resets the selected language', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(resources.en);
    const instance = createI18n({ locale: 'en', enabledLanguages: ['en', 'zh'], loadResource: loader });
    await expect(instance.load('en', ['common'])).rejects.toThrow('offline');
    const pending = instance.load('en', ['common']);
    instance.setLocale('zh');
    await pending;
    expect(instance.getLocale()).toBe('zh');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers on locale or resource updates and supports cleanup', () => {
    const instance = createI18n({ locale: 'en', enabledLanguages: ['en', 'zh'] });
    const listener = vi.fn();
    const unsubscribe = instance.subscribe(listener);
    instance.setLocale('zh');
    instance.setLocale('zh');
    instance.addResources('zh', resources.zh);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    instance.setLocale('en');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
