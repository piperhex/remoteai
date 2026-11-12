// Uses the installed Codex CLI and isolated plugin records; never edits the user's Home or grants.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const [executable, codex, cua, artifacts] = process.argv.slice(2);
assert.ok(executable && codex && cua && artifacts, 'Pass the debug app, Codex, CUA package and output directory.');
await fs.mkdir(artifacts, { recursive: true });
const root = await fs.mkdtemp(path.join(artifacts, 'host-'));
const home = path.join(root, 'home');
await fs.mkdir(home);
const id = createHash('sha256').update(home.replaceAll('\\', '/').toLowerCase()).digest('hex');
const roots = { chrome: path.join(root, 'chrome'), computer: path.join(root, 'computer'), remote: path.join(root, 'remote') };
for (const [name, folder] of Object.entries(roots)) {
  const records = path.join(folder, name === 'chrome' ? 'clients' : 'homes');
  await fs.mkdir(records, { recursive: true });
  await fs.writeFile(path.join(records, `${id}.json`), JSON.stringify({ home, enabled: true,
    token: randomUUID(), generation: randomUUID(), administrator: false }));
}
await fs.cp(cua, path.join(roots.computer, path.basename(cua)), { recursive: true });
const definitions = [
  ['codex_switch_chrome', '--chrome-mcp=', 10, 150],
  ['codex_switch_computer_use', '--computer-use-mcp=', 30, 150],
  ['codex_switch_remote_command', '--remote-command-mcp=', 10, 100],
];
const config = definitions.map(([name, argument, startup, timeout]) => `[mcp_servers.${name}]\n`
  + `command = ${JSON.stringify(executable)}\nargs = ["${argument}${id}"]\nenabled = true\n`
  + `env_vars = ["REMOTEAI_PLUGIN_HOST"]\nstartup_timeout_sec = ${startup}\ntool_timeout_sec = ${timeout}\n`).join('\n');
await fs.writeFile(path.join(home, 'config.toml'), config);
await standalone();
await standalone(JSON.stringify({ channel: randomUUID(), owner: process.pid,
  arguments: definitions.map(([, prefix]) => `${prefix}${'0'.repeat(64)}`) }));

