import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'remoteai-cli-progress-'));
try {
  for (const [source, output, format] of [
    ['npm.ts', 'installer.mjs', 'esm'], ['npmProgress.ts', 'npm-progress.cjs', 'cjs'],
  ]) {
    await build({ entryPoints: [fileURLToPath(new URL(`../cli-gui/${source}`, import.meta.url))],
      outfile: join(directory, output), bundle: true, platform: 'node', target: 'node22', format });
  }
  const { installPackages } = await import(pathToFileURL(join(directory, 'installer.mjs')).href);
  const root = join(directory, 'installation');
  await mkdir(join(root, 'runtime'), { recursive: true });
  const samples = [];
  await installPackages(root, ['is-number@7.0.0'], value => samples.push(value));
  const installed = JSON.parse(await readFile(join(root, 'runtime/node_modules/is-number/package.json'), 'utf8'));
  assert.equal(installed.version, '7.0.0');
  for (const fileName of ['npm-10.8.2.tgz', 'is-number-7.0.0.tgz']) {
    const download = samples.filter(value => value.fileName === fileName);
    assert.ok(download.some(value => value.phase === 'downloading' && value.total > 0), `${fileName}: total size`);
    assert.ok(download.some(value => value.downloaded === value.total && value.total > 0), `${fileName}: completed bytes`);
    console.log(fileName, JSON.stringify(download.at(-1)));
  }
  console.log('Real npm bootstrap, archive progress, IPC and package installation passed.');
} finally {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('remoteai-cli-progress-')) {
    throw new Error('Refusing to remove an unexpected test directory');
  }
  await rm(target, { recursive: true, force: true });
}
