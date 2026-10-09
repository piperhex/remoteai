// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { DesktopCapture } from './capture';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

it('releases a Mac lease when the native runtime is missing and never requests legacy frames', async () => {
  vi.mocked(invoke).mockImplementation(async command => command === 'remote_desktop_open'
    ? { id: 'mac-lease', nativeOnly: true } : undefined);
  const capture = new DesktopCapture();
  await expect(capture.open(1920)).rejects.toThrow('更新电脑端');
  expect(invoke).toHaveBeenCalledWith('remote_desktop_close', { id: 'mac-lease' });
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'remote_desktop_frame')).toBe(false);
  await capture.close();
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'remote_desktop_close')).toHaveLength(1);
});
