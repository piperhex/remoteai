import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';

export interface ClaudeBinding { id: string; directory: string }
const ACCOUNT_ID = /^claude_[a-f\d]{32}$/i;

/** Read only account metadata. The native CLI reads credentials from its isolated profile. */
export async function selectedClaudeAccount(runtimeRoot: string): Promise<ClaudeBinding | null> {
  const root = dirname(runtimeRoot);
  let selection: { id?: unknown };
  try { selection = JSON.parse(await readFile(join(root, 'claude-selection.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('client.officialAccounts.storageFailed');
  }
  if (selection.id == null) return null;
  if (typeof selection.id !== 'string' || !ACCOUNT_ID.test(selection.id)) {
    throw new Error('client.officialAccounts.invalidRequest');
  }
  try {
    const profile = JSON.parse(await readFile(join(root, 'accounts', selection.id, 'claude-profile.json'), 'utf8')) as {
      id?: unknown; configDir?: unknown;
    };
    if (profile.id !== selection.id || typeof profile.configDir !== 'string' || !isAbsolute(profile.configDir)) {
      throw new Error('Invalid profile');
    }
    const child = relative(join(root, 'claude-profiles'), profile.configDir);
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Invalid profile directory');
    return { id: selection.id, directory: profile.configDir };
  } catch { throw new Error('client.officialAccounts.storageFailed'); }
}

export function claudeAccountEnvironment(binding: ClaudeBinding): Record<string, string> {
  return {
    CLAUDE_CONFIG_DIR: binding.directory,
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
    CLAUDE_CODE_OAUTH_TOKEN: '', CLAUDE_CODE_USE_BEDROCK: '', CLAUDE_CODE_USE_VERTEX: '',
    CLAUDE_CODE_USE_FOUNDRY: '', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '',
  };
}
