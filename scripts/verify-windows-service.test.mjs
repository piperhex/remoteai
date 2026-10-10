import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyWindowsService } from './verify-windows-service.mjs';

const files = [
  'resources/desktop-service/LICENSE.node',
  'resources/desktop-service/host.mjs',
  'resources/desktop-service/node.exe',
  'resources/remote-desktop/runtime/desktop-video.exe',
  'resources/remote-desktop/runtime/ffmpeg.exe',
  'resources/remote-desktop/runtime/desktop-privacy.exe',
  'resources/remote-desktop/runtime/privacy-driver/MttVDD.inf',
  'resources/remote-desktop/runtime/privacy-driver/MttVDD.dll',
  'resources/remote-desktop/runtime/privacy-driver/mttvdd.cat',
  'resources/remote-desktop/runtime/privacy-driver/LICENSE.txt',
].sort();

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'csw-service-installer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = {};
  for (const file of files) {
    const bytes = Buffer.from(`fixture:${file}`);
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), bytes);
    manifest[file] = createHash('sha256').update(bytes).digest('hex');
  }
  writeFileSync(join(root, 'csw.exe'), `executable-prefix${JSON.stringify(manifest)}executable-suffix`);
  return root;
}

test('accepts all service assets matching the compiled manifest', t => {
  assert.equal(verifyWindowsService(fixture(t)), files.length);
});

test('rejects an installer containing only the service README', t => {
  const root = fixture(t);
  rmSync(join(root, 'resources/desktop-service/node.exe'));
  assert.throws(() => verifyWindowsService(root), /Missing Windows unattended service asset/);
});

test('rejects missing or empty video helpers', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'resources/remote-desktop/runtime/desktop-video.exe'), '');
  assert.throws(() => verifyWindowsService(root), /Missing Windows unattended service asset/);
});

test('rejects a privacy helper without its signed driver catalog', t => {
  const root = fixture(t);
  rmSync(join(root, 'resources/remote-desktop/runtime/privacy-driver/mttvdd.cat'));
  assert.throws(() => verifyWindowsService(root), /Missing Windows unattended service asset/);
});

test('rejects resources changed after the executable was compiled', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'resources/desktop-service/host.mjs'), 'different host');
  assert.throws(() => verifyWindowsService(root), /do not match the manifest/);
});

test('rejects unmanifested extra resources', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'resources/desktop-service/extra.dll'), 'unexpected');
  assert.throws(() => verifyWindowsService(root), /do not match the manifest/);
});

test('rejects an executable with no complete service manifest', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'csw.exe'), '{}');
  assert.throws(() => verifyWindowsService(root), /do not match the manifest/);
});
