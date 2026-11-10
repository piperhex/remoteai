import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(desktop, '../../.codex-tmp/cli-gui-smoke');
const executable = process.platform === 'win32'
  ? resolve(desktop, 'src-tauri/resources/desktop-service/node.exe') : process.execPath;
const child = spawn(executable, [resolve(desktop, 'src-tauri/resources/cli-gui/host.mjs'), root],
  { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
const pending = new Map();
let nextId = 1;
createInterface({ input: child.stdout }).on('line', line => {
  let frame;
  try { frame = JSON.parse(line); } catch { return; }
  if (frame.id) { pending.get(frame.id)?.(frame); pending.delete(frame.id); }
});
async function request(body) {
  const id = nextId++;
  const result = new Promise(resolve => pending.set(id, resolve));
  child.stdin.write(`${JSON.stringify({ id, request: body })}\n`);
  let timer;
  try {
    return await Promise.race([result, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Worker timed out')), 55_000);
    })]);
  } finally { clearTimeout(timer); }
}
try {
  console.log(await request({ engine: 'claude', action: 'install' }));
  let status;
  do {
    await delay(3000);
    status = await request({ engine: 'claude', action: 'status' });
    console.log(status);
  } while (status.data?.status === 'installing');
  for (const engine of ['claude', 'gemini']) {
    console.log(await request({ engine, action: 'catalog', cwd: root }));
    console.log(await request({ engine, action: 'list', archived: false }));
  }
} finally { child.stdin.end(); }
