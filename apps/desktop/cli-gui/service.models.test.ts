import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type { PaseoClient } from '@getpaseo/client';
import type { CliModel } from '../../../shared/cli-gui/types';
import type { AccountBridge } from './bridge';
import { CliService } from './service';

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) {
    expect(relative(tmpdir(), path)).toMatch(/^remoteai-model-test-[^\\/]+$/);
    await rm(path, { recursive: true, force: true });
  }
});
async function fixture(model: CliModel, previousEffort?: string) {
  const root = await mkdtemp(join(tmpdir(), 'remoteai-model-test-')); directories.push(root);
  const current = { id: 'agent-1', provider: 'gemini', model: 'native', cwd: root,
    labels: { remoteai: 'cli-gui', remoteaiRoute: 'route-1' }, status: 'idle', pendingPermissions: [],
    updatedAt: new Date().toISOString() };
  const subscription = Object.assign(vi.fn(), { ready: Promise.resolve() });
  const agent = { id: current.id, current: () => current, refresh: async () => ({ agent: current }),
    status: 'idle', pendingPermissions: [], send: vi.fn(), timeline: { subscribe: () => subscription } };
  const create = vi.fn(async () => agent);
  const client = { agents: { ref: () => agent, create }, providers: { refresh: vi.fn(),
    waitForReady: async () => ({ entries: [{ provider: 'gemini', status: 'ready',
      models: [{ id: 'native', label: 'Native' }], modes: [] }] }) } } as unknown as PaseoClient;
  const update = vi.fn(); const route = vi.fn(async () => 'route-1');
  const bridge = { models: async () => [model], update, route, environment: () => ({}),
    selection: () => ({ model: model.id, effort: previousEffort }) } as unknown as AccountBridge;
  const service = new CliService({ root, connect: async () => client,
    status: async () => ({ status: 'ready', version: 'test' }), install() {}, close: async () => {},
    accountBridge: async () => bridge }, () => {});
  return { service, agent, update, route, create };
}

it.each([undefined, '', 'none'])('creates and sends a model without reasoning with legacy effort %s', async effort => {
  const { service, agent, update, route } = await fixture({ id: 'plain', label: 'Plain', efforts: [],
    defaultEffort: 'none' }, 'none');
  await service.request({ engine: 'gemini', action: 'create', cwd: '', model: 'plain', effort });
  expect(route).toHaveBeenCalledExactlyOnceWith('plain', undefined);
  await service.request({ engine: 'gemini', action: 'send', id: agent.id, model: 'plain', effort,
    text: 'Hello', messageId: 'message-1' });
  expect(update).toHaveBeenCalledExactlyOnceWith('route-1', 'plain', undefined);
  expect(agent.send).toHaveBeenCalledExactlyOnceWith('Hello', { messageId: 'message-1' });
});

it('rejects unsupported reasoning before creating or sending and preserves supported values', async () => {
  const { service, agent, update, route, create } = await fixture({ id: 'gpt-6', label: 'GPT-6',
    defaultEffort: 'high', efforts: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] });
  await expect(service.request({ engine: 'gemini', action: 'create', cwd: '', model: 'gpt-6', effort: 'ultra' }))
    .rejects.toThrow('invalidRequest');
  await expect(service.request({ engine: 'gemini', action: 'send', id: agent.id, model: 'gpt-6', effort: 'none',
    text: 'Hello', messageId: 'message-1' })).rejects.toThrow('invalidRequest');
  expect(route).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(agent.send).not.toHaveBeenCalled();
  await service.request({ engine: 'gemini', action: 'send', id: agent.id, model: 'gpt-6', effort: 'low',
    text: 'Hello', messageId: 'message-2' });
  expect(update).toHaveBeenCalledExactlyOnceWith('route-1', 'gpt-6', 'low');
});
