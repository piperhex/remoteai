import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { nativeDependencies } from './native-dependencies.mjs';

// Run under the shared heavy-verification mutex; reuse the full desktop test target's dependencies.
const root = resolve(import.meta.dirname, '../..');
const evidence = resolve(root, '.codex-tmp/project-editor');
const source = resolve(root, 'apps/desktop/src-tauri/src/codex_gui');
const services = resolve(evidence, 'native-services');
mkdirSync(services, { recursive: true });
for (const file of ['project_editor.rs', 'local_file.rs']) copyFileSync(resolve(source, file), resolve(services, file));
cpSync(resolve(source, 'project_editor'), resolve(services, 'project_editor'), { recursive: true });
writeFileSync(resolve(services, 'mod.rs'), 'mod project_editor;\nmod local_file;\n'
  + readFileSync(resolve(import.meta.dirname, 'src/codex_gui.rs'), 'utf8'));
const deps = resolve(root, 'apps/desktop/src-tauri/target/debug/deps');
const newest = paths => paths.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const arguments_ = ['--edition', '2021', resolve(import.meta.dirname, 'native-probe.rs'),
  '--crate-name', 'project_editor_native_probe', '-L', `dependency=${deps}`, '-o', resolve(evidence, 'native-probe.exe')];
const artifact = process.env.PROJECT_EDITOR_TEST_BINARY ? { path: process.env.PROJECT_EDITOR_TEST_BINARY }
  : JSON.parse(readFileSync(resolve(evidence, 'tested-rust-artifact.json'), 'utf8').replace(/^\uFEFF/, ''));
const libraries = nativeDependencies(root, artifact);
writeFileSync(resolve(evidence, 'native-dependency-identities.json'), JSON.stringify(libraries, null, 2));
for (const { crate, library } of libraries) {
  arguments_.push('--extern', `${crate}=${library}`);
}
const build = resolve(root, 'apps/desktop/src-tauri/target/debug/build');
const loader = newest(readdirSync(build).filter(name => name.startsWith('webview2-com-sys-'))
  .map(name => resolve(build, name, 'out/x64')).filter(path => {
    try { return statSync(path).isDirectory(); } catch { return false; }
  }));
if (loader) arguments_.push('-L', `native=${loader}`);
const registry = resolve(process.env.CARGO_HOME ?? resolve(homedir(), '.cargo'), 'registry/src');
for (const index of readdirSync(registry)) {
  const directory = resolve(registry, index);
  for (const crate of readdirSync(directory).filter(name => name.startsWith('windows_x86_64_msvc-'))) {
    arguments_.push('-L', `native=${resolve(directory, crate, 'lib')}`);
  }
}
writeFileSync(resolve(evidence, 'native-build-arguments.json'), JSON.stringify(arguments_, null, 2));
execFileSync('rustc', arguments_, { cwd: root, stdio: 'inherit', env: { ...process.env,
  CARGO_PKG_NAME: 'project-editor-native-probe' } });
// Cargo normally embeds this dependency; direct rustc hosts also need Common Controls v6.
const sdk = resolve(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Windows Kits/10/bin');
const manifestTool = readdirSync(sdk).filter(name => /^10\./.test(name)).sort().reverse()
  .map(version => resolve(sdk, version, 'x64/mt.exe')).find(file => {
    try { return statSync(file).isFile(); } catch { return false; }
  });
if (!manifestTool) throw new Error('Windows SDK mt.exe is required for the standalone host manifest');
execFileSync(manifestTool, ['-manifest', resolve(import.meta.dirname, 'native-probe.exe.manifest'),
  `-outputresource:${resolve(evidence, 'native-probe.exe')};#1`], { stdio: 'inherit' });
