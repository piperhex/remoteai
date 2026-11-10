import { expect, it, vi } from 'vitest';
import type { PaseoAgentHandle, PaseoClient } from '@getpaseo/client';
import type { AgentPermissionRequest } from '@getpaseo/protocol/agent-types';
import { CliService } from './service';
import { permission } from './mapping';

function fixture(provider = 'gemini', owned = true) {
  const pending: AgentPermissionRequest = { id: 'permission-1', provider: 'gemini', kind: 'tool', name: 'write', input: {},
    actions: [{ id: 'choice:once', label: 'Allow once', behavior: 'allow' as const },
      { id: 'choice:deny', label: 'Deny', behavior: 'deny' as const }] };
  const agent = { id: 'agent-1', status: 'idle', pendingPermissions: [pending],
    refresh: vi.fn(async () => ({ agent: { provider, labels: owned ? { remoteai: 'cli-gui' } : {} } })),
    respondToPermission: vi.fn(), reload: vi.fn() };
  const client = { agents: { ref: () => agent as unknown as PaseoAgentHandle } } as unknown as PaseoClient;
  const service = new CliService({ connect: async () => client,
    status: async () => ({ status: 'ready', version: '0.15.4' }), install() {}, close: async () => {} }, () => {});
  return { service, agent, pending };
}

it('rejects approvals for another CLI or an unowned conversation', async () => {
  for (const setup of [fixture('claude'), fixture('gemini', false)]) {
    await expect(setup.service.request({ engine: 'gemini', action: 'approve', id: 'agent-1',
      permissionId: 'permission-1', actionId: 'choice:once' })).rejects.toThrow('invalidRequest');
    expect(setup.agent.respondToPermission).not.toHaveBeenCalled();
  }
});

it('rejects expired or invented choices and preserves exact provider action IDs', async () => {
  const { service, agent } = fixture();
  await expect(service.request({ engine: 'gemini', action: 'approve', id: 'agent-1',
    permissionId: 'old', actionId: 'choice:once' })).rejects.toThrow('approvalExpired');
  await expect(service.request({ engine: 'gemini', action: 'approve', id: 'agent-1',
    permissionId: 'permission-1', actionId: 'approve-everything' })).rejects.toThrow('invalidRequest');
  await service.request({ engine: 'gemini', action: 'approve', id: 'agent-1',
    permissionId: 'permission-1', actionId: 'choice:once' });
  expect(agent.respondToPermission).toHaveBeenCalledExactlyOnceWith({ requestId: 'permission-1',
    response: { behavior: 'allow', selectedActionId: 'choice:once' } });
});

it('maps provider questions and forwards answers with the original tool input', async () => {
  const { pending, agent, service } = fixture();
  const request = { ...pending, kind: 'question' as const, input: { questions: [{ question: 'Which branch?',
    options: [{ label: 'main' }, { label: 'develop' }], multiSelect: false }] } };
  expect(permission(request).questions?.[0].options).toEqual(['main', 'develop']);
  agent.pendingPermissions[0] = request;
  await service.request({ engine: 'gemini', action: 'approve', id: 'agent-1',
    permissionId: pending.id, actionId: 'choice:once', answers: { 'Which branch?': 'main' } });
  expect(agent.respondToPermission.mock.calls[0][0].response.updatedInput)
    .toEqual({ ...request.input, answers: { 'Which branch?': 'main' } });
});
