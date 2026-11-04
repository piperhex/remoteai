// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { remotePromptSuggestion } from '../../../../shared/remote-chat/client/promptSuggestion';
import { initialChatState, type ChatState } from '../../../../shared/remote-chat/client/types';
import { testModels } from '../../../../shared/conversation/testing/models';
import { guiApi } from '../../../../shared/conversation/api';
import { ChatOperations } from './operations';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
const target = { threadId: 'remote', sourceTurnId: 'turn', model: 'gpt-test', effort: 'low' as const };
function readyState(): ChatState {
  return { ...initialChatState(), ready: true, models: testModels,
    settings: { model: 'gpt-test', effort: 'high', access: 'workspace-write' },
    selected: { id: 'remote', cwd: '/project', preview: '', updatedAt: 1,
      turns: [{ id: 'turn', status: 'completed', items: [
        { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '方案已准备好' },
      ] }] } };
}
it('targets the completed remote answer with the fastest supported effort', () => {
  expect(remotePromptSuggestion(readyState(), vi.fn())).toMatchObject({ enabled: true, target });
});
it.each<Partial<ChatState>>([
  { ready: false }, { connecting: true }, { selectedArchived: true }, { historyOffline: true },
  { loading: true }, { historyLoading: true }, { sending: true }, { compacting: 'remote' },
  { settingsBusy: true }, { workspaceBusy: true }, { goalBusy: true }, { queueBusy: true },
  { error: '连接错误' }, { settingsError: '设置错误' },
])('disables suggestions while the remote conversation is unavailable: %j', patch => {
  expect(remotePromptSuggestion({ ...readyState(), ...patch }, vi.fn()).enabled).toBe(false);
});
it('requires a completed final answer and a supported model', () => {
  const state = readyState();
  state.selected!.turns![0].status = 'inProgress';
  expect(remotePromptSuggestion(state, vi.fn())).toMatchObject({ enabled: false, target: null });
  state.selected!.turns![0].status = 'completed';
  state.selected!.turns![0].items[0].phase = 'commentary';
  expect(remotePromptSuggestion(state, vi.fn()).target).toBeNull();
  expect(remotePromptSuggestion({ ...readyState(), models: [] }, vi.fn()).target).toBeNull();
});
it.each(['direct', 'relay'] as const)('routes phone predictions through the authenticated host over %s', async mode => {
  const answer = { suggestion: '继续实现' };
  vi.mocked(guiApi.request).mockResolvedValue(answer);
  const host = new ChatOperations();
  const request = vi.fn(async (method: 'request' | 'connect' | 'respond', body?: unknown) => {
    const result = await host.execute({ kind: 'request', id: 'prediction', method, body }, mode);
    if (result.error) throw new Error(result.error);
    return result.data;
  });
  const controller = new ChatController(() => ({ start: vi.fn(), stop: vi.fn(),
    request: async <T,>(method: 'request' | 'connect' | 'respond', body?: unknown) => await request(method, body) as T,
  }));
  expect(await controller.suggestNextPrompt(target)).toEqual(answer);
  expect(request).toHaveBeenCalledExactlyOnceWith('request', { operation: 'suggestNextPrompt', ...target });
  expect(guiApi.request).toHaveBeenCalledExactlyOnceWith({ operation: 'suggestNextPrompt', ...target });
  expect(controller.snapshot().sending).toBe(false);
});
it('lets ordinary requests complete while a prediction is pending', async () => {
  let release!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockReturnValueOnce(new Promise(resolve => { release = resolve; }))
    .mockResolvedValueOnce({ thread: { id: 'remote' } });
  const host = new ChatOperations();
  const prediction = host.execute({ kind: 'request', id: 'prediction', method: 'request',
    body: { operation: 'suggestNextPrompt', ...target } });
  const read = await host.execute({ kind: 'request', id: 'read', method: 'request',
    body: { operation: 'read', threadId: 'remote' } });
  expect(read.data).toEqual({ thread: { id: 'remote' } });
  release({ suggestion: null }); await prediction;
});

it('suppresses suggestions for queued tasks, goals and approval requests', () => {
  const base = readyState();
  const queue = { revision: 1, threads: { remote: [
    { id: 'queued', text: 'next', imageCount: 0, attachmentCount: 0, busy: false },
  ] } };
  expect(remotePromptSuggestion({ ...base, queue }, vi.fn()).enabled).toBe(false);
  const goals = { remote: { threadId: 'remote', objective: 'finish', status: 'active' as const,
    tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 } };
  expect(remotePromptSuggestion({ ...base, goals }, vi.fn()).enabled).toBe(false);
  const approvals = [{ method: 'item/commandExecution/requestApproval',
    id: 1, params: { threadId: 'remote' } }];
  expect(remotePromptSuggestion({ ...base, approvals }, vi.fn()).enabled).toBe(false);
});
