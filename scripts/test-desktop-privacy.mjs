import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

async function scenario(commands, expected, retryLock = false) {
  const child = spawn(process.argv[2], [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(retryLock ? { PRIVACY_TEST_LOCK_RETRY: '1' } : {}) } });
  let log = '';
  child.stderr.on('data', data => { log += data; });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const ended = once(child, 'exit');
  assert.equal((await lines.next()).value, 'test-display');
  for (const command of commands) {
    if (command === 'EOF') { child.stdin.end(); break; }
    child.stdin.write(`${command}\n`);
    if (command === 'commit' || command === 'disable') assert.equal((await lines.next()).value, 'ok');
  }
  const timer = setTimeout(() => child.kill(), 5000);
  try { assert.equal((await ended)[0], retryLock ? 1 : 0); } finally { clearTimeout(timer); }
  assert.deepEqual(log.trim().split(/\r?\n/).filter(line => !line.startsWith('privacy helper:')), expected);
}
await scenario(['EOF'], ['prepare', 'restore']);
await scenario(['commit', 'disable'], ['prepare', 'disconnect', 'restore']);
await scenario(['commit', 'EOF'], ['prepare', 'disconnect', 'lock-confirmed', 'restore']);
await scenario(['commit'], ['prepare', 'disconnect', 'lock-confirmed', 'restore']);
await scenario(['commit', 'finish'], ['prepare', 'disconnect', 'lock-confirmed', 'restore']);
await scenario(['commit', 'EOF'], ['prepare', 'disconnect', 'lock-pending', 'lock-confirmed', 'restore'], true);
console.log('Privacy guardian: rollback, disable, EOF, timeout, lock retry and finish passed.');
