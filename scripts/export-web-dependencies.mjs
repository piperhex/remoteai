import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSourceBoundaries } from '../shared/scripts/source-boundaries.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(process.argv[2] ?? path.join(root, 'apps/web'));
const vendor = path.join(destination, 'vendor');
const boundaries = inspectSourceBoundaries({ shared: path.join(root, 'shared'), applications: [destination] });
if (boundaries.violations.length) throw new Error(JSON.stringify(boundaries.violations, null, 2));
const sourcePattern = /\.(?:[cm]?[jt]sx?|css|less|html)$/;
const textPattern = /\.(?:[cm]?[jt]sx?|css|less|html|json|md|svg|txt|sig)$/;
const slash = value => value.replaceAll('\\', '/');
const hash = contents => createHash('sha256').update(contents).digest('hex');
const pending = new Set([
  'scripts/test-browser.mjs', 'scripts/test-browser.d.mts', 'scripts/i18n-fixture.mjs',
  'apps/desktop/vite.config.ts', 'apps/desktop/e2e/chat-harness.html',
  'apps/desktop/e2e/chat-harness.ts', 'apps/desktop/e2e/mobile-fixture.mjs',
  'apps/desktop/src-tauri/icons/32x32.png', 'apps/desktop/src-tauri/icons/128x128.png',
  'apps/desktop/src-tauri/tauri.conf.json', 'shared/localization/testLocale.ts',
]);
const files = {};
const manifestPath = path.join(vendor, 'source-lock.json');
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files : {};

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['.git', '.workspace', '.codex-tmp', 'node_modules', 'vendor', 'dist'].includes(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  });
}

function resolveSource(filename) {
  const plain = filename.split('?')[0];
  return ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.d.ts', '/index.ts', '/index.tsx', '/index.js']
    .map(suffix => plain + suffix).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function collect(filename) {
  const source = resolveSource(filename);
  if (!source) return;
  const relative = slash(path.relative(root, source));
  // Web is the host, and translations are supplied by the installed public package.
  if (/^(shared|apps\/(desktop|native)|scripts)\//.test(relative)) pending.add(relative);
}

function references(content, directory) {
  for (const match of content.matchAll(/(['"])(\.{1,2}\/[^'"\r\n]+)\1/g)) {
    collect(path.resolve(directory, match[2].split('?')[0]));
  }
  for (const match of content.matchAll(/url\(\s*['"]?(\.{1,2}\/[^)'"\s]+)['"]?\s*\)/g)) {
    collect(path.resolve(directory, match[1]));
  }
  for (const match of content.matchAll(/\/e2e\/([\w-]+\.(?:html|tsx?|jsx?))/g)) {
    collect(path.join(root, 'apps/desktop/e2e', match[1]));
  }
}

for (const filename of walk(destination).filter(filename => sourcePattern.test(filename))) {
  const original = path.join(root, 'apps/web', path.relative(destination, filename));
  references(fs.readFileSync(filename, 'utf8'), path.dirname(original));
}

fs.mkdirSync(vendor, { recursive: true });
for (const relative of pending) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing Web integration dependency: ${relative}`);
  let contents = fs.readFileSync(source);
  if (textPattern.test(relative)) contents = Buffer.from(contents.toString('utf8').replaceAll('\r\n', '\n'));
  // Trim extra code-only EOF lines without trimming signed payloads or other assets.
  if (/\.(?:[cm]?[jt]sx?|css|less)$/.test(relative)) {
    contents = Buffer.from(contents.toString('utf8').replace(/\n+$/, '\n'));
  }
  files[relative] = hash(contents);
  const target = path.join(vendor, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  if (sourcePattern.test(relative)) references(contents.toString('utf8'), path.dirname(source));
  if (relative.endsWith('.js')) collect(source.replace(/\.js$/, '.d.ts'));
}

const git = cwd => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
const metadata = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
const i18n = metadata.dependencies['@remoteai/i18n'];
if (!i18n.startsWith('https://github.com/piperhex/remoteai-i18n/releases/download/')) {
  throw new Error('Web must pin a published @remoteai/i18n release before exporting dependencies.');
}
const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').replaceAll('\r\n', '\n').replace(/\n+$/, '\n');
fs.writeFileSync(path.join(vendor, 'LICENSE'), license);
files.LICENSE = hash(license);
fs.writeFileSync(manifestPath, JSON.stringify({
  repository: 'https://github.com/piperhex/remoteai.git', revision: git(root),
  sharedSource: { repository: 'https://github.com/piperhex/remoteai-shared.git', revision: git(path.join(root, 'shared')) },
  ...(fs.existsSync(path.join(root, 'apps/native/.git')) ? {
    nativeSource: { repository: 'https://github.com/piperhex/remoteai-native.git',
      revision: git(path.join(root, 'apps/native')) },
  } : {}),
  i18n, files,
}, null, 2) + '\n');
for (const relative of Object.keys(previous)) {
  const target = path.resolve(vendor, relative);
  if (!Object.hasOwn(files, relative) && target.startsWith(vendor + path.sep)) fs.rmSync(target, { force: true });
}
console.log(`Exported ${Object.keys(files).length} Web integration dependencies to ${vendor}`);
