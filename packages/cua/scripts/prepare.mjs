import { lstatSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directory, run, sha256, source, upstream } from './common.mjs';

const lockPath = join(directory, 'source-lock.json');

function sourceFiles(checkout) {
  // Use the main repository's tracked files and unignored additions. Build caches stay excluded.
  const names = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
    { cwd: checkout, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
  return [...new Set(names)].sort();
}

export function sourceManifest(checkout = source) {
  const files = {};
  for (const name of sourceFiles(checkout)) {
    const path = join(checkout, name);
    const stat = lstatSync(path);
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Non-regular CUA source: ${name}`);
    // Windows may check out symlinks as text files; hash their target bytes without following them.
    files[name] = sha256(stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path));
  }
  return { upstreamCommit: upstream.commit, files };
}

export function verifySource({ source: checkout, manifest }) {
  if (manifest.upstreamCommit !== upstream.commit) throw new Error('CUA upstream revision mismatch');
  const actual = sourceManifest(checkout);
  if (!Object.keys(manifest.files).length) throw new Error('CUA source inventory is empty');
  if (JSON.stringify(actual.files) !== JSON.stringify(manifest.files)) {
    throw new Error('CUA source differs from source-lock.json; review changes and record the new inventory');
  }
}

export function prepare() {
  verifySource({ source, manifest: JSON.parse(readFileSync(lockPath, 'utf8')) });
}

export async function patchBytes() {
  return readFile(join(directory, 'patches/windows-native-launch.patch'));
}

export async function sourceLockBytes() {
  return readFile(lockPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--record')) {
    writeFileSync(lockPath, `${JSON.stringify(sourceManifest(), null, 2)}\n`);
  } else {
    prepare();
  }
}
