import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** JSON-line adapter; each concurrent request executes the real spawn_blocking service. */
export function editorService(executable) {
  const child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0;
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    const reply = JSON.parse(line);
    const callback = pending.get(reply.id);
    pending.delete(reply.id);
    if (reply.error) callback?.reject(new Error(reply.error)); else callback?.resolve(reply);
  });
  child.on('exit', code => {
    for (const callback of pending.values()) callback.reject(new Error(`Editor service exited ${code}: ${diagnostics}`));
    pending.clear();
  });
  return {
    child,
    request: request => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    }),
    close: () => child.stdin.end(),
  };
}
