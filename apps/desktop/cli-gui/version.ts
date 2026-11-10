import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExternalEngine } from '../../../shared/cli-gui/types';

const execute = promisify(execFile);
const WINDOWS_PROBES = { claude: 'claude --version', gemini: 'gemini --version' } as const;

/** Version discovery also works before the optional conversation runtime is installed. */
export async function cliVersion(engine: ExternalEngine): Promise<string> {
  try {
    // Windows npm shims need cmd.exe. Both commands are literals; no request text enters the shell.
    const result = process.platform === 'win32'
      ? await execute('cmd.exe', ['/d', '/s', '/c', WINDOWS_PROBES[engine]], {
        windowsHide: true, timeout: 10_000, maxBuffer: 4096,
      })
      : await execute(engine, ['--version'], { timeout: 10_000, maxBuffer: 4096 });
    return result.stdout.trim().match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? '';
  } catch { return ''; }
}
