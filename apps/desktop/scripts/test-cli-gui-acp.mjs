import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from './cli-gui-acp-process.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const executable = process.platform === 'win32'
  ? resolve(desktop, 'src-tauri/resources/desktop-service/node.exe') : process.execPath;
const temporaryParent = resolve(tmpdir());
const prefix = 'remoteai-cli-acp-';
const root = await mkdtemp(join(temporaryParent, prefix));
const installTimeoutMs = 12 * 60_000;
const cachedTimeoutMs = 4 * 60_000;
const banner = {
  js: 'import { createRequire as __createRequire } from "node:module"; '
    + 'const require = __createRequire(import.meta.url);',
};

try {
  assert.deepEqual(await readdir(root), [], 'The first pass must start without a cache or readiness marker');
  console.log(`ACP smoke isolated root: ${root}`);
  // Build beside the installer: npm.ts resolves npm-progress.cjs relative to its bundle at runtime.
  const common = { bundle: true, platform: 'node', target: 'node22' };
  await build({ ...common, entryPoints: [resolve(desktop, 'cli-gui/npmProgress.ts')],
    outfile: join(root, 'npm-progress.cjs'), format: 'cjs' });
  await build({ ...common, stdin: { contents: [
    "export { installPackages } from './npm';", "export { RUNTIME_VERSION } from './runtime';",
  ].join('\n'), resolveDir: resolve(desktop, 'cli-gui'), loader: 'ts' },
  outfile: join(root, 'install-helper.mjs'), format: 'esm', banner });
  await build({ ...common, entryPoints: [resolve(desktop, 'cli-gui/host.ts')],
    outfile: join(root, 'host.mjs'), format: 'esm', banner });

  const scenario = fileURLToPath(new URL('./fixtures/cli-gui-acp-scenario.mjs', import.meta.url));
  for (const [mode, timeoutMs] of [['fresh', installTimeoutMs], ['cached', cachedTimeoutMs]]) {
    await runProcess(executable, [scenario, root, mode], { timeoutMs, label: `ACP ${mode} pass` });
  }
  console.log('ACP smoke passed with a real first installation and a second cached run.');
} finally {
  const target = resolve(root);
  if (!target.startsWith(temporaryParent + sep) || !basename(target).startsWith(prefix)) {
    throw new Error('Refusing to remove an unexpected ACP smoke directory');
  }
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  console.log(`ACP smoke cleaned: ${target}`);
}
