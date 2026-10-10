// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDesktopSystemPermissions } from './useDesktopSystemPermissions';

const api = vi.hoisted(() => ({ invoke: vi.fn(), restartApplication: vi.fn() }));
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

it('repairs only the selected grant and requires an explicit restart', async () => {
  api.invoke.mockResolvedValue({ accessibility: true, screenRecording: true });
  await act(async () => root.render(<Harness />));
  api.invoke.mockResolvedValue({ settingsOpened: true });
  await act(async () => hook.repair('screenRecording'));
  expect(api.invoke).toHaveBeenLastCalledWith('remote_desktop_repair_system_permission',
    { permission: 'screenRecording' });
  expect(hook.permissions).toEqual({ accessibility: true, screenRecording: false,
    restartRequired: ['screenRecording'] });
  expect(api.restartApplication).not.toHaveBeenCalled();
  await act(async () => hook.restart());
  expect(api.restartApplication).toHaveBeenCalledOnce();
});

it('does not overlap a slow repair with polling or another permission action', async () => {
  await act(async () => root.render(<Harness />));
  let finish!: (value: { settingsOpened: boolean }) => void;
  api.invoke.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = hook.repair('accessibility'); });
  await act(async () => {
    await hook.repair('screenRecording'); await hook.request('screenRecording');
    await hook.restart(); await vi.advanceTimersByTimeAsync(15000);
  });
  expect(hook.busy).toBe(true);
  expect(api.invoke).toHaveBeenCalledTimes(2);
  expect(api.restartApplication).not.toHaveBeenCalled();
  await act(async () => { finish({ settingsOpened: true }); await pending; });
  expect(hook.busy).toBe(false);
});

it('ignores a stale grant check that returns after repair', async () => {
  await act(async () => root.render(<Harness />));
  let finish!: (value: typeof denied) => void;
  api.invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  api.invoke.mockResolvedValue({ settingsOpened: true });
  await act(async () => hook.repair('screenRecording'));
  await act(async () => finish({ accessibility: true, screenRecording: true }));
  expect(hook.permissions?.screenRecording).toBe(false);
  expect(hook.permissions?.restartRequired).toEqual(['screenRecording']);
});

it('preserves restart guidance if Settings could not open after a successful reset', async () => {
  await act(async () => root.render(<Harness />));
  api.invoke.mockResolvedValue({ settingsOpened: false });
  await act(async () => hook.repair('screenRecording'));
  expect(hook.permissions?.restartRequired).toEqual(['screenRecording']);
  expect(hook.error).toContain('权限已重置，请手动打开系统设置');
});

it('keeps existing grants when reset fails and never exposes internal errors', async () => {
  api.invoke.mockResolvedValue({ accessibility: true, screenRecording: true });
  await act(async () => root.render(<Harness />));
  api.invoke.mockRejectedValue(new Error('/Users/private secret'));
  await act(async () => hook.repair('screenRecording'));
  expect(hook.permissions?.screenRecording).toBe(true);
  expect(hook.permissions?.restartRequired).toBeUndefined();
  expect(hook.error).toContain('未能重置权限');
  expect(hook.error).not.toContain('private');
});

it('ignores late repair results after closing and reads restart state when reopened', async () => {
  await act(async () => root.render(<Harness />));
  let finish!: (value: { settingsOpened: boolean }) => void;
  api.invoke.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = hook.repair('screenRecording'); });
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => { finish({ settingsOpened: false }); await pending; });
  expect(hook.permissions).toEqual(denied);
  expect(hook.error).toBe('');
  api.invoke.mockResolvedValue({ ...denied, restartRequired: ['screenRecording'] });
  await act(async () => root.render(<Harness />));
  expect(hook.permissions?.restartRequired).toEqual(['screenRecording']);
  expect(hook.busy).toBe(false);
});
