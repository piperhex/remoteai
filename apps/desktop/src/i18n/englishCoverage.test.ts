import { resources as clientResources } from '@remoteai/i18n/client';
const english: Readonly<Record<string, string>> = clientResources.en;
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

import { translateMessage } from "../../../../shared/localization/messages";

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
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'uiText') {
        for (const source of literalCopy(node.arguments[0])) {
          expect(Object.hasOwn(english, source), `${file}: ${source}`).toBe(true);
          expect(english[source], source).not.toMatch(chinese);
          expect(placeholders(english[source]), source).toEqual(placeholders(clientResources.zh[source as keyof typeof clientResources.zh]));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
});

it('translates onboarding while leaving quoted user content unchanged', () => {
  expect(translateMessage('en', "client.conversation.getStartedWithCodexGui")).toBe('Get started with Agent Hub');
  expect(translateMessage('en', "client.conversation.downloadCodexToStartConversationsWorkOnCodeAndManage"))
    .toBe('Download Codex to start conversations, work on code, and manage tasks here.');
  expect(translateMessage('en', "client.conversation.manageProject", { value1: '我的项目 {value1}' }))
    .toBe('Manage project: 我的项目 {value1}');
});
