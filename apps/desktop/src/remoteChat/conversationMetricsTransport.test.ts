// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { ChatOperations } from './operations';
import { invoke } from '../api/backend';
import { CONVERSATION_METRICS_OPERATION } from '../../../../shared/remote-chat/conversationMetrics';

vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
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
  expect(await controller.readConversationMetrics('remote-thread')).toEqual(expected);
  expect(request).toHaveBeenLastCalledWith('request', {
    operation: CONVERSATION_METRICS_OPERATION, threadId: 'remote-thread',
  });
  expect(invoke).toHaveBeenLastCalledWith('get_proxy_session_metrics', { threadId: 'remote-thread' });
  await controller.readConversationMetrics('different-thread');
  expect(invoke).toHaveBeenLastCalledWith('get_proxy_session_metrics', { threadId: 'different-thread' });
});

it.each([null, '', ' ', 42])('rejects a missing or invalid remote conversation id: %s', async threadId => {
  const response = await new ChatOperations().execute({ kind: 'request', id: 'invalid-metrics', method: 'request',
    body: { operation: CONVERSATION_METRICS_OPERATION, threadId } });
  expect(response.error).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
});
