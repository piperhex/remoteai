// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../api/backend';
import { useUsageStatus } from './useUsageStatus';
import { USAGE_REFRESH_INTERVAL_MS } from '../../../../../shared/remote-chat/usage';

vi.mock('../../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let root: Root;
let result: ReturnType<typeof useUsageStatus>;
function Probe({ active = true }: { active?: boolean }) { result = useUsageStatus(active); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(invoke).mockReset(); root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps polling single-flight, reports failures, and stops while hidden', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(invoke).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  await act(async () => root.render(<Probe />));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(invoke).toHaveBeenCalledExactlyOnceWith('codex_gui_usage_summary');
  await act(async () => reject(new Error('private error')));
  expect(result.error).not.toBe(''); expect(result.error).not.toContain('private');
  await act(async () => root.render(<Probe active={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('clears malformed local usage and recovers without stopping polling', async () => {
  const usage = { totalTokens: 1_520, estimatedCostUsd: 2.5, primaryRemainingPercent: null,
    primaryRemainingAggregated: false, providerEstimatedCost: null };
  vi.mocked(invoke).mockResolvedValueOnce(usage).mockResolvedValueOnce({}).mockResolvedValue(usage);
  await act(async () => root.render(<Probe />));
  expect(result.usage).toEqual(usage);
  await act(async () => vi.advanceTimersByTimeAsync(USAGE_REFRESH_INTERVAL_MS));
  expect(result.usage).toBeNull();
  expect(result.error).toBe('暂时无法刷新用量，请稍后重试。');
  await act(async () => vi.advanceTimersByTimeAsync(USAGE_REFRESH_INTERVAL_MS));
  expect(result.usage).toEqual(usage);
  expect(result.error).toBe('');
});
