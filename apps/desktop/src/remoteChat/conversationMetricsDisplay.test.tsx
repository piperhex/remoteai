// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationTokenStatus } from '../pages/codexGui/ConversationTokenStatus';
import { loadConversationMetrics } from '../api/conversationMetrics';
import { ChatUsage } from '../../../web/src/chat/ChatUsage';
import { ConversationTps } from '../../../web/src/chat/ConversationTps';

vi.mock('../api/conversationMetrics', () => ({ loadConversationMetrics: vi.fn() }));
const metrics = { totalOutputTokens: 300, totalOutputTimeMs: 2_000, outputRequestCount: 1 };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); root = createRoot(container);
  vi.mocked(loadConversationMetrics).mockResolvedValue(metrics);
});
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('places local GUI TPS before conversation tokens and clears it when disconnected', async () => {
  await act(async () => root.render(<ConversationTokenStatus threadId="local-thread" tokens={2_500} active />));
  expect(container.textContent).toBe('150.0 TPS2.50k tokens');
  expect(loadConversationMetrics).toHaveBeenCalledWith('local-thread');
  await act(async () => root.render(<ConversationTokenStatus threadId="local-thread" tokens={2_500} active={false} />));
  expect(container.textContent).toBe('— TPS2.50k tokens');
  await act(async () => root.render(<ConversationTokenStatus threadId={null} tokens={0} active />));
  expect(container.textContent).toBe('');
});

it('shows remote TPS independently of the daily usage request and to the right of tokens in settings', async () => {
  const read = vi.fn().mockResolvedValue(metrics);
  await act(async () => root.render(<ChatUsage read={() => new Promise<never>(() => {})}
    active ready tokenUsage={{ total: { totalTokens: 2_500 }, last: { totalTokens: 500 } }}
    threadId="remote-thread" readConversationMetrics={read} />));
  const thread = container.querySelector('.chat-usage-thread');
  expect(thread?.textContent).toBe('当前对话 2.50K Token · 150.0 TPS');
  expect(read).toHaveBeenCalledWith('remote-thread');
});

it('stops remote TPS reads when the page is hidden and refreshes when visible again', async () => {
  const read = vi.fn().mockResolvedValue(metrics);
  await act(async () => root.render(<ConversationTps read={read} threadId="remote-thread" active />));
  expect(container.textContent).toBe('150.0 TPS');
  const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(container.textContent).toBe('— TPS');
  hidden.mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(container.textContent).toBe('150.0 TPS');
  expect(read).toHaveBeenCalledTimes(2);
  hidden.mockRestore();
});
