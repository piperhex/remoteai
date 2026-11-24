// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ServerSample, SshApi } from '../../../../../shared/terminal/ssh';
import { useServerMonitor } from '../../../../../shared/terminal/workspace/useServerMonitor';

it('polls one second after each completed sample while the SSH workspace is visible', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const values: ServerSample = { cpu: null, cpuPercent: 1, network: null, memory: null, disk: null, uptimeSeconds: 1 };
  const monitor = vi.fn<NonNullable<SshApi['monitor']>>().mockResolvedValue(values);
  const api: SshApi = { monitor, probe: vi.fn(), open: vi.fn(), files: vi.fn(),
    profiles: { list: vi.fn(), save: vi.fn(), remove: vi.fn() } };
  function Monitor() { useServerMonitor(api, 'session', true); return null; }
  const root = createRoot(document.createElement('div'));
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  try {
    await act(async () => root.render(<Monitor />));
    await advance(1000);
    expect(monitor).toHaveBeenCalledTimes(2);
    let finish!: (value: ServerSample) => void;
    monitor.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await advance(999);
    expect(monitor).toHaveBeenCalledTimes(2);
    await advance(1);
    await advance(3000);
    expect(monitor).toHaveBeenCalledTimes(3);
    await act(async () => finish(values));
    await advance(1000);
    expect(monitor).toHaveBeenCalledTimes(4);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(3000);
    expect(monitor).toHaveBeenCalledTimes(4);
    hidden.mockReturnValue(false);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(monitor).toHaveBeenCalledTimes(5);
  } finally {
    await act(async () => root.unmount());
    hidden.mockRestore(); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});
