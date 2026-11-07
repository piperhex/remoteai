import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { asset, sha256, tag, upstream, version } from '../scripts/common.mjs';
import { manifest } from '../scripts/manifest.mjs';
import { patchBytes, sourceLockBytes } from '../scripts/prepare.mjs';

test('release manifest rejects mixed builds, altered archives, and absent targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'remoteai-cua-manifest-'));
  try {
    for (const target of Object.keys(upstream.assets)) {
      const { filename } = asset(target);
      await writeFile(join(directory, filename), target);
      await writeFile(join(directory, `${target}.json`), JSON.stringify({
        version, tag, target, filename, sha256: sha256(target), upstreamCommit: upstream.commit,
        patchSha256: sha256(await patchBytes()), sourceCommit: process.env.GITHUB_SHA || 'fixture',
        sourceInventorySha256: sha256(await sourceLockBytes()),
      }));
    }
    assert.equal((await manifest(directory)).assets.length, 3);
    assert.equal((await readFile(join(directory, 'SHA256SUMS'), 'utf8')).trim().split('\n').length, 3);
    const metadataPath = join(directory, 'windows-arm64.json');
    const original = await readFile(metadataPath, 'utf8');
    await writeFile(metadataPath, JSON.stringify({ ...JSON.parse(original), sourceCommit: 'different' }));
    await assert.rejects(manifest(directory), /Mixed release source/);
    await writeFile(metadataPath, original);
    await writeFile(metadataPath, JSON.stringify({ ...JSON.parse(original), sourceInventorySha256: '0'.repeat(64) }));
    await assert.rejects(manifest(directory), /Invalid metadata/);
    await writeFile(metadataPath, original);
    const archive = join(directory, asset('windows-arm64').filename);
    await writeFile(archive, 'tampered');
    await assert.rejects(manifest(directory), /checksum mismatch/);
    await writeFile(archive, 'windows-arm64');
    await rm(metadataPath);
    await assert.rejects(manifest(directory), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
