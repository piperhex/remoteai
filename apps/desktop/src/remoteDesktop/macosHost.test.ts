import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { HostSession } from './hostSession';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const fallback = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock('./session', () => ({ DesktopHostSession: class {
  open = fallback.open;
  close = fallback.close;
} }));
const call = vi.mocked(invoke);
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  call.mockImplementation(async command => {
    if (command === 'remote_desktop_open') return { id: 'mac-lease', nativeOnly: true, platform: 'macos',
      displays: [{ id: 'macos:1', name: '显示器 1', width: 3024, height: 1964, primary: true }] };
    if (command === 'remote_desktop_stream_available') return true;
    if (command === 'remote_desktop_stream_open') return { sdp: 'mac-offer' };
  });
});
afterEach(() => vi.useRealTimers());

it('publishes macOS display discovery and controls through the existing viewer protocol', async () => {
  const session = new HostSession(DEFAULT_SETTINGS, []);
  expect(await session.open()).toMatchObject({ sdp: 'mac-offer',
    capabilities: { keyboard: true, control: true, platform: 'macos' },
    displays: [{ id: 'macos:1' }] });
  await session.close();
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_close', { id: 'mac-lease' });
  expect(fallback.open).not.toHaveBeenCalled();
});

it('preserves macOS encoder errors and releases the lease without attempting Windows capture', async () => {
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (command, args) => {
    if (command === 'remote_desktop_stream_open') throw new Error('屏幕录制不可用');
    return original(command, args);
  });
  await expect(new HostSession(DEFAULT_SETTINGS, []).open()).rejects.toThrow('屏幕录制不可用');
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_close', { id: 'mac-lease' });
  expect(fallback.open).not.toHaveBeenCalled();
});

it('retains Windows compatibility fallback without opening an extra lease', async () => {
  call.mockImplementation(async command => command === 'remote_desktop_open' ? 'windows-lease' : false);
  fallback.open.mockResolvedValue({ sdp: 'compatibility-offer' });
  expect(await new HostSession(DEFAULT_SETTINGS, []).open()).toMatchObject({ sdp: 'compatibility-offer' });
  expect(call.mock.calls.some(([command]) => command === 'remote_desktop_open')).toBe(false);
});
