import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type { PaseoClient } from '@getpaseo/client';
import type { CliSession } from '../../../shared/cli-gui/types';
import { CliService } from './service';
import type { AccountBridge } from './bridge';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'remoteai-cli-workspaces-')); });
afterEach(async () => {
  expect(relative(tmpdir(), root)).toMatch(/^remoteai-cli-workspaces-[^\\/]+$/);
  await rm(root, { recursive: true, force: true });
});

function fixture(engine: 'claude' | 'gemini') {
  let sequence = 0;
  type Agent = ReturnType<typeof makeAgent>;
  const agents = new Map<string, Agent>();
  const makeAgent = (options: { cwd: string; labels: Record<string, string> }) => {
    const data = { id: `session-${sequence++}`, provider: engine, model: 'native-model', status: 'idle',
      cwd: options.cwd, labels: options.labels, title: 'Chat', updatedAt: new Date().toISOString(),
      archivedAt: null, pendingPermissions: [] };
    const unsubscribe = Object.assign(() => {}, { ready: Promise.resolve() });
    return { ...data, refresh: async () => ({ agent: data }), current: () => data, send: vi.fn(),
      timeline: { subscribe: () => unsubscribe, refetch: async () => ({ agent: data, entries: [], hasOlder: false }) } };
  };
  const create = vi.fn(async (options: { cwd: string; labels: Record<string, string> }) => {
    const agent = makeAgent(options); agents.set(agent.id, agent); return agent;
  });
  const providers = { refresh: vi.fn(async () => {}), waitForReady: vi.fn(async () => ({ entries: [{
    provider: engine, status: 'ready', models: [{ id: 'native-model', isDefault: true }],
    modes: [{ id: 'default', label: 'Default' }], defaultModeId: 'default',
  }] })) };
  // The fixture implements only the public SDK operations exercised by this service.
  const client = { providers, agents: { create, ref: (id: string) => agents.get(id) } } as unknown as PaseoClient;
  const bridge = { models: async () => [{ id: 'account-model', label: 'Account model' }],
    route: async () => 'route', environment: () => ({}), selection: () => ({ model: 'account-model' }),
    update: vi.fn(async () => {}) } as unknown as AccountBridge;
  const service = new CliService({ root, connect: async () => client, close: async () => {}, install() {},
    status: async () => ({ status: 'ready', version: 'test' }), accountBridge: async () => bridge }, () => {});
  return { service, providers, create, agents };
}

it.each(['claude', 'gemini'] as const)('%s discovers modes in an app workspace when no project is selected', async engine => {
  const { service, providers } = fixture(engine);
  await service.request({ engine, action: 'catalog' });
  expect(providers.refresh).toHaveBeenCalledWith({ cwd: await realpath(join(root, 'workspaces')), providers: [engine] });
});

it.each(['claude', 'gemini'] as const)('%s keeps projectless conversations isolated and files across turns', async engine => {
  const { service, create, agents } = fixture(engine);
  const first = await service.request({ engine, action: 'create', cwd: '',
    model: 'account-model', mode: 'default' }) as CliSession;
  const second = await service.request({ engine, action: 'create', cwd: '', model: 'account-model' }) as CliSession;
  const firstPath = create.mock.calls[0][0].cwd;
  const secondPath = create.mock.calls[1][0].cwd;
  expect(firstPath).not.toBe(secondPath);
  expect(relative(await realpath(join(root, 'workspaces')), firstPath)).toMatch(/^chat-[^\\/]+$/);
  expect(first.cwd).toBe(''); expect(second.cwd).toBe('');
  expect(first.model).toBe('account-model');
  await writeFile(join(firstPath, 'note.txt'), 'Keep this across turns');
  const restored = await service.request({ engine, action: 'read', id: first.id });
  expect(restored).toMatchObject({ session: { id: first.id, cwd: '' } });
  await service.request({ engine, action: 'send', id: first.id, text: 'Continue', messageId: 'message-1' });
  expect(agents.get(first.id)?.send).toHaveBeenCalledWith('Continue', { messageId: 'message-1' });
  expect(await readFile(join(firstPath, 'note.txt'), 'utf8')).toBe('Keep this across turns');
  expect(create).toHaveBeenCalledTimes(2);
});

it('preserves an explicit project and rejects invalid paths instead of silently falling back', async () => {
  const { service, create } = fixture('claude');
  const project = join(root, 'project'); await mkdir(project);
  const result = await service.request({ engine: 'claude', action: 'create', cwd: project, model: 'account-model' });
  expect(result).toMatchObject({ cwd: project });
  for (const cwd of ['../project', join(root, 'missing')]) {
    await expect(service.request({ engine: 'claude', action: 'create', cwd, model: 'account-model' }))
      .rejects.toThrow('client.cliGui.invalidRequest');
  }
  expect(create).toHaveBeenCalledOnce();
});
