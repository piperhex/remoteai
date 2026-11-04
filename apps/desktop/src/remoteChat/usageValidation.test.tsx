// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatUsage as WebChatUsage } from '../../../../shared/remote-chat/views/ChatUsage';
import { USAGE_REFRESH_INTERVAL_MS, type ReadUsage } from '../../../../shared/remote-chat/usage';

const usage = { totalTokens: 1_520, estimatedCostUsd: 2.5, primaryRemainingPercent: null,
  primaryRemainingAggregated: false, providerEstimatedCost: null };
const views = [
  { name: 'web mobile settings', remainingLabel: '剩余',
    render: (read: ReadUsage) => <WebChatUsage read={read} active ready quotaProgress /> },
];
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each(views)('$name survives missing totals and recovers on the next refresh', async ({ render }) => {
  const read = vi.fn().mockResolvedValueOnce({}).mockResolvedValue(usage);
  await act(async () => root.render(render(read)));
  expect(container.textContent).not.toContain('NaN');
  expect(container.textContent).not.toContain('0USD');
  expect(container.textContent).not.toContain('1.5K');
  expect(container.childElementCount).toBeGreaterThan(0);
  await act(async () => vi.advanceTimersByTimeAsync(USAGE_REFRESH_INTERVAL_MS));
  expect(container.textContent).toContain('1.5K');
  expect(container.textContent).toContain('2.5USD');
  expect(read).toHaveBeenCalledTimes(2);
});

it.each(views)('$name ignores malformed optional API estimates', async ({ render }) => {
  const read = vi.fn().mockResolvedValue({ ...usage, providerEstimatedCost: {} });
  await act(async () => root.render(render(read)));
  expect(container.textContent).toContain('1.5K');
  expect(container.textContent).toContain('2.5USD');
  expect(container.textContent).not.toContain('API');
});

it.each(views)('$name displays quota in its intended location', async ({ render, remainingLabel }) => {
  const read = vi.fn().mockResolvedValue({ ...usage, primaryRemainingPercent: 20,
    estimatedQuota: { remainingUsd: 25, capacityUsd: 125 } });
  await act(async () => root.render(render(read)));
  expect(container.textContent).toContain(`20% · 25USD ${remainingLabel} · 125USD 总额度`);
  expect(container.textContent).toContain('2.5USD');
  read.mockResolvedValue({ ...usage, primaryRemainingPercent: 20 });
  await act(async () => vi.advanceTimersByTimeAsync(USAGE_REFRESH_INTERVAL_MS));
  expect(container.textContent).toContain(`20% · — ${remainingLabel} · — 总额度`);
  expect(container.textContent).not.toContain('25USD');
});
