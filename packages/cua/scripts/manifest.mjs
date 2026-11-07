import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asset, output, sha256, tag, upstream, version } from './common.mjs';
import { patchBytes, sourceLockBytes } from './prepare.mjs';

export async function manifest(directory = output) {
  const assets = [];
  for (const target of Object.keys(upstream.assets)) {
    const entry = JSON.parse(await readFile(join(directory, `${target}.json`), 'utf8'));
    const expected = asset(target);
    if (entry.version !== version || entry.tag !== tag || entry.target !== target
      || entry.filename !== expected.filename || entry.upstreamCommit !== upstream.commit
      || entry.patchSha256 !== sha256(await patchBytes())
      || entry.sourceInventorySha256 !== sha256(await sourceLockBytes())) {
      throw new Error(`Invalid metadata for ${target}`);
    }
    if (sha256(await readFile(join(directory, expected.filename))) !== entry.sha256) {
      throw new Error(`Release checksum mismatch: ${target}`);
    }
    assets.push(entry);
  }
  if (new Set(assets.map(entry => entry.sourceCommit)).size !== 1) throw new Error('Mixed release source commits');
  if (process.env.GITHUB_SHA && assets.some(entry => entry.sourceCommit !== process.env.GITHUB_SHA)) {
    throw new Error('Release source commit does not match this workflow');
  }
  const result = { version, tag, upstream, assets };
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(directory, 'SHA256SUMS'),
    assets.map(entry => `${entry.sha256}  ${entry.filename}\n`).join(''));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await manifest(process.argv[2] ? resolve(process.argv[2]) : output);
}
