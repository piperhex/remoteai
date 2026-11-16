import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { HostSession } from './hostSession';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const browser = vi.fn(() => { throw new Error('Browser RTC must not run'); });
const call = vi.mocked(invoke);
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('RTCPeerConnection', browser);
  call.mockImplementation(async command => {
    if (command === 'remote_desktop_open') return { id: 'mac-lease', nativeOnly: true, platform: 'macos',
      displays: [{ id: 'macos:1', name: '显示器 1', width: 3024, height: 1964, primary: true }] };
    if (command === 'remote_desktop_stream_available') return true;
    if (command === 'remote_desktop_stream_open') return { sdp: 'mac-offer' };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('publishes macOS display discovery and controls through the existing viewer protocol', async () => {
  const session = new HostSession(DEFAULT_SETTINGS, []);
  expect(await session.open()).toMatchObject({ sdp: 'mac-offer',
    capabilities: { keyboard: true, control: true, platform: 'macos' },
    displays: [{ id: 'macos:1' }] });
  await session.close();
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_close', { id: 'mac-lease' });
  expect(browser).not.toHaveBeenCalled();
});

it('uses Retina backing pixels for capture quality on all viewers', async () => {
  const original = call.getMockImplementation()!;
  const display = { id: 'macos:1', name: '显示器 1', width: 3840, height: 2160, primary: true };
  call.mockImplementation(async (command, args) => command === 'remote_desktop_open'
    ? { id: 'mac-lease', nativeOnly: true, platform: 'macos', displays: [display], displayId: display.id }
    : original(command, args));
  const session = new HostSession(DEFAULT_SETTINGS, []);
  expect(await session.open()).toMatchObject({ displays: [display] });
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_open', { request: expect.objectContaining({
    profile: expect.objectContaining({ width: 2560, codec: 'h264' }),
  }) });
  await session.close();
});

it('preserves macOS encoder errors and releases the lease without attempting Windows capture', async () => {
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (command, args) => {
    if (command === 'remote_desktop_stream_open') throw new Error('屏幕录制不可用');
    return original(command, args);
  });
  await expect(new HostSession(DEFAULT_SETTINGS, []).open()).rejects.toThrow('屏幕录制不可用');
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_close', { id: 'mac-lease' });
  expect(browser).not.toHaveBeenCalled();
});

it('reports an unavailable native runtime without constructing browser RTC or opening an extra lease', async () => {
  call.mockResolvedValue(false);
  await expect(new HostSession(DEFAULT_SETTINGS, []).open()).rejects.toBeDefined();
  expect(browser).not.toHaveBeenCalled();
  expect(call.mock.calls.some(([command]) => command === 'remote_desktop_open')).toBe(false);
});

it.each(['屏幕录制', '辅助功能'])('does not retry %s refusals through capture fallback', async permission => {
  const message = `请在 Mac 的远程设置中开启${permission}权限，然后重新连接。`;
  call.mockImplementation(async command => {
    if (command === 'remote_desktop_open') throw message;
    return command === 'remote_desktop_stream_available';
  });
  await expect(new HostSession(DEFAULT_SETTINGS, []).open()).rejects.toBe(message);
  expect(browser).not.toHaveBeenCalled();
  expect(call.mock.calls.filter(([command]) => command === 'remote_desktop_open')).toHaveLength(1);
});

it('retains the native startup failure instead of hiding it with a browser fallback', async () => {
  call.mockResolvedValue(false);
  const diagnostic = vi.fn();
  await expect(new HostSession(DEFAULT_SETTINGS, [], undefined, diagnostic).open()).rejects.toBeDefined();
  expect(diagnostic).toHaveBeenCalledWith('desktop-failed', expect.objectContaining({
    stage: 'runtime-check', desktopError: 'runtime-unavailable',
  }));
  expect(browser).not.toHaveBeenCalled();
});

it.each(['client.remoteDesktop.lockedRequiresUnattended', 'client.remoteDesktop.privacyRequiresUnattended',
  'client.remoteDesktop.privacyFailed',
  '请在电脑上确认安装，完成后再点一次隐私屏。', '隐私屏未能切换，请重新连接后重试。'])
('preserves Windows setup refusals without silently falling back to ordinary capture: %s', async message => {
  call.mockImplementation(async command => {
    if (command === 'remote_desktop_open') {
      return { id: 'windows-lease', nativeOnly: false, platform: 'windows' };
    }
    if (command === 'remote_desktop_stream_open') throw message;
    return command === 'remote_desktop_stream_available';
  });
  await expect(new HostSession(DEFAULT_SETTINGS, []).open()).rejects.toBe(message);
  expect(browser).not.toHaveBeenCalled();
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_close', { id: 'windows-lease' });
});
