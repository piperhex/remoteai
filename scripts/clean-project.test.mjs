import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanProject, parseOptions } from './clean-project.mjs';
import { containedPath, git, planCleanup, removePlannedPath } from './lib/clean-project-safety.mjs';

function write(root, path, contents = 'fixture\n') {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function fixture(t) {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, 'remoteai-clean-'));
  t.after(() => {
    assert.ok(relative(parent, root).startsWith('remoteai-clean-'));
    rmSync(root, { recursive: true, force: true });
  });
  git(root, ['init', '--quiet']);
  write(root, '.gitignore', [
    'dist/', 'target/', '.nx/', '.codex-tmp*/', '.artifacts/', '.tmp/', 'node_modules/',
    '.worktrees/', 'vendor/', '.workspace/', '.env', '*.log', 'coverage/', 'test-results/',
  ].join('\n'));
  git(root, ['add', '.gitignore']);
  return root;
}

function run(root, args = []) {
  const output = [];
  const count = cleanProject(root, parseOptions(args), line => output.push(line));
  return { count, output: output.join('\n') };
}

test('preview is read-only; cleanup removes allowlisted output and is repeatable', t => {
  const root = fixture(t);
  const outputs = ['dist/app.js', '.nx/cache/task', 'apps/desktop/dist/index.html',
    'apps/desktop/src-tauri/target/debug/app', 'crates/ssh-client/target/debug/lib',
    'scripts/project-editor-harness/target/test', 'apps/website/test-results/result',
    '.codex-tmp/session.txt', '.codex-tmp-task/test.log', 'apps/desktop/.codex-tmp/capture.png',
    '.artifacts/check.txt', '.tmp/scratch'];
  const preserved = ['src/app.ts', 'scripts/build.mjs', 'node_modules/package/index.js',
    '.env', 'auth.json', 'debug.log', '.worktrees/task/source.ts', 'vendor/dist/snapshot.js',
    '.workspace/cache', 'apps/desktop/src-tauri/resources/remote-desktop/runtime/library.dll'];
  for (const file of [...outputs, ...preserved]) write(root, file);
  const preview = run(root, ['--dry-run']);
  assert.ok(preview.count > 0);
  assert.match(preview.output, /WOULD REMOVE/);
  for (const file of [...outputs, ...preserved]) assert.ok(existsSync(join(root, file)), file);
  assert.equal(run(root).count, preview.count);
  for (const file of outputs) assert.equal(existsSync(join(root, file)), false, file);
  for (const file of preserved) assert.ok(existsSync(join(root, file)), file);
  assert.equal(run(root).count, 0);
});

test('build and AI filters are independent and unknown arguments fail closed', t => {
  const root = fixture(t);
  write(root, 'dist/app');
  write(root, '.codex-tmp/scratch');
  run(root, ['--build']);
  assert.ok(existsSync(join(root, '.codex-tmp/scratch')));
  assert.equal(existsSync(join(root, 'dist')), false);
  write(root, 'dist/app');
  run(root, ['--ai']);
  assert.ok(existsSync(join(root, 'dist/app')));
  assert.equal(existsSync(join(root, '.codex-tmp')), false);
  assert.throws(() => parseOptions(['--force']), /Unknown option/);
  assert.throws(() => parseOptions(['../outside']), /Unknown option/);
});

test('tracked files, staged deletions, unignored directories and build sources survive', t => {
  const root = fixture(t);
  write(root, 'dist/retained.js');
  git(root, ['add', '-f', 'dist/retained.js']);
  git(root, ['-c', 'user.name=Cleanup Test', '-c', 'user.email=cleanup@example.invalid',
    '-c', 'core.hooksPath=.no-hooks', 'commit', '-qm', 'fixture']);
  git(root, ['rm', '--cached', 'dist/retained.js']);
  write(root, '.codex-tmp/staged.ts');
  git(root, ['add', '-f', '.codex-tmp/staged.ts']);
  write(root, 'dist/extra.js');
  write(root, 'apps/website/.prerender/notes');
  write(root, 'apps/web/build/config.ts');
  const result = run(root);
  assert.match(result.output, /contains tracked files/);
  assert.match(result.output, /not ignored by Git/);
  assert.ok(existsSync(join(root, 'dist/retained.js')));
  assert.ok(existsSync(join(root, 'dist/extra.js')));
  assert.ok(existsSync(join(root, '.codex-tmp/staged.ts')));
  assert.ok(existsSync(join(root, 'apps/website/.prerender/notes')));
  assert.ok(existsSync(join(root, 'apps/web/build/config.ts')));
});

