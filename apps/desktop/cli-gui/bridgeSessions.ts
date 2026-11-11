import { readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AccountBridge } from './bridge';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function recordFiles(directory: string, includeProjects = true): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => join(directory, entry.name));
  if (includeProjects) {
    for (const entry of entries.filter(entry => entry.isDirectory())) {
      files.push(...await recordFiles(join(directory, entry.name), false));
    }
  }
  return files;
}

/** Paseo 0.15.4 stores launchEnv in root/project agent JSON records. Migrate before daemon construction,
 * which caches these records and may restore sessions. Repeat on every start to recover interrupted migrations.
 */
export async function refreshBridgeSessions(directory: string, bridge: AccountBridge) {
  for (const file of await recordFiles(directory)) {
    const record: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!object(record) || !object(record.labels) || record.labels.remoteai !== 'cli-gui'
      || record.labels.remoteaiClaudeAccount || !['claude', 'gemini'].includes(String(record.provider))) continue;
    const route = record.labels.remoteaiRoute;
    if (typeof route !== 'string' || !bridge.selection(route)) throw new Error('client.cliGui.accountUnavailable');
    const env = object(record.launchEnv) ? record.launchEnv : {};
    const current = bridge.environment(record.provider as 'claude' | 'gemini', route);
    if (Object.entries(current).every(([key, value]) => env[key] === value)) continue;
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ ...record, launchEnv: { ...env, ...current } }), { mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
