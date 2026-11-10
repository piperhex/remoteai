// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatUsage } from '../../../../shared/remote-chat/client/useChatUsage';
import { formatCost, formatTokens, usageTrailing, type ReadUsage } from '../../../../shared/remote-chat/usage';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { ChatOperations } from './operations';
import { invoke } from '../api/backend';

vi.mock('../api/backend', () => ({ isDesktopApp: true, invoke: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
const usage = { totalTokens: 50290000, estimatedCostUsd: 74.32, primaryRemainingPercent: 95,
  primaryRemainingAggregated: false, providerEstimatedCost: null };
let root: Root;
let result: ReturnType<typeof useChatUsage>;
function Probe({ read, active = true }: { read: ReadUsage; active?: boolean }) {
  result = useChatUsage(read, active); return <button>聊天设置</button>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(invoke).mockReset();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('preserves desktop account, concurrent and API display rules', () => {
  expect(formatTokens(usage.totalTokens)).toBe('50.29M');
  expect(formatTokens(1520)).toBe('1.5K');
  expect(formatCost(0.0002)).toBe('0.0002USD');
  expect(usageTrailing(usage)).toMatchObject({ text: '95%', label: "剩余", tone: 'quota' });
  expect(usageTrailing({ ...usage, primaryRemainingPercent: 175, primaryRemainingAggregated: true }))
    .toMatchObject({ text: '175%', label: "合计剩余" });
  expect(usageTrailing({ ...usage, primaryRemainingPercent: 0 })).toMatchObject({ text: '0%', tone: 'low' });
  expect(usageTrailing({ ...usage, primaryRemainingPercent: 50 })).toMatchObject({ tone: 'cost' });
  expect(usageTrailing({ ...usage, primaryRemainingPercent: null,
    providerEstimatedCost: { amountUsd: 2.5, aggregated: true } }))
    .toMatchObject({ text: 'API 2.5USD', description: '聚合 API 今日预估费用：2.5USD' });
  expect(usageTrailing({ ...usage, primaryRemainingPercent: null })).toBeNull();
});

it('reads the same desktop summary through the mobile controller and host', async () => {
  const snapshot = { ...usage, accountCredits: { hasCredits: true, unlimited: false, balance: '62500.125' } };
  vi.mocked(invoke).mockResolvedValue(snapshot);
  const host = new ChatOperations();
  const request = vi.fn(async (method: 'request' | 'connect' | 'respond', body?: unknown) => {
    const response = await host.execute({ kind: 'request', id: 'usage:1', method, body });
    if (response.error) throw new Error(response.error);
    return response.data;
  });
  const controller = new ChatController(() => ({
    request: async <T,>(method: 'request' | 'connect' | 'respond', body?: unknown) => await request(method, body) as T,
    start: vi.fn(), stop: vi.fn(),
  }));
  expect(await controller.readUsage()).toEqual(snapshot);
  expect(request).toHaveBeenCalledWith('request', { operation: 'usageSummary' });
  expect(invoke).toHaveBeenCalledWith('codex_gui_usage_summary');
});

it('skips overlapping refreshes and keeps the UI interactive while usage is pending', async () => {
  const pending = deferred<typeof usage>();
  const read = vi.fn(() => pending.promise);
  await act(async () => root.render(<Probe read={read} />));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe read={read} active={false} />));
  await act(async () => pending.resolve(usage));
  expect(result.usage).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe read={read} />));
  expect(result.usage).toEqual(usage);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(read).toHaveBeenCalledTimes(3);
});

it('ignores a previous device response and clears stale values on failure', async () => {
  const old = deferred<typeof usage>();
  const read = vi.fn<ReadUsage>().mockResolvedValue({ ...usage, primaryRemainingPercent: 30 });
  await act(async () => root.render(<Probe read={() => old.promise} />));
  await act(async () => root.render(<Probe read={read} />));
  await act(async () => old.resolve(usage));
  expect(result.usage?.primaryRemainingPercent).toBe(30);
  read.mockRejectedValueOnce(new Error('当前手机端暂不支持此操作。'));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(result.usage).toBeNull();
  expect(result.error).toBe("请更新电脑端后查看用量。");
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(result.error).toBe('');
  expect(result.usage?.primaryRemainingPercent).toBe(30);
});

it('does not overlap a pending refresh after briefly hiding the settings', async () => {
  const pending = deferred<typeof usage>();
  const read = vi.fn(() => pending.promise);
  await act(async () => root.render(<Probe read={read} />));
  await act(async () => root.render(<Probe read={read} active={false} />));
  await act(async () => root.render(<Probe read={read} />));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(usage));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(result.usage).toEqual(usage);
  expect(read).toHaveBeenCalledTimes(2);
});

it('refreshes the selected account credits and clears them when the host no longer returns an account', async () => {
  const credits = { hasCredits: true, unlimited: false, balance: '62500.125' };
  const read = vi.fn<ReadUsage>().mockResolvedValue({ ...usage, accountCredits: credits });
  await act(async () => root.render(<Probe read={read} />));
  expect(result.usage?.accountCredits).toEqual(credits);
  read.mockResolvedValue({ ...usage, accountCredits: { ...credits, hasCredits: false, balance: '0' } });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(result.usage?.accountCredits?.balance).toBe('0');
  read.mockResolvedValue(usage);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(result.usage?.accountCredits).toBeUndefined();
});
