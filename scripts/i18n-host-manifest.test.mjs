import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withHostManifest } from './i18n-host-manifest.mjs';

test('host integration preserves shared source ownership while independent applications check their own copy', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remoteai-host-manifest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'packages/i18n');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'platform.json'), JSON.stringify({
    mirrors: [{ target: 'apps/native/locales/zh.json' }, { target: 'apps/desktop/messages.rs' }],
    ownership: { include: ['apps', 'shared', 'scripts'], exclude: [], submodules: ['shared'] },
  }));
  let generated;
  withHostManifest(root, filename => {
    generated = filename;
    const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
    assert.deepEqual(manifest.ownership.submodules, ['shared']);
    assert.deepEqual(manifest.ownership.exclude, ['apps/native', 'apps/web']);
    assert.deepEqual(manifest.mirrors, [{ target: 'apps/desktop/messages.rs' }]);
  });
  assert.equal(fs.existsSync(generated), false);
});
