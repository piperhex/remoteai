// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { ChatOperations } from './operations';
import { invoke } from '../api/backend';
import { guiApi } from '../../../../shared/conversation/api';
import type { Thread } from '../../../../shared/conversation/types';
import type { PagedHistoryDelta } from '../../../../shared/remote-chat/historyPage';
import { CONVERSATION_METRICS_OPERATION } from '../../../../shared/remote-chat/conversationMetrics';

vi.mock('../api/backend', () => ({ invoke: vi.fn(), hasLocalBackend: false }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

it.each(['direct', 'relay'] as const)('reads TPS and TTFT from the exact host and thread over %s', async mode => {
  const expected = { totalOutputTokens: 200, totalOutputTimeMs: 4_000, outputRequestCount: 1,
    totalFirstTokenTimeMs: 1_500, firstTokenRequestCount: 1 };
  vi.mocked(invoke).mockResolvedValue(expected);
  const host = new ChatOperations();
  let sequence = 0;
  const request = vi.fn(async (method: 'request' | 'connect' | 'respond', body?: unknown) => {
    const response = await host.execute({ kind: 'request', id: `metrics:${++sequence}`, method, body }, mode);
    if (response.error) throw new Error(response.error);
    return response.data;
  });
  const controller = new ChatController(() => ({
    request: async <T,>(method: 'request' | 'connect' | 'respond', body?: unknown) => await request(method, body) as T,
    start: vi.fn(), stop: vi.fn(),
  }));
  const thread: Thread = { id: 'remote-thread', preview: '', cwd: '', updatedAt: 0,
    turns: [{ id: 'turn', status: 'completed', items: Array.from({ length: 30 }, (_, index) => ({
      id: `command-${index}`, type: 'commandExecution', status: 'completed', exitCode: index < 20 ? 0 : 1,
    })) }] };
  vi.mocked(guiApi.request).mockResolvedValue({ thread });
  const history = await request('request', { operation: 'syncHistory', threadId: thread.id }) as PagedHistoryDelta;
  expect(history.page?.hasMore).toBe(true);
  expect(history.turns[0].items).toHaveLength(10);
  const commands = { successfulCommandCount: 20, completedCommandCount: 30 };
  expect(await controller.readConversationMetrics('remote-thread')).toEqual({ ...expected, ...commands });
  expect(request).toHaveBeenLastCalledWith('request', {
    operation: CONVERSATION_METRICS_OPERATION, threadId: 'remote-thread',
  });
  expect(invoke).toHaveBeenLastCalledWith('get_proxy_session_metrics', { threadId: 'remote-thread' });
  host.prepareEvent({ method: 'item/completed', params: { threadId: thread.id, turnId: 'turn',
    item: { id: 'live-command', type: 'commandExecution', status: 'completed', exitCode: 0 } } });
  expect(await controller.readConversationMetrics(thread.id)).toEqual({ ...expected,
    successfulCommandCount: 21, completedCommandCount: 31 });
  expect(guiApi.request).toHaveBeenCalledTimes(1);
  await controller.readConversationMetrics('different-thread');
  expect(invoke).toHaveBeenLastCalledWith('get_proxy_session_metrics', { threadId: 'different-thread' });
});

it.each([null, '', ' ', 42])('rejects a missing or invalid remote conversation id: %s', async threadId => {
  const response = await new ChatOperations().execute({ kind: 'request', id: 'invalid-metrics', method: 'request',
    body: { operation: CONVERSATION_METRICS_OPERATION, threadId } });
  expect(response.error).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
});
