import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { delimiter, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWorker } from '../cli-gui-acp-process.mjs';

const [root, mode] = process.argv.slice(2);
assert.ok(root && ['fresh', 'cached'].includes(mode), 'Expected an isolated root and fresh/cached mode');
const { installPackages, RUNTIME_VERSION } = await import(pathToFileURL(resolve(root, 'install-helper.mjs')).href);
const bin = resolve(root, 'fixture-bin');
const marker = resolve(root, 'runtime/remoteai-ready.json');
const manifestPath = resolve(root, 'runtime/node_modules/@getpaseo/server/package.json');
const script = fileURLToPath(new URL('./cli-gui-acp.mjs', import.meta.url));

async function prepareRuntime() {
  if (mode === 'cached') {
    assert.equal(JSON.parse(await readFile(marker, 'utf8')).version, RUNTIME_VERSION);
    console.log(`ACP cached: reusing verified Paseo ${RUNTIME_VERSION}`);
    return;
  }
  for (const name of ['runtime', 'tools', 'npm-cache']) {
    assert.equal(existsSync(resolve(root, name)), false, `Fresh installation must not reuse ${name}`);
  }
  await mkdir(resolve(root, 'runtime'));
  const phases = new Set();
  const downloads = new Set();
  await installPackages(root, [`@getpaseo/server@${RUNTIME_VERSION}`], progress => {
    if (!phases.has(progress.phase)) console.log(`ACP install: ${progress.phase}`);
    phases.add(progress.phase);
    if (progress.phase === 'downloading' && progress.downloaded > 0 && progress.downloaded === progress.total) {
      downloads.add(progress.fileName);
    }
  });
  assert.ok(phases.has('installing'), 'The real npm installer must run');
  assert.ok([...downloads].some(name => /^npm-.*\.tgz$/.test(name)),
    'npm must bootstrap from an empty tools directory');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.version, RUNTIME_VERSION);
  const server = await import(pathToFileURL(resolve(dirname(manifestPath), manifest.exports['.'].default)).href);
  for (const name of ['loadConfig', 'createRootLogger', 'createPaseoDaemon']) {
    assert.equal(typeof server[name], 'function');
  }
  // The fixture supplies Gemini. Record readiness only after the real pinned server installs and loads successfully.
  await writeFile(marker, JSON.stringify({ version: RUNTIME_VERSION }));
  console.log(`ACP fresh: installed and loaded Paseo ${RUNTIME_VERSION}; downloads: ${[...downloads].join(', ')}`);
}

async function prepareExecutable() {
  await mkdir(bin, { recursive: true });
  await writeFile(resolve(bin, process.platform === 'win32' ? 'gemini.cmd' : 'gemini'), process.platform === 'win32'
    ? `@"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`,
  { mode: 0o755 });
}

async function waitFor(read, predicate) {
  const deadline = Date.now() + 20_000;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error('Fixture state did not settle');
}

await prepareExecutable();
const proxy = createServer((request, response) => {
  if (request.headers.authorization !== 'Bearer acp-test-account') { response.writeHead(401).end(); return; }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ models: [{ slug: 'fixture', display_name: 'Account fixture', visibility: 'list' }] }));
});
const worker = () => createWorker({ executable: process.execPath, host: resolve(root, 'host.mjs'), root,
  env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    CLI_FIXTURE_HOME: resolve(root, 'fixture-history'),
    REMOTEAI_GUI_PROXY_URL: `http://127.0.0.1:${proxy.address().port}/v1`,
    REMOTEAI_GUI_PROXY_TOKEN: 'acp-test-account' } });
let host;
try {
  await new Promise((resolveListen, reject) => {
    proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolveListen);
  });
  host = worker();
  const initial = await host.request({ action: 'status' });
  assert.equal(initial.status, mode === 'fresh' ? 'missing' : 'ready');
  assert.equal(initial.cliVersion, '0.32.1-fixture');
  await host.close(); host = undefined;
  const previousMarker = mode === 'cached' ? await stat(marker) : undefined;
  await prepareRuntime();
  host = worker();
  const status = await host.request({ action: 'status' });
  assert.equal(status.status, 'ready', JSON.stringify(status));
  assert.equal(status.version, RUNTIME_VERSION);
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
  if (previousMarker) {
    assert.equal((await stat(marker)).mtimeMs, previousMarker.mtimeMs, 'Cached run must not reinstall');
  }
  console.log(`ACP ${mode}: version, models, approval, restart history, stop and archive passed.`);
} finally {
  try { await host?.close(); }
  finally {
    proxy.closeAllConnections();
    await new Promise(resolveClose => proxy.close(resolveClose));
  }
}
