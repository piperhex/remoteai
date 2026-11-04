import { expect, it } from 'vitest';
import { resources as client } from '../src/catalogs/client';
import { resources as desktop } from '../src/catalogs/desktop';
import { resources as common } from '../src/catalogs/common';
import { resources as website } from '../src/catalogs/website';
import { createI18n, type Resources } from '../src';

it('ships complete Japanese resources without conversion artifacts or broken replacement prefixes', () => {
  const modules: Record<string, Resources> = { client, desktop, common, website };
  for (const [module, resources] of Object.entries(modules)) {
    expect(Object.keys(resources.ja ?? {}).sort()).toEqual(Object.keys(resources.en ?? {}).sort());
    for (const [key, source] of Object.entries(resources.en ?? {})) {
      const message = resources.ja?.[key];
      const text = typeof message === 'string' ? message : JSON.stringify(message);
      expect(text, `${module}/${key}`).not.toMatch(/<0x[\dA-F]+>|739\d{3}|(.{2,30})\1{5,}/);
      if (typeof source !== 'string') continue;
      const replacementPrefix = source.match(/^\$\d+/)?.[0];
      if (replacementPrefix) expect(text, key).toMatch(new RegExp(`^\\${replacementPrefix}`));
      for (const code of source.match(/`[^`]+`/g) ?? []) expect(text, key).toContain(code);
    }
  }
});

it('formats Japanese quantities and dates while preserving inserted user values', () => {
  const instance = createI18n({ locale: 'ja', resources: common });
  expect(instance.t('common.greeting', { name: '$&{name}' })).toBe('こんにちは、$&{name}さん');
  for (const count of [0, 1, 2, 100]) {
    expect(instance.t('common.items.count', { count })).toBe(`${count} 件`);
  }
  expect(instance.formatNumber(123456.78)).toBe(new Intl.NumberFormat('ja-JP').format(123456.78));
  expect(instance.formatDate('2026-01-02', { timeZone: 'UTC' })).toBe('2026/1/2');
});

it('uses action labels for Japanese copy controls', () => {
  const instance = createI18n({ locale: 'ja', resources: client });
  expect(instance.t('client.projectBrowser.copied')).toBe('コピー');
});
