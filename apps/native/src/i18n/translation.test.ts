import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';
import { english } from '../../../../shared/i18n/en';
import { russian } from '../../../../shared/i18n/ru';
import { interpolate, translateText } from '../../../../shared/i18n/translate';
import { getInterfaceLanguage, setInterfaceLanguage, subscribeInterfaceLanguage } from
  '../../../../shared/i18n/interfaceLanguage';
import { systemLanguage } from '../../../../shared/i18n/language';
import { composerPatch, composerLabel } from '../../../../shared/remote-chat/composer';
import { settingOptions } from '../../../../shared/remote-chat/settingsMenu';

const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
const dictionaries: Readonly<Record<string, string>>[] = [english, russian];
afterEach(() => setInterfaceLanguage('zh'));

it('covers all explicitly translated native copy in English and Russian', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = readdirSync(root, { recursive: true }).map(String)
    .filter(file => /\.tsx?$/.test(file) && !/\.test\.|\.generated\./.test(file)).map(file => join(root, file));
  files.push(join(root, '../App.tsx'));
  for (const file of files) {
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 't') {
        const source = node.arguments[0];
        if (source && ts.isStringLiteralLike(source)) {
          for (const dictionary of dictionaries) {
            expect(Object.hasOwn(dictionary, source.text), `${file}: ${source.text}`).toBe(true);
            expect(placeholders(dictionary[source.text]), source.text).toEqual(placeholders(source.text));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
});

it('preserves untrusted values and ignores inherited dictionary properties', () => {
  for (const language of ['zh', 'en', 'ru'] as const) {
    for (const text of ['toString', '__proto__', 'constructor', 'my_file.ts', '用户写的内容']) {
      expect(translateText(language, text)).toBe(text);
    }
    expect(translateText(language, '使用失败：{value1}', { value1: '$& {value1} <script>测试</script>' }))
      .toContain('$& {value1} <script>测试</script>');
  }
  expect(interpolate('{first} / {second}', { first: '{second}', second: 'replacement' }))
    .toBe('{second} / replacement');
});

it('switches display language without changing model, permissions or request values', () => {
  const selection = { model: '取消', effort: 'high', access: 'workspace-write', speed: 'fast' } as const;
  const model = { id: 'test', model: selection.model, displayName: '取消', supportedReasoningEfforts: [],
    isDefault: true, defaultReasoningEffort: 'high' };
  for (const language of ['zh', 'en', 'ru'] as const) {
    setInterfaceLanguage(language);
    expect(composerPatch(selection)).toEqual(selection);
    expect(settingOptions('model', [model], selection)[0]).toEqual({ value: '取消', label: '取消' });
    expect(composerLabel([model], selection, source => translateText(language, source))).toMatch(/^取消 · /);
  }
});

it('notifies mounted consumers only when language changes and supports unsubscribe', () => {
  setInterfaceLanguage('zh');
  const changes: string[] = [];
  const unsubscribe = subscribeInterfaceLanguage(() => changes.push(getInterfaceLanguage()));
  setInterfaceLanguage('ru'); setInterfaceLanguage('ru'); setInterfaceLanguage('en');
  unsubscribe(); setInterfaceLanguage('zh');
  expect(changes).toEqual(['ru', 'en']);
  expect(['zh-CN', 'en-US', 'ru_RU', 'fr-FR'].map(systemLanguage)).toEqual(['zh', 'en', 'en', 'en']);
});