async function standalone(endpoint) {
  const env = { ...process.env, CSW_CHROME_TEST_ROOT: roots.chrome };
  delete env.REMOTEAI_PLUGIN_HOST;
  if (endpoint) env.REMOTEAI_PLUGIN_HOST = endpoint;
  const worker = spawn(executable, [`--chrome-mcp=${id}`], { env, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '';
  worker.stdout.on('data', bytes => { output += bytes.toString(); });
  worker.stderr.on('data', bytes => { error += bytes.toString(); });
  const timer = setTimeout(() => worker.kill(), 10_000);
  try {
    const closed = once(worker, 'close');
    worker.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
    const [code] = await closed;
    assert.equal(code, 0, error);
    assert.ok(JSON.parse(output).result.tools.length);
  } finally { clearTimeout(timer); }
  console.log(`PASS: standalone CLI works ${endpoint ? 'with another Home\'s inherited host' : 'without a GUI host'}.`);
}

const child = spawn(executable, [`--plugin-host-probe=${home}`, codex], { windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CODEX_HOME: home,
    // Simulate starting the GUI from a terminal that inherited an older GUI's host variable.
    REMOTEAI_PLUGIN_HOST: JSON.stringify({ channel: randomUUID(), owner: process.pid,
      arguments: definitions.map(([, prefix]) => `${prefix}${id}`) }),
    CSW_CHROME_TEST_ROOT: roots.chrome, CSW_COMPUTER_USE_TEST_ROOT: roots.computer,
    CSW_REMOTE_COMMAND_TEST_ROOT: roots.remote },
});
let counter = 0, diagnostics = '';
const pending = new Map();
createInterface({ input: child.stdout }).on('line', line => {
  const message = JSON.parse(line);
  const handler = pending.get(message.id);
  if (handler) { pending.delete(message.id); handler(message); }
});
child.stderr.on('data', bytes => { diagnostics += bytes.toString(); });
async function request(method, params) {
  const id = ++counter;
  const response = new Promise(resolve => pending.set(id, resolve));
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  let timer;
  try {
    const reply = await Promise.race([response, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${method} timed out: ${diagnostics}`)), 40_000);
    })]);
    assert.ok(reply.result, JSON.stringify(reply));
    return reply.result;
  } finally { clearTimeout(timer); pending.delete(id); }
}
function processes() {
  const code = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress';
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code],
    { windowsHide: true, encoding: 'utf8' }));
}
let workers = [], descendants = [], engine;
try {
  await request('initialize', { clientInfo: { name: 'plugin-host-test', version: '1' },
    capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
  const status = await request('mcpServerStatus/list', {});
  for (const [name] of definitions) {
    const server = status.data.find(server => server.name === name);
    assert.ok(server && Object.keys(server.tools ?? {}).length, `${name}: ${JSON.stringify(server)}\n${diagnostics}`);
  }
  const thread = await request('thread/start', { cwd: home, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
  const call = (server, tool, args = {}) => request('mcpServer/tool/call', {
    threadId: thread.thread.id, server, tool, arguments: args,
  });
  const permission = await call('codex_switch_computer_use', 'check_permissions');
  assert.notEqual(permission.isError, true, JSON.stringify(permission));
  const browsers = await call('codex_switch_chrome', 'browser_list');
  assert.notEqual(browsers.isError, true, JSON.stringify(browsers));
  const remote = await call('codex_switch_remote_command', 'remote_list_computers');
  assert.equal(remote.isError, true, 'The isolated fixture has no signed-in remote bridge.');
  await fs.writeFile(path.join(home, 'config.toml'), config.replace('enabled = true', 'enabled = false'));
  await request('config/mcpServer/reload', {});
  const disabled = await request('mcpServerStatus/list', {});
  assert.equal(Object.keys(disabled.data.find(server => server.name === 'codex_switch_chrome')?.tools ?? {}).length, 0);
  await fs.writeFile(path.join(home, 'config.toml'), config);
  await request('config/mcpServer/reload', {});
  const restored = await request('mcpServerStatus/list', {});
  assert.ok(Object.keys(restored.data.find(server => server.name === 'codex_switch_chrome')?.tools ?? {}).length);
  await call('codex_switch_computer_use', 'check_permissions');
  await call('codex_switch_chrome', 'browser_list');
  console.log('PASS: disabling and re-enabling an installed plugin refreshes the running engine.');
  const before = processes();
  engine = before.find(process => process.ParentProcessId === child.pid && process.Name === 'codex.exe')?.ProcessId;
  workers = before.filter(process => process.ParentProcessId === child.pid && process.Name === 'csw.exe');
  assert.ok(engine && workers.length >= 3, `${JSON.stringify({ engine, workers })}\n${diagnostics}`);
  assert.equal(before.filter(process => process.ParentProcessId === engine && process.Name === 'csw.exe').length, 0);
  descendants = before.filter(process => workers.some(worker => worker.ProcessId === process.ParentProcessId));
  const evidence = { owner: child.pid, engine, workers, descendants, permission, browsers, remote,
    servers: status.data.map(server => ({ name: server.name, tools: Object.keys(server.tools ?? {}).length })) };
  await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`PASS: all three real plugins initialize; CUA and Chrome tools run; workers belong directly to ${child.pid}.`);
  console.log(`Evidence: ${path.join(root, 'evidence.json')}`);
  if (process.env.CSW_PLUGIN_HOST_HOLD === '1') {
    console.log('Keeping the verified fixture available for Task Manager inspection for up to ten minutes.');
    for (let attempt = 0; attempt < 600; attempt++) {
      if (await fs.stat(path.join(root, 'finish')).then(() => true, () => false)) break;
      await delay(1000);
    }
  }
} finally {
  child.stdin.end();
  // Deliberate owner termination verifies job cleanup even when normal application shutdown is skipped.
  child.kill();
  await delay(1500);
  const remaining = processes();
  const tracked = [...workers, ...descendants];
  const survivors = remaining.filter(process => tracked.some(worker => worker.ProcessId === process.ProcessId));
  assert.equal(survivors.length, 0, JSON.stringify(survivors));
  if (engine && remaining.some(process => process.ProcessId === engine)) process.kill(engine);
  await fs.writeFile(path.join(root, 'stderr.log'), diagnostics);
  if (workers.length) {
    await fs.writeFile(path.join(root, 'cleanup.json'), JSON.stringify({ tracked, survivors }, null, 2));
    console.log('PASS: host termination leaves none of its plugin workers or their descendants running.');
  }
}
