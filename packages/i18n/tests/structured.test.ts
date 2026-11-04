import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import en from '../src/copy/admin/en';
import zh from '../src/copy/admin/zh';
import ru from '../src/copy/admin/ru';
import help from '../src/copy/desktop/help';
import { threadCopy } from '../src/copy/desktop/threads';
import { getUserAgreement, agreementCopy } from '../src/legal/agreement';
import { applications } from '../src/registry';
import baselines from './structured-baselines.json';

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => [key, sorted(item)]));
  }
  return value;
}

it('preserves the original structured translations in all shipped languages', () => {
  const resources = { adminEn: en, adminZh: zh, adminRu: ru, help, threads: threadCopy, agreementCopy };
  for (const [name, value] of Object.entries(resources)) {
    const hash = createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
    expect(hash, name).toBe(baselines[name as keyof typeof baselines]);
  }
});

it('keeps complete client tables and legal documents available offline in every enabled language', () => {
  for (const language of applications.native) {
    for (const resources of [help, threadCopy, agreementCopy]) {
      expect(Object.keys(resources[language]).sort()).toEqual(Object.keys(resources.en).sort());
    }
    const agreement = getUserAgreement(language);
    expect(agreement.title).toBeTruthy();
    expect(agreement.sections.length).toBe(getUserAgreement('en').sections.length);
  }
});

it('retains the admin partial Russian release without adding Japanese', () => {
  expect(applications.admin).toEqual(['zh', 'en', 'ru']);
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  expect(Object.keys(ru).length).toBeLessThan(Object.keys(en).length);
  for (const key of Object.keys(ru)) expect(key in en, key).toBe(true);
});
