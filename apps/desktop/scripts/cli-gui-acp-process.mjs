import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const shutdownTimeoutMs = 15_000;

function completion(child) {
  return new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

export async function terminateTree(child, processGroup = true) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      await execute('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: shutdownTimeoutMs });
    } catch (error) {
      // A graceful exit may win the race with taskkill. Other failures must remain visible.
      if (child.exitCode === null && child.signalCode === null) throw error;
    }
  } else {
    try { process.kill(processGroup ? -child.pid : child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

export async function runProcess(executable, args, { timeoutMs, label, stdio = 'inherit' }) {
  const child = spawn(executable, args, { windowsHide: true, detached: process.platform !== 'win32', stdio });
  const exited = completion(child);
  let timer;
  try {
    const result = await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
    if (result.error) throw result.error;
    if (result.code !== 0) throw new Error(`${label} exited with ${result.code ?? result.signal}`);
  } finally { clearTimeout(timer); await terminateTree(child); }
}

async function closeWorker(child, exited) {
  child.stdin.end();
  let timer;
  try {
    const result = await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('ACP host shutdown timed out')), shutdownTimeoutMs);
    })]);
    if (result.error) throw result.error;
    if (result.code !== 0) throw new Error(`ACP host shutdown exited with ${result.code ?? result.signal}`);
  } finally { clearTimeout(timer); await terminateTree(child, false); }
}

export function createWorker({ executable, host, root, env, requestTimeoutMs = 55_000 }) {
  // Keep descendants in the scenario's process group so its overall deadline also terminates them on Unix.
  const child = spawn(executable, [host, root], { windowsHide: true,
    stdio: ['pipe', 'pipe', 'inherit'], env });
  const exited = completion(child);
  const pending = new Map();
  let failure;
  let closing;
  let nextId = 0;
  const fail = error => {
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const frame = JSON.parse(line);
      if (frame.id) pending.get(frame.id)?.resolve(frame);
    } catch (error) { fail(new Error('Invalid JSON from ACP host', { cause: error })); }
  });
  child.stdin.on('error', fail);
  void exited.then(result => fail(result.error ?? new Error(`ACP host exited with ${result.code ?? result.signal}`)));
  return {
    close() {
      return closing ??= closeWorker(child, exited);
    },
    async request(request) {
      if (failure) throw failure;
      const id = ++nextId;
      let timer;
      try {
        const response = new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          timer = setTimeout(() => reject(new Error(`Timed out: ${request.action}`)), requestTimeoutMs);
        });
        child.stdin.write(`${JSON.stringify({ id, request: { engine: 'gemini', ...request } })}\n`);
        const frame = await response;
        if (frame.error) throw new Error(frame.error);
        return frame.data;
      } finally { clearTimeout(timer); pending.delete(id); }
    },
  };
}
