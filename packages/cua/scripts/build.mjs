import { cp, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  asset, downloadUpstream, output, run, sha256, tag, upstream, version, workspace,
} from './common.mjs';
import { patchBytes, prepare, sourceLockBytes } from './prepare.mjs';

const target = process.argv[2];
const info = asset(target);
prepare();
await mkdir(output, { recursive: true });
const archive = await downloadUpstream(target);
const provenance = { version, upstreamVersion: upstream.version, upstreamCommit: upstream.commit,
  patchSha256: sha256(await patchBytes()), sourceCommit: process.env.GITHUB_SHA || 'local-review',
  sourceInventorySha256: sha256(await sourceLockBytes()),
  target, rust: upstream.rust };

if (target.startsWith('windows-')) {
  if (process.platform !== 'win32') throw new Error('Windows CUA builds require Windows');
  const cargoArgs = ['build', '--locked', '--release', '--target', info.rustTarget,
    '-p', 'cua-driver', '--bin', 'cua-driver', '-p', 'cua-driver-sdk', '--lib'];
  run('cargo', cargoArgs, { cwd: workspace, env: { ...process.env,
    CUA_DRIVER_GIT_SHA: provenance.sourceCommit, CARGO_PROFILE_RELEASE_DEBUG: '0' } });
  const staging = await mkdtemp(join(output, 'stage-'));
  run('tar', ['-xf', archive, '-C', staging]);
  const previous = join(staging, asset(target, upstream.version).prefix);
  const directory = join(staging, info.prefix);
  await rename(previous, directory);
  for (const name of ['cua-driver.exe', 'cua_driver_sdk.dll']) {
    await cp(join(workspace, 'target', info.rustTarget, 'release', name), join(directory, name));
  }
  await writeFile(join(directory, 'remoteai-build.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  // Preserve the upstream companion binaries and notices; the CLI and SDK share the patch.
  run('tar', ['-a', '-cf', join(output, info.filename), '-C', staging, info.prefix]);
} else {
  // macOS keeps its original host-attributed, signed upstream runtime byte-for-byte.
  await cp(archive, join(output, info.filename));
}
const bytes = await readFile(join(output, info.filename));
await writeFile(join(output, `${target}.json`),
  `${JSON.stringify({ ...provenance, tag, filename: info.filename, sha256: sha256(bytes) }, null, 2)}\n`);
console.log(`Built ${info.filename}: ${sha256(bytes)}`);
