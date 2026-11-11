import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
import { CliRuntime } from './runtime';
import { CliService } from './service';
import type { CliRequest } from '../../../shared/cli-gui/types';

const root = process.argv[2];
if (!root || !isAbsolute(root) || Number(process.versions.node.split('.')[0]) < 22) process.exit(1);
const write = (value: object) => process.stdout.write(`${JSON.stringify(value)}\n`);
let timer: ReturnType<typeof setTimeout> | undefined;
const changed = () => { timer ??= setTimeout(() => { timer = undefined; write({ event: true }); }, 150); };
const service = new CliService(new CliRuntime(root, changed), changed);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

async function execute(line: string) {
  if (line.length > 2_000_000) return;
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
