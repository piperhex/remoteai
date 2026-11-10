import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { ExternalEngine } from '../../../shared/cli-gui/types';

const execute = promisify(execFile);
const WINDOWS_PROBES = { claude: 'claude --version', gemini: 'gemini --version' } as const;
export const CLI_PACKAGES = { claude: '@anthropic-ai/claude-code', gemini: '@google/gemini-cli' } as const;

export async function managedCommand(root: string, engine: ExternalEngine): Promise<string[] | undefined> {
  const manifestPath = join(root, 'runtime/node_modules', CLI_PACKAGES[engine], 'package.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { bin: Record<string, string> | string };
    const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[engine];
    if (!entry) return undefined;
    const executable = join(dirname(manifestPath), entry);
    return /\.[cm]?js$/i.test(entry) ? [process.execPath, executable] : [executable];
  } catch { return undefined; }
}

/** Version discovery also works before the optional conversation runtime is installed. */
export async function cliVersion(engine: ExternalEngine, root?: string): Promise<string> {
  try {
    const managed = root ? await managedCommand(root, engine) : undefined;
    // Windows npm shims need cmd.exe. Both commands are literals; no request text enters the shell.
    const result = managed ? await execute(managed[0], [...managed.slice(1), '--version'], {
      windowsHide: true, timeout: 30_000, maxBuffer: 4096,
    }) : process.platform === 'win32'
      ? await execute('cmd.exe', ['/d', '/s', '/c', WINDOWS_PROBES[engine]], {
        windowsHide: true, timeout: 10_000, maxBuffer: 4096,
      })
      : await execute(engine, ['--version'], { timeout: 10_000, maxBuffer: 4096 });
    return result.stdout.trim().match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? '';
  } catch { return ''; }
}
