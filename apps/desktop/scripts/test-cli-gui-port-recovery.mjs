import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

// Usage: node scripts/test-cli-gui-port-recovery.mjs <prepared-runtime-directory>
// Only the installed server/dependencies are reused; all services, ports and mutable state are isolated.
const installation = resolve(process.argv[2] ?? '');
const serverPackage = join(installation, 'node_modules/@getpaseo/server');
const manifest = JSON.parse(await readFile(join(serverPackage, 'package.json'), 'utf8'));
assert.equal(manifest.version, '0.15.4');
const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'remoteai-real-port-recovery-'));
const savedEnv = { url: process.env.REMOTEAI_GUI_PROXY_URL, token: process.env.REMOTEAI_GUI_PROXY_TOKEN };
const proxy = createServer((request, response) => {
  assert.equal(request.headers.authorization, 'Bearer isolated-upstream');
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ models: [{ slug: 'fixture', display_name: 'Fixture', visibility: 'list' }] }));
});
let strangerCalls = 0;
const stranger = createServer((request, response) => { strangerCalls++; response.writeHead(418).end(); });
const listen = (server, port) => new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => { server.off('error', reject); accept(); });
});
const close = server => new Promise(accept => { server.closeAllConnections(); server.close(accept); });
let service;

async function waitForReply(id, text) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const page = await service.request({ engine: 'gemini', action: 'read', id });
    if (page.entries.some(entry => entry.role === 'error')) throw new Error(JSON.stringify(page));
    if (page.session.status !== 'running' && page.entries.some(entry => entry.text.includes(text))) return page;
    await delay(100);
  }
  throw new Error('Old session did not continue through the new bridge');
}

async function snapshot(id) {
  const directory = join(root, 'paseo/agents');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(directory, entry.name, `${id}.json`);
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('Missing persisted session');
}

try {
  const packageLink = join(root, 'runtime/node_modules/@getpaseo/server');
  await mkdir(packageLink, { recursive: true });
  // Re-export the installed public entry without linking directories across Windows drives.
  const serverUrl = pathToFileURL(join(serverPackage, manifest.exports['.'].default)).href;
  await writeFile(join(packageLink, 'package.json'), JSON.stringify({ version: manifest.version,
    type: 'module', exports: { '.': { default: './server.mjs' } } }));
  await writeFile(join(packageLink, 'server.mjs'), `export * from ${JSON.stringify(serverUrl)};\n`);
  const fixturePackage = join(root, 'runtime/node_modules/@google/gemini-cli');
  await mkdir(fixturePackage, { recursive: true });
  await writeFile(join(fixturePackage, 'package.json'), JSON.stringify({ bin: { gemini: 'fixture.mjs' } }));
  const fixtureUrl = pathToFileURL(join(desktop, 'scripts/fixtures/cli-gui-port-acp.mjs')).href;
  await writeFile(join(fixturePackage, 'fixture.mjs'), `import ${JSON.stringify(fixtureUrl)};\n`);
  await writeFile(join(root, 'runtime/remoteai-ready.json'), JSON.stringify({ version: manifest.version }));
  assert.equal(JSON.parse(await readFile(join(packageLink, 'package.json'), 'utf8')).version, manifest.version);
  const bundle = join(root, 'port-test.mjs');
  await build({ stdin: { contents: "export { CliRuntime } from './cli-gui/runtime';"
    + "export { CliService } from './cli-gui/service';", resolveDir: desktop }, outfile: bundle,
    bundle: true, platform: 'node', format: 'esm',
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
  const { CliRuntime, CliService } = await import(pathToFileURL(bundle).href);
  const worker = () => new CliService(new CliRuntime(root, () => {}), () => {});
  await listen(proxy, 0);
  process.env.REMOTEAI_GUI_PROXY_URL = `http://127.0.0.1:${proxy.address().port}`;
  process.env.REMOTEAI_GUI_PROXY_TOKEN = 'isolated-upstream';
  service = worker();
  assert.equal(await service.runtime.installed(), true, 'Isolated runtime must be installed');
  const session = await service.request({ engine: 'gemini', action: 'create', cwd: root, model: 'fixture' });
  await service.request({ engine: 'gemini', action: 'send', id: session.id, text: 'before restart' });
  await waitForReply(session.id, 'Bridge verified: before restart');
  await service.close();
  const before = await snapshot(session.id);
  const old = JSON.parse(await readFile(join(root, 'bridge.json'), 'utf8'));
  await listen(stranger, old.port);
  service = worker();
  const restored = await service.request({ engine: 'gemini', action: 'read', id: session.id });
  assert.ok(restored.entries.some(entry => entry.text.includes('Bridge verified: before restart')));
  const migrated = JSON.parse(await readFile(join(root, 'bridge.json'), 'utf8'));
  assert.notEqual(migrated.port, old.port);
  assert.equal(migrated.token, old.token);
  const after = await snapshot(session.id);
  assert.equal(after.persistence.sessionId, before.persistence.sessionId);
  assert.equal(after.labels.remoteaiRoute, before.labels.remoteaiRoute);
  assert.equal(new URL(after.launchEnv.GOOGLE_GEMINI_BASE_URL).port, String(migrated.port));
  await service.request({ engine: 'gemini', action: 'send', id: session.id, text: 'after migration' });
  await waitForReply(session.id, 'Bridge verified: after migration');
  assert.equal(strangerCalls, 0, 'No requests or credentials may reach the occupied old port');
  assert.equal(stranger.listening, true);
  await service.close();
  service = worker();
  await service.request({ engine: 'gemini', action: 'send', id: session.id, text: 'normal restart' });
  await waitForReply(session.id, 'Bridge verified: normal restart');
  assert.equal(JSON.parse(await readFile(join(root, 'bridge.json'), 'utf8')).port, migrated.port);
  assert.equal(strangerCalls, 0);
  console.log('PASS: real Paseo restart, occupied saved port, old-session load/send, history, credentials and port reuse.');
} finally {
  await service?.close();
  await close(stranger); await close(proxy);
  if (savedEnv.url === undefined) delete process.env.REMOTEAI_GUI_PROXY_URL;
  else process.env.REMOTEAI_GUI_PROXY_URL = savedEnv.url;
  if (savedEnv.token === undefined) delete process.env.REMOTEAI_GUI_PROXY_TOKEN;
  else process.env.REMOTEAI_GUI_PROXY_TOKEN = savedEnv.token;
  await rm(root, { recursive: true, force: true });
}
