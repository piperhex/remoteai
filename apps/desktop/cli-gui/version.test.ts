import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it('detects managed CLI versions with spaced paths and no global Node on PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remoteai bundled node '));
  try {
    const bundle = join(root, 'Remote AI resources');
    await mkdir(bundle);
    const node = join(bundle, process.platform === 'win32' ? 'node.exe' : 'node');
    await copyFile(process.execPath, node);
    const module = join(root, 'version.mjs');
    await build({ entryPoints: [fileURLToPath(new URL('./version.ts', import.meta.url))],
      outfile: module, bundle: true, platform: 'node', format: 'esm' });
    const runner = join(root, 'probe.mjs');
    await writeFile(runner, `
      import assert from 'node:assert/strict';
      import { cliVersion, managedCommand } from './version.mjs';
      assert.equal(process.env.PATH, '');
      const command = await managedCommand(process.argv[2], 'claude');
      assert.equal(command[0], process.execPath);
      assert.equal(command.length, 2);
      assert.equal(await cliVersion('claude', process.argv[2]), '2.1.17-fixture');
      assert.equal(await cliVersion('gemini', process.argv[2]), '');
      console.log('managed CLI available');
    `);
    for (const extension of ['js', 'cjs', 'mjs']) {
      const data = join(root, `account data & spaces ${extension}`);
      const packageRoot = join(data, 'runtime/node_modules/@anthropic-ai/claude-code');
      await mkdir(packageRoot, { recursive: true });
      const entry = `cli entry.${extension}`;
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ bin: { claude: entry } }));
      await writeFile(join(packageRoot, entry), `
        if (process.argv.length !== 3 || process.argv[2] !== '--version') process.exit(2);
        if (process.env.PATH !== '' || process.execPath !== process.env.REMOTEAI_TEST_NODE) process.exit(3);
        console.log('2.1.17-fixture (Claude Code)');
      `);
      const result = await execute(node, [runner, data], { windowsHide: true, timeout: 15_000,
        env: { ...process.env, PATH: '', REMOTEAI_TEST_NODE: node, NODE_OPTIONS: '', NODE_PATH: '' } });
      expect(result.stdout.trim()).toBe('managed CLI available');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
