// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { ChatOperations } from './operations';
import { guiApi } from '../../../../shared/conversation/api';
import type { Item, Thread } from '../../../../shared/conversation/types';
import type { PagedHistoryDelta } from '../../../../shared/remote-chat/historyPage';
import { applyHistoryDelta } from '../../../../shared/remote-chat/historySync';

vi.mock('../api/backend', () => ({ invoke: vi.fn(), hasLocalBackend: false, isDesktopApp: false }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

it.each(['direct', 'relay'] as const)('transports one opened item and keeps %s history free of payloads', async mode => {
  const item: Item = { id: 'cmd', type: 'commandExecution', command: 'echo full',
    status: 'completed', aggregatedOutput: 'large-output'.repeat(100_000) };
  const thread: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 0,
    turns: [{ id: 'turn', status: 'completed', items: [item] }] };
  vi.mocked(guiApi.request).mockImplementation(async request =>
    (request.operation === 'toolDetails' ? { item } : { thread }) as never);
  const host = new ChatOperations();
  let sequence = 0;
  const request = async <T,>(method: 'request' | 'connect' | 'respond', body?: unknown): Promise<T> => {
    const result = await host.execute({ kind: 'request', id: `detail:${++sequence}`, method, body }, mode);
    if (result.error) throw new Error(result.error);
    return result.data as T;
  };
  const client = new ChatController(() => ({ request, start: vi.fn(), stop: vi.fn() }));
  host.prepareEvent({ method: 'item/completed', params: { threadId: 'chat', turnId: 'turn', item } });
  const history = await request<PagedHistoryDelta>('request', {
    operation: 'syncHistory', threadId: 'chat', deferToolDetails: true,
  });
  expect(JSON.stringify(history).length).toBeLessThan(1500);
  const target = applyHistoryDelta({ ...thread, turns: [] }, history).turns![0].items[0].detailsRef!;
  expect(target).toEqual({ threadId: 'chat', turnId: 'turn', itemId: 'cmd' });
  expect(await client.toolDetails(target)).toEqual({ item });
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: 'toolDetails', ...target });
  const legacy = await request<PagedHistoryDelta>('request', { operation: 'syncHistory', threadId: 'chat' });
  expect(applyHistoryDelta({ ...thread, turns: [] }, legacy).turns![0].items[0].aggregatedOutput)
    .toBe(item.aggregatedOutput);
  host.release();
});

it.each(['direct', 'relay'] as const)('defers whole processes across the %s boundary until explicitly opened', async mode => {
  const items: Item[] = Array.from({ length: 2_000 }, (_, index) => ({ id: `work-${index}`,
    type: 'agentMessage', phase: 'commentary', text: 'internal-details'.repeat(100) }));
  const thread: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 0,
    turns: [{ id: 'turn', status: 'completed', items: [{ id: 'question', type: 'userMessage' }, ...items,
      { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'done' }] }] };
  vi.mocked(guiApi.request).mockImplementation(async request =>
    (request.operation === 'processDetails' ? { items } : { thread }) as never);
  const host = new ChatOperations();
  let sequence = 0;
  const request = async <T,>(method: 'request' | 'connect' | 'respond', body?: unknown): Promise<T> => {
    const result = await host.execute({ kind: 'request', id: `process:${++sequence}`, method, body }, mode);
    if (result.error) throw new Error(result.error);
    return result.data as T;
  };
  const history = await request<PagedHistoryDelta>('request', { operation: 'syncHistory', threadId: 'chat',
    deferToolDetails: true, window: { deferProcesses: true } });
  const restored = applyHistoryDelta({ ...thread, turns: [] }, history);
  expect(history.page?.hasMore).toBe(false);
  expect(restored.turns![0].items).toHaveLength(3);
  expect(JSON.stringify(history).length).toBeLessThan(1_500);
  expect(JSON.stringify(history)).not.toContain('internal-details');
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'processDetails' }));
  const client = new ChatController(() => ({ request, start: vi.fn(), stop: vi.fn() }));
  const target = restored.turns![0].items[1].processRef!;
  expect(await client.processDetails(target)).toEqual({ items });
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: 'processDetails', ...target });
  host.release();
});
