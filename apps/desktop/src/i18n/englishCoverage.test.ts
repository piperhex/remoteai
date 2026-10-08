import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { english } from '../../../../shared/i18n/en';
import { translateText } from '../../../../shared/i18n/translate';

const chinese = /[\u4e00-\u9fff]/;
const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();

function literalCopy(node: ts.Node | undefined): string[] {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...literalCopy(node.whenTrue), ...literalCopy(node.whenFalse)];
  return [];
}

it('translates desktop interface copy in English without changing placeholders', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = readdirSync(root, { recursive: true }).map(String)
    .filter(file => /\.tsx?$/.test(file) && !/\.test\./.test(file));
  for (const file of files) {
    const ast = ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'guiText') {
        for (const source of literalCopy(node.arguments[0]).filter(text => chinese.test(text))) {
          expect(Object.hasOwn(english, source), `${file}: ${source}`).toBe(true);
          expect(english[source], source).not.toMatch(chinese);
          expect(placeholders(english[source]), source).toEqual(placeholders(source));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
});

it('translates onboarding while leaving quoted user content unchanged', () => {
  expect(translateText('en', '开始使用 Codex GUI')).toBe('Get started with Codex GUI');
  expect(translateText('en', '下载 Codex 后，就能在这里开始对话、处理代码和管理任务。'))
    .toBe('Download Codex to start conversations, work on code, and manage tasks here.');
  expect(translateText('en', '管理项目：{value1}', { value1: '我的项目 {value1}' }))
    .toBe('Manage project: 我的项目 {value1}');
});
