import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(desktop, '../../.codex-tmp/cli-gui-smoke');
const bin = resolve(root, 'fixture-bin');
const executable = process.platform === 'win32'
  ? resolve(desktop, 'src-tauri/resources/desktop-service/node.exe') : process.execPath;
const script = fileURLToPath(new URL('./fixtures/cli-gui-acp.mjs', import.meta.url));
const proxy = createServer((request, response) => {
  assert.equal(request.headers.authorization, 'Bearer acp-test-account');
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ models: [{ slug: 'fixture', display_name: 'Account fixture', visibility: 'list' }] }));
});
await new Promise(resolveListen => proxy.listen(0, '127.0.0.1', resolveListen));
await mkdir(bin, { recursive: true });
const marker = resolve(root, 'runtime/remoteai-ready.json');
if (!existsSync(marker)) {
  await mkdir(resolve(root, 'runtime'), { recursive: true });
  const helper = resolve(root, 'install-helper.mjs');
  await build({ entryPoints: [resolve(desktop, 'cli-gui/npm.ts')], outfile: helper,
    bundle: true, platform: 'node', format: 'esm' });
  const { installPackages } = await import(pathToFileURL(helper).href);
  await installPackages(root, ['@getpaseo/server@0.15.4']);
  await writeFile(marker, JSON.stringify({ version: '0.15.4' }));
}
await writeFile(resolve(bin, process.platform === 'win32' ? 'gemini.cmd' : 'gemini'), process.platform === 'win32'
  ? `@"${executable}" "${script}" %*\r\n` : `#!/bin/sh\nexec '${executable}' '${script}' "$@"\n`, { mode: 0o755 });

function worker(home = root) {
  const child = spawn(executable, [resolve(desktop, 'src-tauri/resources/cli-gui/host.mjs'), home],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`, CLI_FIXTURE_HOME: resolve(root, 'fixture-history'),
      REMOTEAI_GUI_PROXY_URL: `http://127.0.0.1:${proxy.address().port}/v1`,
      REMOTEAI_GUI_PROXY_TOKEN: 'acp-test-account' } });
  const pending = new Map();
  let id = 0;
  createInterface({ input: child.stdout }).on('line', line => {
    const frame = JSON.parse(line);
    if (frame.id) pending.get(frame.id)?.(frame);
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  return { close: async () => { child.stdin.end(); await exited; },
    request: async request => {
      const current = ++id;
      let timer;
      try {
        const response = new Promise(resolve => pending.set(current, resolve));
        child.stdin.write(`${JSON.stringify({ id: current, request: { engine: 'gemini', ...request } })}\n`);
        const frame = await Promise.race([response, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out: ${request.action}`)), 55_000);
        })]);
        if (frame.error) throw new Error(frame.error);
        return frame.data;
      } finally { clearTimeout(timer); pending.delete(current); }
    } };
}
async function waitFor(read, predicate) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(250);
  }
  throw new Error('Fixture state did not settle');
}

let host = worker(resolve(root, 'unprepared'));
try {
  const initial = await host.request({ action: 'status' });
  assert.equal(initial.status, 'missing');
  assert.equal(initial.cliVersion, '0.32.1-fixture');
  await host.close(); host = worker();
  const status = await host.request({ action: 'status' });
  assert.equal(status.status, 'ready', 'Run smoke-cli-gui.mjs to prepare the pinned runtime first');
  assert.equal(status.cliVersion, '0.32.1-fixture');
  const catalog = await host.request({ action: 'catalog', cwd: root });
  assert.equal(catalog.status, 'ready');
  assert.ok(catalog.models.some(model => model.id === 'fixture'));
  const session = await host.request({ action: 'create', cwd: root, model: 'fixture', mode: 'default' });
  await host.request({ action: 'send', id: session.id, text: 'Exercise approval', messageId: crypto.randomUUID() });
  const read = () => host.request({ action: 'read', id: session.id });
  const waiting = await waitFor(read, page => page.session.permissions.length > 0);
  const permission = waiting.session.permissions[0];
  const action = permission.actions.find(option => option.behavior === 'allow');
  await host.request({ action: 'approve', id: session.id, permissionId: permission.id, actionId: action.id });
  await waitFor(read, page => page.session.status !== 'running'
    && page.entries.some(entry => entry.text.includes('Approved fixture response.')));
  await host.close(); host = worker();
  const restored = await read();
  assert.ok(restored.entries.some(entry => entry.text.includes('Approved fixture response.')));
  await host.request({ action: 'send', id: session.id, text: 'Exercise cancellation', messageId: crypto.randomUUID() });
  await waitFor(read, page => page.session.permissions.length > 0);
  await host.request({ action: 'stop', id: session.id });
  await waitFor(read, page => !page.session.permissions.length && page.session.status !== 'running');
  await host.request({ action: 'archive', id: session.id });
  const archived = await host.request({ action: 'list', archived: true });
  assert.ok(archived.some(item => item.id === session.id));
  assert.ok((await read()).entries.length > 0);
  console.log('Real Paseo + ACP: version, model discovery, messages, approval, restart history, stop and archive passed.');
} finally { await host.close(); await new Promise(resolveClose => proxy.close(resolveClose)); }
