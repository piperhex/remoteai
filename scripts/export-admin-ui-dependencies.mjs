import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(process.argv[2] ?? path.join(root, 'apps/admin-ui'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'remoteai-admin-dependencies-'));
const vendor = path.join(destination, 'vendor');
const hash = value => createHash('sha256').update(value).digest('hex');
const files = {};
fs.mkdirSync(vendor, { recursive: true });
const manifestPath = path.join(vendor, 'source-lock.json');
const previousPackages = fs.existsSync(manifestPath)
  ? Object.values(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).packages) : [];

function copy(source, target) {
  const contents = fs.readFileSync(path.join(root, source), 'utf8').replaceAll('\r\n', '\n');
  files[source.replaceAll('\\', '/')] = hash(contents);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function copyTree(source, target) {
  for (const entry of fs.readdirSync(path.join(root, source), { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else copy(from, to);
  }
}

function pack(directory, metadata) {
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  copy('LICENSE', path.join(directory, 'LICENSE'));
  const arguments_ = ['pack', '--json', '--pack-destination', vendor];
  const windows = process.platform === 'win32';
  if (windows) arguments_.unshift(process.env.npm_execpath
    ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'));
  const result = JSON.parse(execFileSync(windows ? process.execPath : 'npm', arguments_, {
    cwd: directory, encoding: 'utf8',
  }));
  const archive = path.join(vendor, result[0].filename);
  const filename = result[0].filename.replace('.tgz', `-${hash(fs.readFileSync(archive)).slice(0, 16)}.tgz`);
  fs.renameSync(archive, path.join(vendor, filename));
  return filename;
}

function sharedImports() {
  const imports = new Set();
  for (const file of fs.readdirSync(path.join(destination, 'src'), { recursive: true })) {
    if (!/\.[jt]sx?$/.test(file)) continue;
    const content = fs.readFileSync(path.join(destination, 'src', file), 'utf8');
    for (const match of content.matchAll(/['"](?:\.\.\/)+shared\/([^'"]+)['"]|['"]@remoteai\/shared\/([^'"]+)['"]/g)) {
      imports.add(`./shared/${match[1] ?? match[2]}`);
    }
  }
  return [...imports].sort();
}

function includeTypeDependencies(inputs) {
  for (const input of inputs) {
    if (input === '<stdin>') continue;
    const content = fs.readFileSync(input, 'utf8');
    for (const match of content.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(input), match[1]);
      const resolved = ['', '.ts', '.tsx', '.json', '/index.ts', '/index.tsx']
        .map(suffix => base + suffix).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (!resolved) throw new Error(`Cannot resolve ${match[1]} in ${input}`);
      inputs.add(path.relative(process.cwd(), resolved).replaceAll('\\', '/'));
    }
  }
  return [...inputs].filter(input => input !== '<stdin>').sort();
}

async function sharedPackage() {
  const result = await build({
    stdin: { contents: sharedImports().map(value => `import '${value}';`).join('\n'), resolveDir: root },
    bundle: true, packages: 'external', platform: 'browser', format: 'esm',
    outdir: path.join(temporary, 'bundle'), write: false, metafile: true,
  });
  const directory = path.join(temporary, 'shared');
  const exports = {};
  const inputs = new Set(Object.keys(result.metafile.inputs));
  for (const input of includeTypeDependencies(inputs)) {
    const relative = path.relative(root, path.resolve(input)).replaceAll('\\', '/');
    if (!/^(shared|apps)\//.test(relative)) throw new Error(`Unexpected shared dependency: ${relative}`);
    copy(relative, path.join(directory, relative));
    if (relative.startsWith('shared/')) {
      const target = relative.slice('shared/'.length);
      exports[`./${target.replace(/\.[jt]sx?$/, '')}`] = `./${relative}`;
    }
  }
  return pack(directory, {
    name: '@remoteai/shared', version: '0.1.0', private: true, type: 'module', license: 'Apache-2.0', exports,
    dependencies: { '@noble/ciphers': '^1.3.0', '@noble/curves': '^1.9.7', '@noble/hashes': '^1.8.0',
      'base64-js': '^1.5.1' },
    peerDependencies: { '@remoteai/i18n': '0.1.0', antd: '^5.29.3', react: '^18.3.1', 'lucide-react': '^0.468.0' },
  });
}

try {
  const shared = await sharedPackage();
  const directory = path.join(temporary, 'i18n');
  copyTree('packages/i18n/src', path.join(directory, 'src'));
  const original = JSON.parse(fs.readFileSync(path.join(root, 'packages/i18n/package.json'), 'utf8'));
  const { scripts, devDependencies, ...metadata } = original;
  delete metadata.exports['./tooling/dream-skin'];
  const i18n = pack(directory, metadata);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fs.writeFileSync(manifestPath, JSON.stringify({
    repository: 'https://github.com/piperhex/remoteai.git', revision,
    packages: { shared, i18n }, files,
  }, null, 2) + '\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
  manifest.dependencies['@remoteai/shared'] = `file:vendor/${shared}`;
  manifest.dependencies['@remoteai/i18n'] = `file:vendor/${i18n}`;
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const filename of previousPackages) {
    if (![shared, i18n].includes(filename) && path.basename(filename) === filename) {
      fs.rmSync(path.join(vendor, filename), { force: true });
    }
  }
  console.log(`Exported ${Object.keys(files).length} source files to ${vendor}`);
} finally {
  // Only remove this invocation's private OS temporary directory.
  fs.rmSync(temporary, { recursive: true, force: true });
}
