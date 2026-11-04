// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCodexServiceStatus } from '../../../../shared/codex-status/useCodexServiceStatus';
import { DEFAULT_REFRESH_MINUTES, refreshMinutes, saveStatusRefreshMinutes }
  from '../../../../shared/codex-status/preferences';
import { serviceHealth, type CodexServiceStatus, type ReadCodexServiceStatus }
  from '../../../../shared/codex-status/status';
import { createGuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { ChatOperations } from './operations';
import { invoke } from '../api/backend';

vi.mock('../api/backend', () => ({ invoke: vi.fn(), hasLocalBackend: false }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
const normal: CodexServiceStatus = { api: 'operational', cli: 'operational' };
let root: Root;
let host: HTMLDivElement;
function Fixture({ read, active = true }: { read: ReadCodexServiceStatus; active?: boolean }) {
  return <output>{useCodexServiceStatus(read, active)}</output>;
}
const render = (read: ReadCodexServiceStatus, active = true) => act(async () => {
  root.render(<StrictMode><Fixture read={read} active={active} /></StrictMode>);
});
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each(['direct', 'relay'] as const)('fetches on the selected host through %s', async mode => {
  vi.mocked(invoke).mockResolvedValue(normal);
  const operations = new ChatOperations();
  const client = createGuiToolsClient(async <T,>(body: object) => {
    const response = await operations.execute({ kind: 'request', id: 'status', method: 'request', body }, mode);
    if (response.error) throw new Error(response.error);
    return response.data as T;
  });
  expect(await client.serviceStatus()).toEqual(normal);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('get_codex_service_status');
});

it('only shows operational when both services are healthy', () => {
  expect(serviceHealth(normal)).toBe('operational');
  expect(serviceHealth({ api: 'disrupted', cli: 'operational' })).toBe('disrupted');
  expect(serviceHealth({ api: 'operational', cli: 'disrupted' })).toBe('disrupted');
  expect(serviceHealth({ api: 'unknown', cli: 'disrupted' })).toBe('disrupted');
  expect(serviceHealth({ api: 'unknown', cli: 'operational' })).toBe('unknown');
  expect(serviceHealth()).toBe('unknown');
  for (const invalid of [NaN, 0, -1, 1.5, 61]) expect(refreshMinutes(invalid)).toBe(DEFAULT_REFRESH_MINUTES);
});

it('polls every five minutes, applies settings, and stops when inactive', async () => {
  const read = vi.fn<ReadCodexServiceStatus>().mockResolvedValue(normal);
  await render(read);
  expect(host.textContent).toBe('operational'); expect(read).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(299_999));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => saveStatusRefreshMinutes(1));
  const before = read.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(read).toHaveBeenCalledTimes(before + 1);
  await render(read, false);
  await act(async () => vi.advanceTimersByTimeAsync(300_000));
  expect(read).toHaveBeenCalledTimes(before + 1);
});

it('keeps one request in flight and ignores the previous computer response', async () => {
  let finish!: (value: CodexServiceStatus) => void;
  const oldRead = vi.fn<ReadCodexServiceStatus>(() => new Promise(resolve => { finish = resolve; }));
  await render(oldRead);
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(oldRead).toHaveBeenCalledTimes(1);
  const read = vi.fn<ReadCodexServiceStatus>().mockResolvedValue({ api: 'disrupted', cli: 'operational' });
  await render(read);
  await act(async () => finish(normal));
  expect(host.textContent).toBe('disrupted');
  read.mockRejectedValue(new Error('offline'));
  await act(async () => vi.advanceTimersByTimeAsync(300_000));
  expect(host.textContent).toBe('unknown');
  read.mockResolvedValue(normal);
  await act(async () => vi.advanceTimersByTimeAsync(300_000));
  expect(host.textContent).toBe('operational');
});
