import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { upstream } from './common.mjs';

const home = await mkdtemp(join(tmpdir(), 'remoteai-cua-smoke-'));
const environment = { ...process.env, CUA_DRIVER_RS_HOME: home,
  CUA_DRIVER_PERMISSION_MODE: 'standard', CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' };
delete environment.CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS;
const child = spawn(resolve(process.argv[2]), ['mcp', '--direct'], {
  windowsHide: true, env: environment, stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
let sequence = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const response = JSON.parse(line);
  pending.get(response.id)?.(response);
});
child.stderr.on('data', () => {}); // Keep diagnostics separate from the JSON-RPC stream.
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, response => { clearTimeout(timer); pending.delete(id); resolve(response); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
try {
  const initialized = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'remoteai-cua-release-test', version: '1.0.0' } });
  assert.equal(initialized.result?.serverInfo.version, upstream.version);
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const listed = await rpc('tools/list', {});
  for (const name of ['launch_app', 'get_window_state', 'run_steps', 'run_script', 'check_permissions']) {
    assert.ok(listed.result?.tools.some(tool => tool.name === name), `Missing ${name}`);
  }
  console.log(`MCP ${upstream.version}: ${listed.result.tools.length} tools available in standard mode`);
  if (process.env.CUA_NATIVE_LAUNCH_TEST === '1') {
    const { nativeLaunch } = await import('../test/native-launch.mjs');
    await nativeLaunch(rpc, child.pid);
  }
} finally {
  const exited = once(child, 'exit');
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 10000);
  await exited;
  clearTimeout(timer);
  lines.close();
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
