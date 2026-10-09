// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDesktopSystemPermissions } from './useDesktopSystemPermissions';

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../api/backend', () => api);
let root: Root;
let hook: ReturnType<typeof useDesktopSystemPermissions>;
function Harness({ active = true }: { active?: boolean }) { hook = useDesktopSystemPermissions(active); return null; }
const denied = { accessibility: false, screenRecording: false };

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement('div'));
  api.invoke.mockResolvedValue(denied);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

it('checks grants without prompting and polls single-flight only while settings are open', async () => {
  let finish!: (value: typeof denied) => void;
  api.invoke.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(api.invoke.mock.calls).toEqual([['remote_desktop_system_permissions']]);
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => { finish(denied); await vi.advanceTimersByTimeAsync(15000); });
  expect(api.invoke).toHaveBeenCalledTimes(1);
  expect(hook.permissions).toBeNull();
});

it('requests only the permission explicitly chosen by the host user', async () => {
  await act(async () => root.render(<Harness />));
  api.invoke.mockResolvedValue({ ...denied, screenRecording: true });
  await act(async () => hook.request('screenRecording'));
  expect(api.invoke).toHaveBeenLastCalledWith('remote_desktop_system_permissions', { request: 'screenRecording' });
  expect(hook.permissions?.screenRecording).toBe(true);
  expect(hook.permissions?.accessibility).toBe(false);
});
