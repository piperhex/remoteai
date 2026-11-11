import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PaseoAgent, PaseoAgentHandle, PaseoClient } from '@getpaseo/client';
import { claudeAccountEnvironment, selectedClaudeAccount } from './claudeAccounts';
import { CliService } from './service';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'remoteai-claude-test-')); directories.push(root);
  const id = `claude_${'a'.repeat(32)}`;
  const directory = join(root, 'claude-profiles', id);
  await mkdir(join(root, 'accounts', id), { recursive: true });
  await writeFile(join(root, 'claude-selection.json'), JSON.stringify({ id }));
  await writeFile(join(root, 'accounts', id, 'claude-profile.json'), JSON.stringify({ id, configDir: directory,
    oauth: { encrypted: 'mock-ciphertext-not-a-token' } }));
  return { root, id, directory, runtimeRoot: join(root, 'cli-gui') };
}

it('reads only the selected isolated profile and clears inherited proxy authentication', async () => {
  const data = await fixture();
  const binding = await selectedClaudeAccount(data.runtimeRoot);
  expect(binding).toEqual({ id: data.id, directory: data.directory });
  const env = claudeAccountEnvironment(binding!);
  expect(env.CLAUDE_CONFIG_DIR).toBe(data.directory);
  expect(env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('');
  expect(env.ANTHROPIC_API_KEY).toBe('');
  expect(JSON.stringify(env)).not.toContain('mock-ciphertext');
  await writeFile(join(data.root, 'claude-selection.json'), '{"id":"../outside"}');
  await expect(selectedClaudeAccount(data.runtimeRoot)).rejects.toThrow('invalidRequest');
});

it('keeps an existing native session on its original account and model after selection changes', async () => {
  const data = await fixture();
  const snapshot = { id: 'native-1', provider: 'claude', model: 'sonnet', labels: {
    remoteai: 'cli-gui', remoteaiClaudeAccount: data.id }, cwd: data.root,
    status: 'idle', updatedAt: '2026-11-11T00:00:00Z', pendingPermissions: [] } as unknown as PaseoAgent;
  const subscription = Object.assign(vi.fn(), { ready: Promise.resolve() });
  const agent = { id: snapshot.id, current: () => snapshot, refresh: async () => ({ agent: snapshot }),
    status: 'idle', pendingPermissions: [], send: vi.fn(), timeline: { subscribe: () => subscription } };
  const client = { agents: { ref: () => agent as unknown as PaseoAgentHandle } } as unknown as PaseoClient;
  const accountBridge = vi.fn(async () => { throw new Error('Native sessions cannot use the proxy bridge'); });
  const service = new CliService({ root: data.runtimeRoot, connect: async () => client,
    status: async () => ({ status: 'ready', version: 'fixture' }), install() {}, close: async () => {}, accountBridge }, vi.fn());
  await writeFile(join(data.root, 'claude-selection.json'), '{"id":null}');
  const catalog = await service.request({ action: 'catalog', engine: 'claude', id: snapshot.id });
  expect(catalog).toMatchObject({ models: [{ id: 'sonnet' }] });
  await service.request({ action: 'send', engine: 'claude', id: snapshot.id,
    text: 'mock prompt', messageId: 'message-1', model: 'sonnet' });
  expect(agent.send).toHaveBeenCalledWith('mock prompt', { messageId: 'message-1' });
  expect(accountBridge).not.toHaveBeenCalled();
  await expect(service.request({ action: 'send', engine: 'claude', id: snapshot.id,
    text: 'mock prompt', messageId: 'message-2', model: 'another-model' })).rejects.toThrow('invalidRequest');
});

it('creates a native Claude session with the selected isolated profile without a proxy bridge', async () => {
  const data = await fixture();
  const snapshot = { id: 'native-new', provider: 'claude', model: 'sonnet', labels: {
    remoteai: 'cli-gui', remoteaiClaudeAccount: data.id }, cwd: data.root,
    status: 'idle', updatedAt: '2026-11-11T00:00:00Z', pendingPermissions: [] } as unknown as PaseoAgent;
  const subscription = Object.assign(vi.fn(), { ready: Promise.resolve() });
  const agent = { id: snapshot.id, refresh: async () => ({ agent: snapshot }),
    timeline: { subscribe: () => subscription } } as unknown as PaseoAgentHandle;
  const create = vi.fn(async () => agent);
  const client = { agents: { create }, providers: { refresh: vi.fn(), waitForReady: async () => ({
    entries: [{ provider: 'claude', status: 'ready', models: [{ id: 'sonnet', label: 'Sonnet' }], modes: [] }],
  }) } } as unknown as PaseoClient;
  const accountBridge = vi.fn(async () => { throw new Error('Unexpected proxy bridge'); });
  const service = new CliService({ root: data.runtimeRoot, connect: async () => client,
    status: async () => ({ status: 'ready', version: 'fixture' }), install() {}, close: async () => {},
    accountBridge }, vi.fn());
  await service.request({ action: 'create', engine: 'claude', cwd: data.root, model: 'sonnet' });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    labels: { remoteai: 'cli-gui', remoteaiClaudeAccount: data.id },
    config: { provider: 'claude/sonnet', modeId: undefined },
    env: expect.objectContaining({ CLAUDE_CONFIG_DIR: data.directory,
      ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }),
  }));
  expect(accountBridge).not.toHaveBeenCalled();
});
