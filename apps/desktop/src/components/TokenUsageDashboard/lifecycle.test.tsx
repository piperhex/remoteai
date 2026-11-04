// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as backend from '../../api/backend';
import { TokenUsagePanel } from '../TokenUsagePanel';
import { useDashboardData } from './useDashboardData';

vi.mock('../../api/backend', () => ({ isDesktopApp: false, isHostedWebApp: false,
  loadTokenUsageEntries: vi.fn(), loadDailyTokenUsage: vi.fn(), loadTokenUsageBreakdown: vi.fn(),
  loadAccountQuotaHistory: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let latest: ReturnType<typeof useDashboardData>;
let renders = 0;
let mounted = 0;
vi.mock('./index', () => ({ TokenUsageDashboard: (props: { weeks: number; refreshSeconds: number }) => {
  latest = useDashboardData({ ...props, thresholdTokens: 128000 });
  renders++;
  useEffect(() => { mounted++; return () => { mounted--; }; }, []);
  return null;
} }));
let root: Root;
const calls = () => [backend.loadTokenUsageEntries, backend.loadDailyTokenUsage,
  backend.loadTokenUsageBreakdown, backend.loadAccountQuotaHistory].map(fn => vi.mocked(fn).mock.calls.length);
let scope = 0;
async function render(active: boolean, weeks = scope) {
  await act(async () => root.render(<TokenUsagePanel active={active} weeks={weeks} refreshSeconds={1}
    language="en" themeColor="#3f7d58" />));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  for (const fn of [backend.loadTokenUsageEntries, backend.loadDailyTokenUsage,
    backend.loadTokenUsageBreakdown, backend.loadAccountQuotaHistory]) vi.mocked(fn).mockResolvedValue([]);
  renders = 0;
  mounted = 0;
  scope++;
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('performs no work before visiting; retains on hide and refreshes on reopen', async () => {
  await render(false);
  await act(async () => vi.advanceTimersByTimeAsync(5100));
  expect(calls()).toEqual([0, 0, 0, 0]);
  expect(renders).toBe(0);
  await render(true);
  expect(calls()).toEqual([1, 1, 1, 1]);
  await act(async () => vi.advanceTimersByTimeAsync(5100));
  expect(calls()).toEqual([6, 6, 6, 6]);
  await render(false);
  const pausedRenders = renders;
  expect(mounted).toBe(1);
  await act(async () => vi.advanceTimersByTimeAsync(5100));
  expect(calls()).toEqual([6, 6, 6, 6]);
  expect(renders).toBe(pausedRenders);
  await render(true);
  expect(calls()).toEqual([7, 7, 7, 7]);
  expect(latest.loading).toBe(false);
});

it('pauses reads while the document is hidden and retains the mounted dashboard', async () => {
  await render(true);
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const count = renders;
  await act(async () => vi.advanceTimersByTimeAsync(5100));
  expect(calls()).toEqual([1, 1, 1, 1]);
  expect(renders).toBe(count);
  expect(mounted).toBe(1);
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(calls()).toEqual([2, 2, 2, 2]);
});

it('keeps reads single-flight and ignores old results after range changes', async () => {
  let finish!: (value: []) => void;
  vi.mocked(backend.loadTokenUsageEntries).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(true);
  await act(async () => { latest.load(); latest.load(); await vi.advanceTimersByTimeAsync(5100); });
  expect(calls()).toEqual([1, 1, 1, 1]);
  await render(true, scope + 10);
  expect(latest.loading).toBe(true);
  expect(calls()).toEqual([1, 1, 1, 1]);
  await act(async () => finish([]));
  expect(calls()).toEqual([2, 2, 2, 2]);
  expect(latest.startTs).toBe(vi.mocked(backend.loadDailyTokenUsage).mock.lastCall?.[0]);
});

it('does not render a response or schedule more reads after hiding during a request', async () => {
  let finish!: (value: []) => void;
  vi.mocked(backend.loadTokenUsageEntries).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(true);
  await render(false);
  const count = renders;
  await act(async () => { finish([]); await vi.advanceTimersByTimeAsync(5100); });
  expect(calls()).toEqual([1, 1, 1, 1]);
  expect(renders).toBe(count);
});

it('subscribes to visibility only while selected and resynchronizes on entry', async () => {
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  await render(false);
  expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(0);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  await render(true);
  expect(mounted).toBe(0);
  expect(calls()).toEqual([0, 0, 0, 0]);
  await render(false);
  expect(remove.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await render(true);
  expect(mounted).toBe(1);
  add.mockRestore();
  remove.mockRestore();
});
