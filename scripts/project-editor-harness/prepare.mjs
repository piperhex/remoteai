import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Extract a read-only baseline; never check out or reset the shared working tree.
const root = resolve(import.meta.dirname, '../..');
const evidence = resolve(root, '.codex-tmp/project-editor');
const baseline = resolve(evidence, 'baseline');
const revision = '04776426e';
const prefix = 'apps/desktop/src-tauri/src/codex_gui/';
const paths = ['project_editor.rs', 'project_editor_tests.rs', 'project_editor', 'local_file.rs'];
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, '--',
  ...paths.map(path => prefix + path)], { cwd: root, encoding: 'utf8' }).trim().split('\n');
for (const path of files) {
  const output = resolve(baseline, path.slice(prefix.length));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root }));
}
for (const version of ['before', 'after']) {
  const env = { ...process.env };
  if (version === 'before') env.PROJECT_EDITOR_SOURCE = baseline;
  else delete env.PROJECT_EDITOR_SOURCE;
  execFileSync('cargo', ['build', '--release', '--manifest-path',
    'scripts/project-editor-harness/Cargo.toml', '--jobs', '1'], { cwd: root, env, stdio: 'inherit' });
  copyFileSync(resolve(import.meta.dirname, 'target/release/project-editor-harness.exe'),
    resolve(evidence, `${version}.exe`));
}
