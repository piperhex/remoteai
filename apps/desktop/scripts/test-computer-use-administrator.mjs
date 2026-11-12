// Opt-in interactive Windows check. UAC consent stays with the user; no system policy changes.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const executable = path.join(repository, 'apps/desktop/src-tauri/target/debug/csw.exe');
const source = process.env.CSW_CUA_DRIVER_DIRECTORY;
const target = `windows-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`;
const output = path.join(repository, '.codex-tmp/cua-administrator/interactive');
if (process.platform !== 'win32' || !source || process.env.CSW_CUA_ADMIN_TEST !== '1') {
  throw new Error('Set CSW_CUA_ADMIN_TEST=1 and CSW_CUA_DRIVER_DIRECTORY for this interactive Windows test.');
}
await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(path.join(output, 'home-'));
const children = [];
const environment = { ...process.env, CSW_COMPUTER_USE_TEST_ROOT: root };

function start(argument) {
  const child = spawn(executable, [argument], { env: environment, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  children.push(child);
  return child;
}

function responses(child) {
  const queue = [], pending = [];
  createInterface({ input: child.stdout }).on('line', line => {
    const value = JSON.parse(line);
    if (pending.length) pending.shift()(value); else queue.push(value);
  });
  return () => new Promise((resolve, reject) => {
    if (queue.length) return resolve(queue.shift());
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the fixture')), 180_000);
    pending.push(value => { clearTimeout(timer); resolve(value); });
  });
}

async function fixture(name) {
  const home = path.join(root, name);
  const id = createHash('sha256').update(home.replaceAll('\\', '/').toLowerCase()).digest('hex');
  const record = { home, enabled: true, generation: randomUUID(), administrator: false };
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(path.join(root, 'homes'), { recursive: true });
  await fs.writeFile(path.join(root, 'homes', `${id}.json`), JSON.stringify(record));
  await fs.writeFile(path.join(home, 'config.toml'), `[mcp_servers.codex_switch_computer_use]\n`
    + `command = ${JSON.stringify(executable)}\nargs = ["--computer-use-mcp=${id}"]\n`
    + 'enabled = true\nstartup_timeout_sec = 30\ntool_timeout_sec = 150\n');
  return id;
}

async function mcp(id) {
  const child = start(`--computer-use-mcp=${id}`), read = responses(child);
  let counter = 0;
  const call = async (method, params) => {
    const id = ++counter;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    for (;;) { const reply = await read(); if (reply.id === id) return reply.result; }
  };
  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'administrator-regression', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return { child, call: (name, args = {}) => call('tools/call', { name, arguments: args }) };
}

async function ended(child) {
  if (child.exitCode !== null) return;
  await Promise.race([once(child, 'exit'), delay(10_000).then(() => { throw new Error('Session was not revoked'); })]);
}

function data(result) {
  return result.structuredContent ?? JSON.parse(result.content.find(part => part.type === 'text').text);
}

async function assertGone(pid) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const listed = execFileSync(path.join(process.env.WINDIR, 'System32/tasklist.exe'),
      ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], { windowsHide: true, encoding: 'utf8' });
    if (!listed.includes(`"${pid}"`)) return;
    await delay(100);
  }
  throw new Error(`Broker ${pid} survived its owner or grant`);
}

