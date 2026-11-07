import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const root = resolve(directory, '../..');
export const source = join(directory, 'vendor');
export const workspace = join(source, 'libs/cua-driver/rust');
export const output = join(root, '.codex-tmp/cua-release');
export const upstream = JSON.parse(await readFile(join(directory, 'upstream.json'), 'utf8'));
export const { version } = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
export const tag = `cua-v${version}`;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { windowsHide: true, stdio: 'inherit', encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result.stdout?.trim();
}

export function asset(target, releaseVersion = version) {
  const value = upstream.assets[target];
  if (!value) throw new Error(`Unsupported CUA target: ${target}`);
  const prefix = `cua-driver-rs-${releaseVersion}-${target}`;
  return { ...value, prefix, filename: `${prefix}${value.suffix}` };
}

export async function downloadUpstream(target) {
  const info = asset(target, upstream.version);
  const cache = join(root, '.codex-tmp/cua-downloads');
  await mkdir(cache, { recursive: true });
  const destination = join(cache, info.filename);
  let bytes = await readFile(destination).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!bytes) {
    const url = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${upstream.version}/${info.filename}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Upstream download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (sha256(bytes) !== info.sha256) throw new Error(`Upstream checksum mismatch: ${info.filename}`);
  await writeFile(`${destination}.partial`, bytes);
  await rename(`${destination}.partial`, destination);
  return destination;
}