test('nested repositories, bare repositories and worktrees survive beside temporary files', t => {
  const root = fixture(t);
  const nested = join(root, '.codex-tmp/checkout');
  mkdirSync(nested, { recursive: true });
  git(nested, ['init', '--quiet']);
  write(nested, 'uncommitted.ts');
  write(root, '.codex-tmp/worktree/.git', 'gitdir: missing-test-metadata\n');
  write(root, '.codex-tmp/worktree/source.ts');
  const bare = join(root, '.codex-tmp/repository.git');
  mkdirSync(bare);
  git(bare, ['init', '--bare', '--quiet']);
  write(root, '.codex-tmp/cache/output');
  write(root, '.codex-tmp/test.log');
  const result = run(root, ['--ai']);
  assert.match(result.output, /nested Git repository or worktree/);
  assert.ok(existsSync(join(nested, 'uncommitted.ts')));
  assert.ok(existsSync(join(root, '.codex-tmp/worktree/source.ts')));
  assert.ok(existsSync(join(bare, 'HEAD')));
  assert.equal(existsSync(join(root, '.codex-tmp/cache')), false);
  assert.equal(existsSync(join(root, '.codex-tmp/test.log')), false);
});

test('directory links and links in ancestors cannot reach external files', t => {
  const root = fixture(t);
  const outside = fixture(t);
  write(outside, 'dist/keep');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(outside, join(root, '.codex-tmp-linked'), linkType);
  mkdirSync(join(root, 'apps'), { recursive: true });
  symlinkSync(outside, join(root, 'apps/desktop'), linkType);
  write(root, '.codex-tmp/cache/file');
  symlinkSync(outside, join(root, '.codex-tmp/external'), linkType);
  run(root);
  assert.ok(lstatSync(join(root, '.codex-tmp-linked')).isSymbolicLink());
  assert.ok(existsSync(join(outside, 'dist/keep')));
  assert.ok(lstatSync(join(root, '.codex-tmp/external')).isSymbolicLink());
  assert.equal(existsSync(join(root, '.codex-tmp/cache')), false);
  assert.throws(() => containedPath(root, '..'), /outside/);
  assert.throws(() => containedPath(root, root), /outside/);
  assert.throws(() => containedPath(root, outside), /outside/);
  assert.throws(() => removePlannedPath(root, '.codex-tmp-linked'), /became a link/);
});

test('initialized submodules require opt-in and keep tracked snapshots', t => {
  const root = fixture(t);
  const child = join(root, 'apps/web');
  mkdirSync(child, { recursive: true });
  git(child, ['init', '--quiet']);
  write(child, '.gitignore', 'dist/\n.codex-tmp/\nnode_modules/\n.workspace/\n');
  write(child, 'vendor/snapshot.ts');
  git(child, ['add', '.gitignore', 'vendor']);
  git(child, ['-c', 'user.name=Cleanup Test', '-c', 'user.email=cleanup@example.invalid',
    '-c', 'core.hooksPath=.no-hooks', 'commit', '-qm', 'fixture']);
  const revision = git(child, ['rev-parse', 'HEAD']).trim();
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${revision},apps/web`]);
  write(child, 'dist/app');
  write(child, '.codex-tmp/scratch');
  write(child, '.workspace/dependency');
  write(child, 'node_modules/package/index.js');
  assert.equal(run(root).count, 0);
  assert.equal(run(root, ['--include-submodules', '--dry-run']).count, 2);
  run(root, ['--include-submodules']);
  assert.equal(existsSync(join(child, 'dist')), false);
  assert.equal(existsSync(join(child, '.codex-tmp')), false);
  for (const file of ['vendor/snapshot.ts', '.workspace/dependency', 'node_modules/package/index.js']) {
    assert.ok(existsSync(join(child, file)), file);
  }
  assert.equal(git(child, ['rev-parse', 'HEAD']).trim(), revision);
});

test('a failed repository check deletes nothing; missing optional submodules are harmless', t => {
  const root = fixture(t);
  write(root, 'dist/app');
  assert.throws(() => planCleanup(join(root, 'dist'), ['app']), /repository root/);
  assert.ok(existsSync(join(root, 'dist/app')));
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},apps/native`]);
  run(root, ['--include-submodules']);
  assert.equal(existsSync(join(root, 'dist')), false);
});

test('CLI help works outside the checkout and npm scripts expose preview and tests', () => {
  const script = new URL('./clean-project.mjs', import.meta.url);
  const output = execFileSync(process.execPath, [fileURLToPath(script), '--help'], {
    cwd: tmpdir(), encoding: 'utf8', windowsHide: true,
  });
  assert.match(output, /--dry-run/);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.clean, 'node scripts/clean-project.mjs');
  assert.equal(manifest.scripts['clean:preview'], 'npm run clean -- --dry-run');
});