let targetPid;
try {
  await fs.cp(source, path.join(root, `0.37.0-remoteai.4-${target}`), { recursive: true });
  const id = await fixture('authorized'), other = await fixture('ordinary');
  const owner = start(`--computer-use-authorization-probe=${id}`), readOwner = responses(owner);
  const request = async command => { owner.stdin.write(`${command}\n`); return readOwner(); };
  assert.equal((await request('prepare')).status.attempted, false);
  console.log('Awaiting immediate UAC consent after opting in for the isolated CUA broker.');
  const enabled = await request('enable');
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  assert.equal(enabled.status.requested, true);
  assert.equal(enabled.status.active, true);
  assert.equal(enabled.status.attempted, true);
  const granted = await request('prepare');
  assert.equal(granted.ok, true, JSON.stringify(granted));
  assert.equal(granted.status.active, true);
  const leasePath = path.join(root, 'administrator', `${id}.json`);
  const lease = JSON.parse(await fs.readFile(leasePath, 'utf8'));
  assert.equal((await request('prepare')).status.active, true);
  assert.equal(JSON.parse(await fs.readFile(leasePath, 'utf8')).broker, lease.broker);
  const elevated = await mcp(id), ordinary = await mcp(other);
  assert.equal(data(await elevated.call('check_permissions')).elevated, true);
  assert.equal(data(await ordinary.call('check_permissions')).elevated, false);
  console.log('PASS: CUA is elevated; the other Home stays ordinary; repeat entry reuses the authorization.');

  const fixtureExe = path.join(output, `administrator-window-${randomUUID()}.exe`);
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  execFileSync(compiler, ['/nologo', '/target:winexe', `/out:${fixtureExe}`, '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll', path.join(repository, 'apps/desktop/e2e/computer-use-admin-fixture.cs')], { windowsHide: true });
  const previousPid = process.env.CSW_CUA_STALE_TEST_PID;
  if (previousPid) assert.match(previousPid, /^\d+$/);
  const fixtureArgs = ['-NoProfile', '-File',
    path.join(repository, 'apps/desktop/scripts/start-cua-administrator-fixture.ps1'),
    '-FixturePath', fixtureExe, '-FixtureOwnerId', String(process.pid)];
  if (previousPid) fixtureArgs.push('-PreviousFixtureId', previousPid);
  console.log('Awaiting UAC consent for the disposable test window.');
  targetPid = Number(execFileSync('powershell.exe', fixtureArgs,
  { windowsHide: true, encoding: 'utf8' }).trim());
  assert.ok(targetPid > 0);
  let window;
  for (let attempt = 0; attempt < 20 && !window; attempt++) {
    const windows = data(await elevated.call('list_windows', { pid: targetPid }));
    window = (windows.windows ?? windows)[0];
    if (!window) await delay(250);
  }
  assert.ok(window, 'The administrator fixture did not create its visible window.');
  const windowId = window.window_id;
  assert.ok(windowId);
  const args = { pid: targetPid, window_id: windowId, key: 'F6' };
  const refused = await ordinary.call('run_steps', { steps: [{ tool: 'press_key', args }] });
  assert.equal(data(refused).ok, false, 'Ordinary CUA must refuse input to the administrator window.');
  assert.match(JSON.stringify(refused), /UIPI|integrity|permission|denied|refused/i);
  await elevated.call('get_window_state', { pid: targetPid, window_id: windowId });
  const delivered = await elevated.call('run_steps', { steps: [{ tool: 'press_key', args }], observe: {} });
  assert.equal(data(delivered).ok, true, JSON.stringify(delivered).slice(0, 1500));
  const verified = await elevated.call('verify_state', { pid: targetPid, window_id: windowId,
    expect: [{ element: { selector: { label_contains: 'CUA input confirmed' }, exists: true } }],
    timeout_ms: 3000, include_screenshot: true });
  assert.equal(data(verified).status, 'satisfied', JSON.stringify(verified).slice(0, 1500));
  const screenshot = verified.content.find(part => part.type === 'image');
  if (screenshot) await fs.writeFile(path.join(output, 'windows-administrator-input-confirmed.png'),
    Buffer.from(screenshot.data, 'base64'));
  await elevated.call('run_steps', {
    steps: [{ tool: 'press_key', args: { pid: targetPid, window_id: windowId, key: 'escape' } }],
  });
  await assertGone(targetPid);
  targetPid = undefined;

  assert.equal((await request('revoke')).status.active, false);
  await ended(elevated.child);
  await assertGone(lease.broker);
  assert.equal(data(await ordinary.call('check_permissions')).elevated, false);
  console.log('Revocation and Home isolation passed. Awaiting UAC to verify owner-exit cleanup.');
  assert.equal((await request('enable')).status.active, true);
  const lastLease = JSON.parse(await fs.readFile(leasePath, 'utf8'));
  const last = await mcp(id);
  assert.equal(data(await last.call('check_permissions')).elevated, true);
  owner.stdin.end();
  await ended(owner);
  await ended(last.child);
  await assertGone(lastLease.broker);
  console.log(`PASS: opt-in, one prompt per launch, elevated input, isolation, revocation, owner exit. Evidence: ${output}`);
} finally {
  // Closing only this test's owners revokes its grants; never touch production homes or unrelated CUA processes.
  for (const child of children) child.stdin.end();
  await Promise.all(children.map(child => ended(child).catch(() => child.kill())));
  if (targetPid) console.error(`The test window (PID ${targetPid}) will close when this test process exits.`);
}
