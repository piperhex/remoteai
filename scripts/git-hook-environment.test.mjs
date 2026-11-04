import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('pre-commit checks can initialize a foreign bare repository without modifying their caller', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'remoteai-hook-environment-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const environment = { ...process.env };
  const localVariables = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split('\n');
  for (const name of localVariables) delete environment[name.trim()];
  const root = join(temporary, 'caller');
  const fixture = join(temporary, 'fixture.git');
  const bin = join(temporary, 'bin');
  mkdirSync(bin);
  const git = args => execFileSync('git', args, { cwd: root, env: environment, encoding: 'utf8', stdio: 'pipe' });
  execFileSync('git', ['init', '--quiet', root], { env: environment, stdio: 'pipe' });
  mkdirSync(join(root, '.hooks'));
  const hook = readFileSync(new URL('../.husky/pre-commit', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  writeFileSync(join(root, '.hooks/pre-commit'), `#!/bin/sh\n${hook}`, { mode: 0o755 });
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\ngit init --quiet --bare "$HOOK_TEST_FIXTURE"\n', { mode: 0o755 });
  writeFileSync(join(root, 'source.txt'), 'retained source\n');
  git(['add', 'source.txt']);
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  const separator = process.platform === 'win32' ? ';' : ':';
  const hookEnvironment = { ...environment, [pathKey]: `${bin}${separator}${environment[pathKey]}`,
    GIT_DIR: resolve(root, '.git'), GIT_WORK_TREE: root, GIT_INDEX_FILE: resolve(root, '.git/index'),
    HOOK_TEST_FIXTURE: fixture };
  execFileSync('git', ['-c', 'core.hooksPath=.hooks', '-c', 'user.name=Hook Test',
    '-c', 'user.email=hook@example.invalid', 'commit', '-qm', 'verify hook isolation'],
  { cwd: root, env: hookEnvironment, stdio: 'pipe' });
  assert.equal(git(['rev-parse', '--is-bare-repository']).trim(), 'false');
  assert.equal(git(['show', 'HEAD:source.txt']), 'retained source\n');
  assert.equal(execFileSync('git', ['--git-dir', fixture, 'rev-parse', '--is-bare-repository'],
    { env: environment, encoding: 'utf8' }).trim(), 'true');
});
