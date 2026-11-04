import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./tag-release.mjs', import.meta.url));

test('desktop release changes only desktop versions and leaves the native repository untouched', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'remoteai-native-isolation-'));
  const repository = path.join(temporary, 'source');
  const remote = path.join(temporary, 'remote.git');
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
  const write = (file, value) => {
    const target = path.join(repository, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value));
  };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release isolation test');
    git('config', 'user.email', 'release-test@example.invalid');
    write('package.json', { version: '2.2.0' });
    write('package-lock.json', { version: '2.2.0', packages: { '': { version: '2.2.0' } } });
    write('apps/desktop/package.json', { version: '2.2.0' });
    write('apps/desktop/src-tauri/tauri.conf.json', { version: '2.2.0' });
    write('apps/native/package.json', { version: '7.0.0' });
    write('apps/native/app.json', { expo: { version: '7.0.0', android: { versionCode: 70000099 } } });
    git('add', '.');
    git('commit', '-m', 'Initial fixture');
    git('init', '--bare', remote);
    git('remote', 'add', 'origin', remote);
    git('push', '-u', 'origin', 'main');
    execFileSync(process.execPath, [script, '2.2.1'], { cwd: repository, stdio: 'pipe' });
    const read = file => JSON.parse(fs.readFileSync(path.join(repository, file), 'utf8'));
    assert.equal(read('apps/native/package.json').version, '7.0.0');
    assert.equal(read('apps/native/app.json').expo.android.versionCode, 70000099);
    assert.equal(read('apps/desktop/package.json').version, '2.2.1');
    assert.equal(read('package-lock.json').version, '2.2.1');
    assert.equal(git('status', '--porcelain').toString().trim(), '');
  } finally {
    // This invocation owns the complete mkdtemp directory, including its disposable local Git remote.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
