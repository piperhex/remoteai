import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isInstallationProgress, PROGRESS_REPORT_INTERVAL_MS, type ReportProgress } from './downloadProgress';

const REGISTRY = 'https://registry.npmjs.org';
const NPM_VERSION = '10.8.2';
const ARCHIVE_LIMIT = 80 * 1024 * 1024;

async function download(url: string, report?: ReportProgress) {
  if (new URL(url).origin !== REGISTRY) throw new Error('Invalid package origin');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Package download failed: ${response.status}`);
  if (!response.body) throw new Error('Missing package response');
  const length = Number(response.headers.get('content-length'));
  const total = Number.isSafeInteger(length) && length > 0 ? length : undefined;
  const fileName = new URL(url).pathname.split('/').pop();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  let lastReport = 0;
  report?.({ phase: 'downloading', downloaded, total, fileName });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      downloaded += chunk.value.length;
      if (downloaded > ARCHIVE_LIMIT) throw new Error('Package archive too large');
      chunks.push(chunk.value);
      if (Date.now() - lastReport >= PROGRESS_REPORT_INTERVAL_MS) {
        lastReport = Date.now(); report?.({ phase: 'downloading', downloaded, total, fileName });
      }
    }
    report?.({ phase: 'downloading', downloaded, total: downloaded, fileName });
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); reader.releaseLock(); }
}

/** npm's published archive is self-contained. Extract regular files only, within the private tools directory. */
export async function unpackNpm(archive: Buffer, destination: string) {
  const tar = gunzipSync(archive, { maxOutputLength: ARCHIVE_LIMIT });
  const root = resolve(destination);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0;
    const type = header[156];
    if (offset + 512 + size > tar.length) throw new Error('Incomplete package archive');
    const target = resolve(root, name);
    if (!name.startsWith('package/') || !target.startsWith(root + sep)
      || name.includes('\\') || name.includes(':')) throw new Error('Invalid archive path');
    if (type === 0 || type === 48) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, tar.subarray(offset + 512, offset + 512 + size), { mode: 0o755 });
    } else if (![53, 120, 103].includes(type)) throw new Error('Unsupported archive entry');
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

async function npmPath(root: string, report: ReportProgress) {
  const destination = join(root, 'tools', `npm-${NPM_VERSION}`);
  const entry = join(destination, 'package/bin/npm-cli.js');
  try { await readFile(join(destination, 'ready')); return entry; } catch { /* First installation. */ }
  const metadata = JSON.parse((await download(`${REGISTRY}/npm/${NPM_VERSION}`)).toString()) as {
    dist: { tarball: string; integrity: string };
  };
  const archive = await download(metadata.dist.tarball, report);
  report({ phase: 'preparing', downloaded: archive.length, total: archive.length });
  const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
  if (integrity !== metadata.dist.integrity) throw new Error('Package integrity mismatch');
  await unpackNpm(archive, destination);
  await writeFile(join(destination, 'ready'), NPM_VERSION);
  return entry;
}

export async function installPackages(root: string, packages: string[], report: ReportProgress) {
  report({ phase: 'preparing', downloaded: 0 });
  const npm = await npmPath(root, report);
  report({ phase: 'installing', downloaded: 0 });
  const config = join(root, 'npmrc');
  const globalConfig = join(root, 'npmrc-global');
  await writeFile(config, `registry=${REGISTRY}\n`);
  await writeFile(globalConfig, '');
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^npm_config_/i.test(key)));
  await new Promise<void>((resolveInstall, reject) => {
    const monitor = fileURLToPath(new URL('./npm-progress.cjs', import.meta.url));
    const child = spawn(process.execPath, ['--require', monitor, npm, 'install', '--prefix', join(root, 'runtime'),
      '--registry', REGISTRY, '--no-audit', '--no-fund', '--omit=dev', '--save-exact', ...packages],
    { cwd: join(root, 'runtime'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...environment,
      npm_config_userconfig: config, npm_config_globalconfig: globalConfig,
      npm_config_registry: REGISTRY, npm_config_cache: join(root, 'npm-cache') } });
    child.stderr?.on('data', chunk => process.stderr.write(chunk));
    child.on('message', (value: unknown) => {
      if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'install-progress') return;
      if ('progress' in value && isInstallationProgress(value.progress)) report(value.progress);
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveInstall() : reject(new Error(`npm exited ${code}`)));
  });
}
