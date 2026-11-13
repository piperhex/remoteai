import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktopUnlock } from './build-desktop-unlock.mjs';
import { extractVerifiedWindowsZip } from './extract-verified-windows-zip.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = 'v24.21.0';
const hash = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541';
const filename = `node-${version}-win-x64.zip`;
const url = `https://nodejs.org/dist/${version}/${filename}`;
const output = resolve(root, 'apps/desktop/src-tauri/resources/desktop-service');

export function bundleDesktopService({ write = true, metafile = false } = {}) {
  return build({ entryPoints: [resolve(root, 'apps/desktop/service/host.ts')],
    outfile: resolve(output, 'host.mjs'), bundle: true, platform: 'node', target: 'node24', format: 'esm',
    legalComments: 'linked', alias: { '@tauri-apps/api/core': resolve(root, 'apps/desktop/service/rpc.ts') },
    write, metafile });
}

export async function prepareDesktopService() {
  if (process.platform !== 'win32' || process.arch !== 'x64') return;
  await mkdir(output, { recursive: true });
  buildDesktopUnlock();
  await bundleDesktopService();
  const archive = resolve(root, '.codex-tmp/desktop-service-runtime', filename);
  const extracted = resolve(root, '.codex-tmp/desktop-service-runtime/extracted');
  await mkdir(resolve(archive, '..'), { recursive: true });
  if (!existsSync(archive)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Node runtime download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verify(bytes); await writeFile(archive, bytes);
  }
  verify(await readFile(archive));
  const source = resolve(extracted, `node-${version}-win-x64`);
  if (!existsSync(resolve(source, 'node.exe'))) {
    await extractVerifiedWindowsZip(archive, extracted);
  }
  await copyFile(resolve(source, 'node.exe'), resolve(output, 'node.exe'));
  await copyFile(resolve(source, 'LICENSE'), resolve(output, 'LICENSE.node'));
  await writeFile(resolve(output, 'NOTICE.md'), `Node.js ${version}\nSource: ${url}\nSHA-256: ${hash}\n`);
}
function verify(bytes) {
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Node runtime checksum mismatch');
}
