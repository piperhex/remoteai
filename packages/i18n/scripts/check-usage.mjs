import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import {
  keyArguments, mappedKeyViolations, nativeTranslationTables, presentationViolations, translationViolations,
} from './ownership.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const errors = [];
const han = /\p{Script=Han}/u;
const manifest = JSON.parse(fs.readFileSync(new URL('../platform.json', import.meta.url), 'utf8'));
const generated = new Set([...manifest.mirrors.map(entry => entry.target), manifest.chrome.module]);

function literalKeys(node) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node];
  if (ts.isParenthesizedExpression(node)) return literalKeys(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalKeys(node.whenTrue), ...literalKeys(node.whenFalse)];
  if (ts.isBinaryExpression(node)
    && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
    return [...literalKeys(node.left), ...literalKeys(node.right)];
  }
  return [];
}

function applicationCode(file) {
  let code = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file).replaceAll('\\', '/');
  for (const section of manifest.sections.filter(entry => entry.target === relative)) {
    code = code.replace(new RegExp(`// i18n:${section.name}:start[\\s\\S]*?// i18n:${section.name}:end`), '');
  }
  return code;
}

function checkFile(file) {
  const source = ts.createSourceFile(file, applicationCode(file), ts.ScriptTarget.Latest, true);
  const report = (node, message) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    errors.push(`${path.relative(root, file)}:${line}: ${message}`);
  };
  const visit = node => {
    if (ts.isStringLiteralLike(node) && /(?:shared\/i18n|@remoteai\/i18n\/legacy)/.test(node.text)) {
      report(node, 'Retired i18n import; use the package or the application locale adapter.');
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && Object.hasOwn(keyArguments, node.expression.text)) {
      for (const key of literalKeys(node.arguments[keyArguments[node.expression.text]])) {
        if (han.test(key.text)) report(key, 'Use a semantic message key.');
      }
      const fallback = node.arguments[1];
      if (node.expression.text === 't' && fallback && ts.isStringLiteralLike(fallback) && han.test(fallback.text)) {
        report(fallback, 'Keep fallback copy in the language package.');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const node of presentationViolations(source)) {
    report(node, 'Keep presentation copy and fragments in the language package.');
  }
  for (const node of mappedKeyViolations(source)) report(node, 'Use semantic keys for mapped presentation labels.');
  for (const node of translationViolations(source)) {
    report(node, 'Keep translation resources in packages/i18n; import them through a public package entry.');
  }
}

// Include build tooling and platform JS, plus new files awaiting their first commit.
const repositoryFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const candidates = [...new Set(repositoryFiles)].filter(file => /^(apps|shared|scripts)\//.test(file)
  && !/(?:^|\/)(?:vendor|fixtures|__tests__|e2e|gen)\/|\.(?:test|spec|pw|generated)\./.test(file)
  && !generated.has(file) && fs.existsSync(path.join(root, file)));
for (const file of candidates.filter(file => /\.strings$|\/(?:_locales|locales)\/.*\.json$/.test(file))) {
  errors.push(`${file}: Declare platform translation resources in packages/i18n/platform.json.`);
}
for (const file of candidates.filter(file => file.endsWith('.rs'))) {
  for (const table of nativeTranslationTables(applicationCode(path.join(root, file)))) {
    errors.push(`${file}: Keep native ${table} translations in generated package resources.`);
  }
}
const files = candidates.filter(file => /\.[cm]?[jt]sx?$/.test(file)).map(file => path.join(root, file));
files.forEach(checkFile);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`i18n: checked ${files.length} application and shared source files`);
}
