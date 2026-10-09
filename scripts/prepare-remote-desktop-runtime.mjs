import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktopVideo } from './build-desktop-video.mjs';
import { buildDesktopVideoMacos } from './build-desktop-video-macos.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = 'ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-shared-8.1';
const hash = 'e9712ffbdb03ef71bbab660c75b835bfe698ef6fad0247c76d8d394a39a3db63';
const url = `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/${build}.zip`;
const cache = join(root, '.codex-tmp', 'remote-desktop-runtime');
const destination = join(root, 'apps', 'desktop', 'src-tauri', 'resources', 'remote-desktop', 'runtime');

export async function prepareDesktopVideoRuntime() {
  if (process.platform === 'darwin') { buildDesktopVideoMacos(); return; }
  if (process.platform !== 'win32' || process.arch !== 'x64') return;
  const manifest = join(destination, 'archive.sha256');
  const extracted = join(cache, 'extracted');
  const sdk = join(extracted, build);
  if (existsSync(manifest) && (await readFile(manifest, 'utf8')).trim() === hash
    && existsSync(join(destination, 'ffmpeg.exe')) && existsSync(join(sdk, 'include/libavcodec/avcodec.h'))) {
    buildDesktopVideo({ sdk, cache, destination });
    return;
  }
  await mkdir(cache, { recursive: true });
  const archive = join(cache, `${build}.zip`);
  if (!existsSync(archive)) {
    console.log('Preparing the verified Windows desktop video runtime...');
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Desktop video runtime download failed: ${response.status}`);
    await writeFile(`${archive}.partial`, Buffer.from(await response.arrayBuffer()));
    await rename(`${archive}.partial`, archive);
  }
  if (createHash('sha256').update(await readFile(archive)).digest('hex') !== hash) {
    throw new Error('Desktop video runtime checksum mismatch');
  }
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    'Expand-Archive -LiteralPath $env:CSW_RUNTIME_ARCHIVE -DestinationPath $env:CSW_RUNTIME_EXTRACT -Force'], {
    env: { ...process.env, CSW_RUNTIME_ARCHIVE: archive, CSW_RUNTIME_EXTRACT: extracted }, windowsHide: true,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error('Desktop video runtime extraction failed');
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(join(extracted, build, 'bin'))) {
    if (name === 'ffmpeg.exe' || name.endsWith('.dll')) {
      await cp(join(extracted, build, 'bin', name), join(destination, name));
    }
  }
  await cp(join(extracted, build, 'LICENSE.txt'), join(destination, 'LICENSE.txt'));
  await writeFile(manifest, `${hash}\n`);
  buildDesktopVideo({ sdk, cache, destination });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareDesktopVideoRuntime();
