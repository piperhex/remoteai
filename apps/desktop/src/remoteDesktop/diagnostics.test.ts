import { afterEach, expect, it, vi } from 'vitest';
import { desktopFailure } from '../../../../shared/remote-desktop/diagnostics';
import { DesktopReceiver } from '../../../../shared/remote-desktop/receiver';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';
import { connectionDiagnostic } from '../../../../shared/remote-chat/diagnostics';
import { sanitizeDiagnostic } from '../../../../shared/remote-chat/diagnosticSchema';
import { readFileSync } from 'node:fs';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('classifies every display-safe native desktop error without relying on partial text matches', () => {
  const source = readFileSync(new URL('../../src-tauri/src/remote_desktop/mod.rs', import.meta.url), 'utf8');
  const messages = [...source.matchAll(/DesktopError::\w+\s*=>\s*"([^"]+)"/g)].map(match => match[1]);
  expect(messages.length).toBeGreaterThan(10);
  for (const message of messages) expect(desktopFailure(message).desktopError, message).not.toBe('unknown');
});

it.each([
  ['请在 Mac 的远程设置中开启屏幕录制权限，然后重新连接。', 'screen-permission', 'permission'],
  ['请在 Mac 的远程设置中开启辅助功能权限，然后重新连接。', 'accessibility-permission', 'permission'],
  ['远程桌面需要 macOS 13 或更新版本。', 'macos-version', 'unsupported'],
  ['未找到可用显示器，请确认电脑已连接显示器并登录桌面。', 'no-displays', 'unavailable'],
  ['远程桌面设置未能读取，请在电脑端重新打开远程设置。', 'settings-unavailable', 'unavailable'],
  ['获取屏幕画面超时，请重新连接。', 'encoder-timeout', 'timeout'],
])('classifies native strings and encrypted RPC errors: %s', (message, desktopError, reason) => {
  expect(desktopFailure(message)).toEqual({ desktopError, reason });
  expect(desktopFailure(new Error(message))).toEqual({ desktopError, reason });
});

it('never uploads unknown text, injected desktop codes, display identities or native details', () => {
  const message = '请在 Mac 的远程设置中开启屏幕录制权限，然后重新连接。 /Users/private token=private';
  expect(desktopFailure(new Error(message))).toEqual({ desktopError: 'unknown', reason: 'unknown' });
  expect(desktopFailure(new DOMException('private-address', 'NotAllowedError'))).toEqual({
    desktopError: 'unknown', reason: 'permission',
  });
  expect(sanitizeDiagnostic({ desktopError: 'private-token', hostPlatform: 'private-path',
    displayName: 'private-display', displayCount: -1, nativeOnly: true } as never)).toEqual({ nativeOnly: true });
});

it('keeps the host failure reason when the shared phone/Web receiver has not created a media peer', async () => {
  vi.useFakeTimers(); vi.spyOn(console, 'debug').mockImplementation(() => {});
  const diagnostic = vi.fn(), createPeer = vi.fn(), status = vi.fn();
  const message = '请在 Mac 的远程设置中开启辅助功能权限，然后重新连接。';
  const receiver = new DesktopReceiver({ client: { diagnostic, open: vi.fn().mockRejectedValue(new Error(message)),
    signal: vi.fn(), close: vi.fn(), settings: vi.fn() }, createPeer,
  status, stream: vi.fn(), stats: vi.fn() });
  await receiver.start(DEFAULT_SETTINGS);
  expect(createPeer).not.toHaveBeenCalled();
  expect(diagnostic).toHaveBeenCalledWith('desktop-failed', expect.objectContaining({
    stage: 'request-open', desktopError: 'accessibility-permission', reason: 'permission', scope: 'desktop',
  }));
  expect(status).toHaveBeenCalledWith(message);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(message);
  await receiver.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('retains a native refusal during signaling after an offer was accepted', async () => {
  vi.useFakeTimers();
  const diagnostic = vi.fn();
  const pc = { addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn(),
    setRemoteDescription: vi.fn(), createAnswer: vi.fn(async () => ({ sdp: 'answer' })),
    setLocalDescription: vi.fn() };
  const receiver = new DesktopReceiver({ client: { diagnostic,
    open: vi.fn(async () => ({ sdp: 'offer', iceServers: [] })), close: vi.fn(), settings: vi.fn(),
    signal: vi.fn().mockRejectedValue(new Error('桌面连接已结束，请重新连接。')),
  }, createPeer: () => pc as unknown as RTCPeerConnection, status: vi.fn(), stream: vi.fn(), stats: vi.fn() });
  await receiver.start(DEFAULT_SETTINGS);
  expect(diagnostic).toHaveBeenCalledWith('desktop-failed', expect.objectContaining({
    stage: 'signal', desktopError: 'lease-expired', reason: 'invalid-state',
  }));
  expect(pc.setRemoteDescription).toHaveBeenCalled();
  expect(pc.close).toHaveBeenCalled();
  await receiver.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('reserves failure reporting after ICE noise without allowing unlimited desktop reports', () => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  const report = vi.fn(), diagnostic = connectionDiagnostic('session', true, report);
  for (let i = 0; i < 200; i++) diagnostic('ice-candidate', { candidateType: 'host' });
  diagnostic('desktop-failed', { stage: 'capture-open', desktopError: 'screen-permission', reason: 'permission' });
  expect(report).toHaveBeenLastCalledWith('desktop-failed', expect.objectContaining({
    desktopError: 'screen-permission', stage: 'capture-open',
  }));
  for (let i = 0; i < 100; i++) diagnostic('desktop-failed', { desktopError: 'unknown' });
  expect(report).toHaveBeenCalledTimes(180);
});
