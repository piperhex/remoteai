import { afterEach, expect, it, vi } from 'vitest';
import { idleDownload } from '../../../../shared/app-update/idleDownload';

afterEach(() => vi.useRealTimers());

it('postpones after activity, starts only when eligible and never overlaps slow work', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const eligible = vi.fn().mockResolvedValue(false);
  const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const scheduler = idleDownload({ eligible, run });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).not.toHaveBeenCalled();
  eligible.mockResolvedValue(true);
  scheduler.touch();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(90_000);
  expect(run).toHaveBeenCalledOnce();
  finish(); scheduler.dispose();
});

it('does not start after unmount or activity while the network check was pending', async () => {
  vi.useFakeTimers();
  for (const cancel of ['dispose', 'touch'] as const) {
    let resolve!: (allowed: boolean) => void;
    const run = vi.fn();
    const scheduler = idleDownload({ eligible: () => new Promise(done => { resolve = done; }), run });
    await vi.advanceTimersByTimeAsync(60_000);
    scheduler[cancel](); resolve(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).not.toHaveBeenCalled(); scheduler.dispose();
  }
});
