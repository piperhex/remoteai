// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { contextUsageLabel } from '../../../../shared/remote-chat/contextUsage';
import { applyChatEvent } from '../../../../shared/remote-chat/client/events';
import { mergeHistory } from '../../../../shared/remote-chat/client/history';
import { initialChatState, type Thread, type ThreadTokenUsage } from '../../../../shared/remote-chat/client/types';
import { applyHistoryDelta, historyVersion, type HistoryDelta } from '../../../../shared/remote-chat/historySync';
import { ChatOperations } from './operations';
import { guiApi } from '../../../../shared/conversation/api';
import { ChatSettings } from '../../../../shared/remote-chat/views/ChatSettings';
import { useDesktopLayout } from '../../../../shared/layout/useDesktopLayout';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
vi.mock('../api/backend', () => ({ invoke: vi.fn(), hasLocalBackend: false, isDesktopApp: false }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/layout/useDesktopLayout', () => ({ useDesktopLayout: vi.fn(() => false) }));
vi.mock('../../../../shared/layout/AdaptiveSheet', () => ({
  AdaptiveSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const usage: ThreadTokenUsage = {
  total: { totalTokens: 11_670_000 }, last: { totalTokens: 121_260 }, modelContextWindow: 258_000,
};
const thread: Thread = { id: 'one', preview: '', cwd: '', updatedAt: 1, turns: [] };
const event = (tokenUsage = usage, threadId = thread.id) => ({
  method: 'thread/tokenUsage/updated', params: { threadId, tokenUsage },
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

it('uses the latest request and desktop capacity rules instead of cumulative tokens', () => {
  expect(contextUsageLabel(usage)).toBe('上下文 121.3K / 258K Token（47% 已用）');
  expect(contextUsageLabel({ ...usage, last: { totalTokens: 0 } })).toContain('0% 已用');
  expect(contextUsageLabel({ ...usage, last: { totalTokens: 300_000 } })).toContain('100% 已用');
  expect(contextUsageLabel({ ...usage, modelContextWindow: null })).toBe('上下文已用 121.3K Token（容量未知）');
  expect(contextUsageLabel()).toBe('暂无上下文用量');
  expect(contextUsageLabel({ ...usage, last: { totalTokens: -1 } })).toBe('暂无上下文用量');
});

it('applies context events without a turn id and isolates other conversations', () => {
  const state = { ...initialChatState(), selected: thread };
  const next = applyChatEvent(state, event());
  expect(next.selected?.tokenUsage).toEqual(usage);
  expect(next.selected?.turns).toEqual([]);
  expect(applyChatEvent(next, event({ ...usage, last: { totalTokens: 5 } }, 'other')).selected).toBe(next.selected);
  expect(applyChatEvent(next, { method: 'thread/tokenUsage/updated', params: { threadId: thread.id } })
    .selected?.tokenUsage).toEqual(usage);
});

it('uses the engine estimate consistently through mobile/web events and history sync', () => {
  const tokenUsage = { ...usage, last: { totalTokens: 206_357 }, contextTokens: 247_017,
    modelContextWindow: 258_400 };
  const state = applyChatEvent({ ...initialChatState(), selected: thread }, event(tokenUsage));
  expect(contextUsageLabel(state.selected?.tokenUsage)).toBe('上下文 247K / 258.4K Token（96% 已用）');
  expect(state.selected?.tokenUsage?.last.totalTokens).toBe(206_357);
  expect(state.selected?.tokenUsage?.total.totalTokens).toBe(usage.total.totalTokens);
  const compacted = applyChatEvent(state, event({ ...tokenUsage, contextTokens: 16_273 }));
  expect(contextUsageLabel(compacted.selected?.tokenUsage)).toContain('6% 已用');
});

it('keeps a live compaction decrease during history reads and accepts newer snapshots', () => {
  const before = { ...thread, tokenUsage: usage };
  const compacted = { ...usage, last: { totalTokens: 25_800 } };
  const live = { ...before, tokenUsage: compacted };
  expect(mergeHistory(before, live, before).tokenUsage).toEqual(compacted);
  expect(mergeHistory(live, before, before).tokenUsage).toEqual(compacted);
  expect(mergeHistory(thread, live, live).tokenUsage).toEqual(compacted);
});

it('restores context through history sync after joining and updates it after compaction', async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ thread });
  const host = new ChatOperations();
  host.prepareEvent(event());
  host.prepareEvent({ method: 'turn/started', params: { threadId: thread.id, turnId: 'turn' } });
  host.prepareEvent({ method: 'thread/resumed', params: { thread } });
  const read = async (id: string, selected = thread) => {
    const response = await host.execute({ kind: 'request', id, method: 'request',
      body: { operation: 'syncHistory', threadId: selected.id, known: historyVersion(selected) } });
    expect(response.error).toBeUndefined();
    return applyHistoryDelta(selected, response.data as HistoryDelta);
  };
  const selected = await read('first');
  expect(selected.tokenUsage).toEqual(usage);
  host.prepareEvent({ method: 'thread/compacted', params: { threadId: thread.id } });
  const compacted = { ...usage, last: { totalTokens: 25_800 } };
  host.prepareEvent(event(compacted));
  expect((await read('compacted', selected)).tokenUsage).toEqual(compacted);
  host.prepareEvent({ method: 'thread/deleted', params: { threadId: thread.id } });
  expect((await read('deleted')).tokenUsage).toBeUndefined();
});

it('shows and updates context in settings even while daily usage is still loading', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  const readUsage = vi.fn<() => Promise<unknown>>(() => new Promise<never>(() => {}));
  const readConversationMetrics = vi.fn().mockResolvedValue({
    totalOutputTokens: 0, totalOutputTimeMs: 0, outputRequestCount: 0,
  });
  const connection = { deviceName: '测试电脑', chooseDevice: vi.fn(), client: {
    read: vi.fn().mockResolvedValue({ selection: { kind: 'none' }, choices: [], running: false }),
    select: vi.fn(), subscribe: vi.fn(() => vi.fn()),
  } };
  const render = async (tokenUsage?: ThreadTokenUsage) => act(async () => root.render(<ChatSettings
    connection={connection}
    threadId="demo" contextSettings={{ read: vi.fn(), write: vi.fn() }}
    tokenUsage={tokenUsage} readUsage={readUsage} ready models={[]} saving={false} error=""
    readConversationMetrics={readConversationMetrics}
    selection={{ model: 'astra', effort: 'low', access: 'workspace-write' }}
    updateSettings={async () => {}} refreshModels={async () => {}} onClose={() => {}} />));
  try {
    await render(usage);
    expect(container.textContent).toContain('121.3K / 258K Token');
    expect(container.querySelector('.chat-usage-card-context [role="progressbar"]')
      ?.getAttribute('aria-valuenow')).toBe('47');
    expect(container.textContent).toContain('正在读取今日用量…');
    await render({ ...usage, last: { totalTokens: 25_800 } });
    expect(container.textContent).toContain('上下文 10%');
    expect(container.querySelector('.chat-usage-card-context [role="progressbar"]')
      ?.getAttribute('aria-valuenow')).toBe('10');
    await render();
    expect(container.querySelector('.chat-usage-card-context [role=progressbar]')?.getAttribute('aria-label'))
      .toBe('暂无上下文用量');
    expect(container.textContent).not.toContain('10% 已用');
    expect(container.querySelector('.chat-usage-card-context [role="progressbar"]')
      ?.hasAttribute('aria-valuenow')).toBe(false);
    expect(readUsage).toHaveBeenCalledTimes(1);
    readUsage.mockResolvedValue({ totalTokens: 123, estimatedCostUsd: 2,
      primaryRemainingPercent: 20, estimatedQuota: { remainingUsd: 25, capacityUsd: 125 } });
    // Reopen the drawer so the read belongs to its new active subscription.
    await act(async () => root.render(null));
    await render();
    expect(container.querySelector('.chat-usage-card-quota [role="progressbar"]')).not.toBeNull();
    expect(container.textContent).toContain('25 / 125 USD');
    vi.mocked(useDesktopLayout).mockReturnValue(true);
    await render();
    expect(container.querySelector('.chat-usage-card-quota [role="progressbar"]')).toBeNull();
    expect(container.textContent).toContain('25USD 剩余额度 · 125USD 总额度');
  } finally { await act(async () => root.unmount()); }
});
