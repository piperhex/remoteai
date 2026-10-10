import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'apps/desktop/src-tauri/desktop-privacy');
const cache = join(root, '.codex-tmp/desktop-privacy');
const destination = join(root, 'apps/desktop/src-tauri/resources/remote-desktop/runtime');
const hash = 'e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a';
const url = 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/'
  + '25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Privacy display build failed: ${command}`);
}

async function findInf(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'mttvdd.inf') return directory;
    if (entry.isDirectory()) { const found = await findInf(path); if (found) return found; }
  }
}

async function driver() {
  const archive = join(cache, 'driver-25.7.23.zip');
  if (!existsSync(archive)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Privacy display download failed: ${response.status}`);
    await writeFile(`${archive}.partial`, Buffer.from(await response.arrayBuffer()));
    await rename(`${archive}.partial`, archive);
  }
  if (createHash('sha256').update(await readFile(archive)).digest('hex') !== hash) {
    throw new Error('Privacy display driver checksum mismatch');
  }
  const extracted = join(cache, 'driver');
  run(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    'Expand-Archive -LiteralPath $env:PRIVACY_ARCHIVE -DestinationPath $env:PRIVACY_EXTRACT -Force'],
  { ...process.env, PRIVACY_ARCHIVE: archive, PRIVACY_EXTRACT: extracted });
  const folder = await findInf(extracted);
  if (!folder) throw new Error('Privacy display driver package is incomplete');
  const target = join(destination, 'privacy-driver');
  await mkdir(target, { recursive: true });
  for (const name of ['MttVDD.inf', 'MttVDD.dll', 'mttvdd.cat']) await cp(join(folder, name), join(target, name));
  await cp(join(source, 'vdd_settings.xml'), join(target, 'vdd_settings.xml'));
  await cp(join(source, 'LICENSE-VirtualDisplayDriver'), join(target, 'LICENSE.txt'));
}

export async function prepareDesktopPrivacy() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  await mkdir(cache, { recursive: true });
  await mkdir(destination, { recursive: true });
  const build = join(cache, 'build');
  const platform = process.platform === 'win32'
    ? ['-G', 'Visual Studio 17 2022', '-A', 'x64']
    : ['-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0', '-DCMAKE_BUILD_TYPE=Release'];
  run('cmake', ['-S', source, '-B', build, ...platform, `-DPRIVACY_OUTPUT=${destination}`]);
  run('cmake', ['--build', build, '--config', 'Release', '--parallel']);
  run(process.execPath, [join(root, 'scripts/test-desktop-privacy.mjs'),
    join(build, process.platform === 'win32' ? 'Release/privacy-protocol-test.exe' : 'privacy-protocol-test')]);
  if (process.platform === 'win32') await driver();
  else run('codesign', ['--force', '--sign', '-', join(destination, 'desktop-privacy')]);
  await cp(join(source, 'LICENSE-DeskPad'), join(destination, 'LICENSE-DeskPad'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareDesktopPrivacy();
