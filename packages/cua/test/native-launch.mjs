import assert from 'node:assert/strict';
import { join } from 'node:path';
import { directory, run } from '../scripts/common.mjs';

function structured(reply) {
  assert.ok(!reply.error && !reply.result?.isError, JSON.stringify(reply));
  const result = reply.result.structuredContent;
  if (result) return result;
  const text = reply.result.content?.find(item => item.type === 'text')?.text;
  try { return JSON.parse(text); } catch { return { text }; }
}

// Explicit opt-in: opens only Character Map instances and closes only newly created PIDs.
export async function nativeLaunch(rpc, driverPid) {
  assert.equal(process.platform, 'win32');
  const before = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-Process -Name charmap -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0'],
  { stdio: 'pipe' }).split(/\s+/).map(Number);
  const launched = [];
  try {
    for (const start_minimized of [true, false]) {
      const result = structured(await rpc('tools/call', { name: 'launch_app', arguments: {
        path: join(process.env.SystemRoot, 'System32/charmap.exe'), start_minimized,
      } }));
      assert.ok(result.pid > 0 && !before.includes(result.pid), JSON.stringify(result));
      launched.push(result.pid);
      console.log(`${start_minimized ? 'direct' : 'shell'} launch: pid=${result.pid}`);
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
        join(directory, 'test/verify-token.ps1'), '-DriverPid', String(driverPid), '-AppPid', String(result.pid)]);
      const windows = structured(await rpc('tools/call', { name: 'list_windows', arguments: { pid: result.pid } }));
      assert.ok(Array.isArray(windows.windows) && windows.windows.length > 0, JSON.stringify(windows));
      const state = structured(await rpc('tools/call', { name: 'get_window_state', arguments: {
        pid: result.pid, window_id: windows.windows[0].window_id,
      } }));
      assert.ok(state.snapshot_id, 'Launched window must publish a usable UI snapshot');
      console.log('Launched window read successfully');
    }
  } finally {
    for (const pid of launched) {
      try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
}
