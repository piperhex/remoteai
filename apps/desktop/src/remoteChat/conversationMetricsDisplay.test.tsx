// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationTokenStatus } from '../pages/codexGui/ConversationTokenStatus';
import { loadConversationMetrics } from '../api/conversationMetrics';
import { ChatUsage } from '../../../../shared/remote-chat/views/ChatUsage';
import { ConversationPerformance } from '../../../../shared/remote-chat/views/ConversationPerformance';
import { setLanguage } from '../../../../shared/localization/browserClient';

vi.mock('../api/conversationMetrics', () => ({ loadConversationMetrics: vi.fn() }));
const metrics = { totalOutputTokens: 300, totalOutputTimeMs: 2_000, outputRequestCount: 1,
  totalFirstTokenTimeMs: 2_500, firstTokenRequestCount: 2,
  successfulCommandCount: 3, completedCommandCount: 4, estimatedCostUsd: 1.23 };
const turns = [{ id: 'turn', items: [0, 0, 0, 1].map((exitCode, index) => ({
  id: String(index), type: 'commandExecution', status: 'completed', exitCode,
})) }];
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); root = createRoot(container);
  vi.mocked(loadConversationMetrics).mockResolvedValue(metrics);
});
afterEach(async () => {
  await act(async () => root.unmount()); setLanguage('zh'); vi.clearAllMocks(); vi.unstubAllGlobals();
});

it('keeps daily usage after performance without account quota or another metrics request', async () => {
  const usage = { totalTokens: 476730000, estimatedCostUsd: 696.49, primaryRemainingPercent: 74,
    primaryRemainingAggregated: false, providerEstimatedCost: null,
    estimatedQuota: { remainingUsd: 1193.78, capacityUsd: 1613.21 } };
  await act(async () => root.render(<ConversationTokenStatus threadId="local-thread" usage={usage}
    metrics={metrics} turns={turns} active />));
  expect(container.textContent)
    .toBe('75.0% TSR · 150.0 TPS · 1.25 TTFT · 476.73 M · 696.49 USD');
  expect(loadConversationMetrics).not.toHaveBeenCalled();
  await act(async () => root.render(<ConversationTokenStatus threadId="local-thread" active={false} />));
  expect(container.textContent).toBe('— TSR · — TPS · — TTFT · — · — USD');
  await act(async () => root.render(<ConversationTokenStatus threadId={null} active />));
  expect(container.textContent).toBe('— · — USD');
});

it('shows remote conversation cost and puts performance on the final row', async () => {
  const read = vi.fn().mockResolvedValue(metrics);
  await act(async () => root.render(<ChatUsage read={() => new Promise<never>(() => {})}
    active ready tokenUsage={{ total: { totalTokens: 2_500 }, last: { totalTokens: 500 } }}
    threadId="remote-thread" readConversationMetrics={read} />));
  const thread = container.querySelector('.chat-usage-thread');
  expect(thread?.textContent).toBe('当前 2.50K Token · 1.23USD');
  const performance = container.querySelector('.chat-usage-performance');
  expect(performance?.textContent).toBe('75.0% TSR · 150.0 TPS · 1.25 TTFT');
  expect(performance).toBe(container.querySelector('.chat-usage-summary')?.lastElementChild);
  expect(read).toHaveBeenCalledWith('remote-thread');
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<ChatUsage read={() => new Promise<never>(() => {})}
    active ready threadId="old-host" readConversationMetrics={async () => ({ ...metrics, estimatedCostUsd: undefined })} />));
  expect(container.querySelector('.chat-usage-thread')?.textContent).toBe('当前 — Token · —USD');
});

it('stops remote TPS reads when the page is hidden and refreshes when visible again', async () => {
  const read = vi.fn().mockResolvedValue(metrics);
  await act(async () => root.render(<ConversationPerformance read={read} threadId="remote-thread" active />));
  expect(container.textContent).toBe('75.0% TSR · 150.0 TPS · 1.25 TTFT');
  const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(container.textContent).toBe('— TSR · — TPS · — TTFT');
  hidden.mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(container.textContent).toBe('75.0% TSR · 150.0 TPS · 1.25 TTFT');
  expect(read).toHaveBeenCalledTimes(2);
  hidden.mockRestore();
});

it('switches the TSR accessible label with the UI language and preserves old-host placeholders', async () => {
  const read = vi.fn().mockResolvedValue(metrics);
  await act(async () => root.render(<ConversationPerformance read={read} threadId="remote-thread" active />));
  await act(async () => setLanguage('en'));
  expect(container.querySelector('.chat-conversation-tsr')?.getAttribute('aria-label'))
    .toBe('Command success rate 75.0% TSR');
  await act(async () => setLanguage('ja'));
  expect(container.querySelector('.chat-conversation-tsr')?.getAttribute('aria-label'))
    .toBe('コマンド実行成功率 75.0% TSR');
  const oldRead = vi.fn().mockResolvedValue({ totalOutputTokens: 300, totalOutputTimeMs: 2_000, outputRequestCount: 1 });
  await act(async () => root.render(<ConversationPerformance read={oldRead} threadId="old-host" active />));
  expect(container.textContent).toBe('— TSR · 150.0 TPS · — TTFT');
});
