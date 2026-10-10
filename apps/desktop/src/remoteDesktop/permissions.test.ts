import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { RemoteDesktopHost } from './host';
import { desktopPermissionStatus } from './permissions';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const call = vi.mocked(invoke);
let enabled = true; let control = true;
let grants: { screenRecording: boolean; accessibility: boolean } | null;
beforeEach(() => {
  vi.clearAllMocks(); enabled = true; control = true;
  grants = { screenRecording: false, accessibility: false };
  call.mockImplementation(async command => command === 'remote_desktop_permissions' ? { enabled, control } : grants);
});

it('only allows authenticated, unexpired peers to inspect grants without a capture session', async () => {
  const host = new RemoteDesktopHost();
  await expect(host.request({ action: 'permissions' }, 'unknown')).rejects.toThrow('连接电脑');
  host.register('expired', [], Date.now() - 1);
  await expect(host.request({ action: 'permissions' }, 'expired')).rejects.toThrow('已结束');
  expect(call).not.toHaveBeenCalled();
  host.register('owner', [], Date.now() + 60_000);
  await expect(host.request({ action: 'permissions' }, 'owner')).resolves.toEqual({ required: 'screenRecording' });
  expect(call.mock.calls).toEqual([['remote_desktop_permissions'], ['remote_desktop_system_permissions']]);
  host.release();
  await expect(host.request({ action: 'permissions' }, 'owner')).rejects.toThrow('连接电脑');
});

it('checks screen recording before accessibility and respects view-only policy', async () => {
  expect(await desktopPermissionStatus()).toEqual({ required: 'screenRecording' });
  grants!.screenRecording = true;
  expect(await desktopPermissionStatus()).toEqual({ required: 'accessibility' });
  control = false; expect(await desktopPermissionStatus()).toEqual({ required: null });
  enabled = false; await expect(desktopPermissionStatus()).rejects.toThrow('未允许');
});

it('allows hosts without Mac system grants and never treats an IPC failure as a grant', async () => {
  grants = null; expect(await desktopPermissionStatus()).toEqual({ required: null });
  call.mockRejectedValue(new Error('permission status unavailable'));
  await expect(desktopPermissionStatus()).rejects.toThrow('unavailable');
});
