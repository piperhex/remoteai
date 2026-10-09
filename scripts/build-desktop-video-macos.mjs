import { mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'apps/desktop/src-tauri/desktop-video-macos');
const cache = join(root, '.codex-tmp/remote-desktop-macos');
const destination = join(root, 'apps/desktop/src-tauri/resources/remote-desktop/runtime');

export function buildDesktopVideoMacos() {
  if (process.platform !== 'darwin') return;
  mkdirSync(cache, { recursive: true });
  mkdirSync(destination, { recursive: true });
  const sources = readdirSync(source).filter(name => name.endsWith('.swift')).sort().map(name => join(source, name));
  const binaries = ['arm64', 'x86_64'].map(arch => {
    const output = join(cache, `desktop-video-${arch}`);
    run('xcrun', ['swiftc', '-parse-as-library', '-swift-version', '5', '-O',
      '-target', `${arch}-apple-macos13.0`, ...sources, '-o', output]);
    return output;
  });
  const executable = join(destination, 'desktop-video-macos');
  run('xcrun', ['lipo', '-create', ...binaries, '-output', executable]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'dev.codex.switch.desktop-video', executable]);
  run(executable, ['--self-test']);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`macOS desktop video build failed: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildDesktopVideoMacos();
