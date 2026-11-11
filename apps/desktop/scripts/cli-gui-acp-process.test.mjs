import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorker, runProcess } from './cli-gui-acp-process.mjs';

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'remoteai-acp-process-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(root).startsWith('remoteai-acp-process-'));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return root;
}

test('process exit and launch failures reject immediately', async t => {
  const root = await directory(t);
  const options = { timeoutMs: 5000, label: 'fixture', stdio: 'ignore' };
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(7)'], options), /exited with 7/);
  await assert.rejects(runProcess(join(root, 'missing-node'), [], options), /ENOENT/);
});

test('overall timeout terminates the runner and its descendants', async t => {
  const root = await directory(t);
  const script = join(root, 'hang.mjs');
  const pids = join(root, 'pids.json');
  await writeFile(script, `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    writeFileSync(process.argv[2], JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000);
  `);
  await assert.rejects(runProcess(process.execPath, [script, pids],
    { timeoutMs: 1500, label: 'hanging fixture', stdio: 'ignore' }), /timed out/);
  for (const pid of JSON.parse(await readFile(pids, 'utf8'))) {
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(pid, 0); } catch (error) { assert.equal(error.code, 'ESRCH'); break; }
      await delay(20);
    }
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `Process ${pid} must be gone`);
  }
});

test('host exit rejects pending requests without waiting for the request deadline', async t => {
  const root = await directory(t);
  const host = join(root, 'exit.mjs');
  await writeFile(host, "process.stdin.once('data', () => process.exit(9));");
  const worker = createWorker({ executable: process.execPath, host, root, env: process.env });
  await assert.rejects(worker.request({ action: 'status' }), /exited with 9/);
  await assert.rejects(worker.close(), /exited with 9/);
});

test('request timeout still permits bounded, idempotent host cleanup', async t => {
  const root = await directory(t);
  const host = join(root, 'idle.mjs');
  await writeFile(host, "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));");
  const worker = createWorker({ executable: process.execPath, host, root, env: process.env, requestTimeoutMs: 200 });
  await assert.rejects(worker.request({ action: 'status' }), /Timed out: status/);
  await worker.close();
  await worker.close();
});
