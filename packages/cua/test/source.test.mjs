import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { asset, run, upstream, version } from '../scripts/common.mjs';
import { sourceManifest, verifySource } from '../scripts/prepare.mjs';

test('release targets preserve the upstream runtime contract', () => {
  assert.match(version, new RegExp(`^${upstream.version.replaceAll('.', '\\.')}\\-remoteai\\.\\d+$`));
  assert.match(upstream.commit, /^[a-f0-9]{40}$/);
  for (const target of ['windows-x86_64', 'windows-arm64', 'darwin-universal']) {
    const info = asset(target);
    assert.match(info.sha256, /^[a-f0-9]{64}$/);
    assert.ok(info.filename.startsWith(`cua-driver-rs-${version}-`));
  }
  assert.throws(() => asset('../../unexpected'));
});

test('vendored source verification rejects changed, missing and unrecorded files', () => {
  const root = mkdtempSync(join(tmpdir(), 'remoteai-cua-source-test-'));
  const source = join(root, 'source');
  mkdirSync(source);
  const git = (...args) => run('git', args, { cwd: source, stdio: 'pipe' });
  try {
    git('init');
    git('config', 'core.autocrlf', 'false');
    writeFileSync(join(source, 'existing.rs'), 'patched\n');
    writeFileSync(join(source, '.gitignore'), 'target/\n');
    git('add', '.');
    const manifest = sourceManifest(source);
    verifySource({ source, manifest });
    mkdirSync(join(source, 'target'));
    writeFileSync(join(source, 'target', 'generated'), 'build output');
    verifySource({ source, manifest });
    writeFileSync(join(source, 'existing.rs'), 'unreviewed\n');
    assert.throws(() => verifySource({ source, manifest }), /differs/);
    writeFileSync(join(source, 'existing.rs'), 'patched\n');
    writeFileSync(join(source, 'unexpected.rs'), 'unreviewed\n');
    assert.throws(() => verifySource({ source, manifest }), /differs/);
    rmSync(join(source, 'unexpected.rs'));
    rmSync(join(source, 'existing.rs'));
    assert.throws(() => verifySource({ source, manifest }), /ENOENT/);
    assert.throws(() => verifySource({ source, manifest: { ...manifest, upstreamCommit: '0'.repeat(40) } }),
      /revision/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
