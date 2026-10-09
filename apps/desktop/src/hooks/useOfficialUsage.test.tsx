// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { loadOfficialUsage } from '../api/officialUsage';
import { useOfficialUsage } from './useOfficialUsage';
import type { OfficialUsageSummary } from '../../../../shared/officialUsage';

vi.mock('../api/officialUsage', () => ({ loadOfficialUsage: vi.fn() }));

it('keeps the view interactive while a refresh is pending and never overlaps polling', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let complete: (data: OfficialUsageSummary) => void = () => {};
  vi.mocked(loadOfficialUsage).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const container = document.createElement('div');
  const root = createRoot(container);
  let clicks = 0;
  function View({ active }: { active: boolean }) {
    const { loading } = useOfficialUsage({ active, refreshSeconds: 1 });
    return <button onClick={() => { clicks += 1; }}>{loading ? 'loading' : 'ready'}</button>;
  }
  try {
    await act(async () => root.render(<View active />));
    await act(async () => vi.advanceTimersByTimeAsync(180000));
    container.querySelector('button')!.click();
    expect(clicks).toBe(1);
    expect(loadOfficialUsage).toHaveBeenCalledTimes(1);
    await act(async () => complete({ accounts: [], status: 'signedOut', updatedAt: 100 }));
    expect(container.textContent).toBe('ready');
    await act(async () => root.render(<View active={false} />));
    await act(async () => vi.advanceTimersByTimeAsync(180000));
    expect(loadOfficialUsage).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
