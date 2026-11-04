import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(process.argv[2] ?? path.join(root, 'apps/native'));
const vendor = path.join(destination, 'vendor');
const files = {};
const pending = new Set([
  'shared/localization/testLocale.ts', 'shared/project-browser/nativeEntry.tsx',
  'shared/lounge/nativeDocumentEntry.tsx', 'shared/file-preview/nativeHtmlPreparation.ts',
  'shared/remote-desktop/ime.ts', 'shared/chat/touchTextSelection.ts',
  'shared/terminal/theme.ts', 'shared/terminal/webview.js', 'shared/terminal/webviewTouch.js',
]);
const slash = value => value.replaceAll('\\', '/');
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const sourcePattern = /\.[cm]?[jt]sx?$|\.css$|\.less$/;
const previous = fs.existsSync(path.join(vendor, 'source-lock.json'))
  ? readJson(path.join(vendor, 'source-lock.json')).files : {};

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.codex-tmp')) return [];
    if (['node_modules', 'vendor', 'android', 'ios', '.git', '.expo', 'build'].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function resolveSource(file) {
  const plain = file.replace(/\?(raw|url)$/, '');
  return ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.d.ts', '/index.ts', '/index.tsx', '/index.js']
    .map(suffix => plain + suffix).find(value => fs.existsSync(value) && fs.statSync(value).isFile());
}

function references(content, directory, visit) {
  return content.replace(/(['"])(\.{1,2}\/[^'"\r\n]+)\1/g, (match, quote, specifier) => {
    const absolute = path.resolve(directory, specifier.replace(/\?(raw|url)$/, ''));
    visit(absolute);
    return match;
  });
}

function collect(absolute) {
  const file = resolveSource(absolute);
  if (!file) return;
  const relative = slash(path.relative(root, file));
  if (/^(shared|apps\/(desktop|web)|scripts)\//.test(relative)) pending.add(relative);
}

for (const file of walk(destination).filter(file => sourcePattern.test(file))) {
  references(fs.readFileSync(file, 'utf8'), path.dirname(file), absolute => {
    const relative = slash(path.relative(destination, absolute));
    if (relative.startsWith('vendor/')) collect(path.join(root, relative.slice(7)));
    else if (relative.startsWith('../')) collect(absolute);
  });
}

function copy(relative) {
  const source = path.join(root, relative);
  const target = path.join(vendor, relative);
  let contents = fs.readFileSync(source);
  if (!contents.includes(0)) contents = Buffer.from(contents.toString('utf8').replaceAll('\r\n', '\n'));
  files[relative] = hash(contents);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return contents.toString('utf8');
}

for (const relative of pending) {
  const content = copy(relative);
  if (sourcePattern.test(relative)) references(content, path.dirname(path.join(root, relative)), collect);
  if (relative.endsWith('.js') && fs.existsSync(path.join(root, relative.replace(/\.js$/, '.d.ts')))) {
    pending.add(relative.replace(/\.js$/, '.d.ts'));
  }
}

const roots = ['crates/chat-connectivity', 'crates/ssh-client', 'crates/ssh-mobile'];
for (const relative of git(['ls-files', ...roots]).split('\n').filter(Boolean)) copy(relative);
copy('LICENSE');
const desktop = readJson(path.join(root, 'apps/desktop/package.json'));
const web = readJson(path.join(root, 'apps/web/package.json'));
const i18n = readJson(path.join(destination, 'package.json')).dependencies['@remoteai/i18n'];
if (!i18n.startsWith('https://github.com/piperhex/remoteai-i18n/releases/download/')) {
  throw new Error('Native must pin a published @remoteai/i18n release.');
}
writeJson(path.join(vendor, 'package.json'), {
  name: '@remoteai/native-dependencies', version: '0.1.0', private: true,
  description: 'Generated dependency snapshot. Refresh with npm run export:native in the parent repository.',
  dependencies: { ...desktop.dependencies, 'antd-mobile': web.dependencies['antd-mobile'], '@remoteai/i18n': i18n },
  devDependencies: Object.fromEntries(Object.entries(desktop.devDependencies)
    .filter(([name]) => name.startsWith('@types/'))),
});
writeJson(path.join(vendor, 'source-lock.json'), {
  repository: 'https://github.com/piperhex/remoteai.git', revision: git(['rev-parse', 'HEAD']),
  sharedSource: { repository: 'https://github.com/piperhex/remoteai-shared.git',
    revision: git(['rev-parse', 'HEAD'], path.join(root, 'shared')) }, i18n, files,
});
for (const relative of Object.keys(previous)) {
  const target = path.resolve(vendor, relative);
  if (!Object.hasOwn(files, relative) && target.startsWith(vendor + path.sep)) fs.rmSync(target, { force: true });
}
console.log(`Exported ${Object.keys(files).length} dependency files to ${vendor}`);
