import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
import { CliRuntime } from './runtime';
import { CliService } from './service';
import type { CliChange, CliRequest } from '../../../shared/cli-gui/types';
import { coalesceCliChanges } from '../../../shared/cli-gui/changes';
import { MAX_FRAME_BYTES, workerFrame } from './workerFrame';

const root = process.argv[2];
if (!root || !isAbsolute(root) || Number(process.versions.node.split('.')[0]) < 22) process.exit(1);
const write = (value: object) => process.stdout.write(workerFrame(value));
let timer: ReturnType<typeof setTimeout> | undefined;
let changes: CliChange[] = [];
const changed = (change: CliChange = { runtime: true }) => {
  changes.push(change);
  timer ??= setTimeout(() => {
    timer = undefined;
    write({ event: true, params: { changes: coalesceCliChanges(changes) } });
    changes = [];
  }, 150);
};
const service = new CliService(new CliRuntime(root, () => changed({ runtime: true })), changed);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

async function execute(line: string) {
  // Match the control-channel envelope: images are prepared before entering this worker.
  if (line.length > MAX_FRAME_BYTES) return;
  let id: unknown;
  try {
    const frame = JSON.parse(line) as { id: number; request: CliRequest };
    id = frame.id;
    if (!Number.isSafeInteger(id)) return;
    const data = await service.request(frame.request);
    write({ id, data });
  } catch (error) {
    console.error('CLI request failed', error);
    const code = error instanceof Error && (/^client\.cliGui\.[a-zA-Z]+$/.test(error.message)
      || ['client.officialAccounts.storageFailed', 'client.officialAccounts.invalidRequest'].includes(error.message))
      ? error.message : 'client.cliGui.requestFailed';
    write({ id, error: code });
  }
}
input.on('line', line => { void execute(line); });
input.once('close', () => {
  if (timer) clearTimeout(timer);
  const deadline = setTimeout(() => process.exit(1), 10_000);
  void service.close().then(() => { clearTimeout(deadline); process.exit(0); }, error => {
    console.error('CLI shutdown failed', error); process.exit(1);
  });
});
