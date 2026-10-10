import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { NativeDesktopSession } from './nativeSession';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const call = vi.mocked(invoke);
it('does not touch privacy during ordinary sessions and preserves the native lease when toggled', async () => {
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (command, args) => {
    if (command === 'remote_desktop_privacy') {
      return { ticket: 'test', pending: false,
        snapshot: { displayId: 'private', privacyScreen: (args as { enabled: boolean }).enabled, displays: [] } };
    }
    return original(command, args);
  });
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, []);
  await session.open(); await session.update(DEFAULT_SETTINGS);
  expect(call.mock.calls.some(([command]) => command === 'remote_desktop_privacy')).toBe(false);
  await expect(session.privacy(true)).resolves.toMatchObject({ privacyScreen: true });
  await expect(session.privacy(false)).resolves.toMatchObject({ privacyScreen: false });
  expect(call.mock.calls.filter(([command]) => command === 'remote_desktop_stream_open')).toHaveLength(1);
  expect(call.mock.calls.some(([command]) => command === 'remote_desktop_stream_close')).toBe(false);
  await session.close();
});

it('polls a pending privacy transition without a long-running IPC call', async () => {
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (command, args) => {
    if (command !== 'remote_desktop_privacy') return original(command, args);
    if ((args as { ticket?: string }).ticket) return { ticket: 'test', pending: false,
      snapshot: { privacyScreen: true, displayId: 'private', displays: [] } };
    return { ticket: 'test', pending: true };
  });
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, []);
  await session.open();
  const changing = session.privacy(true);
  await vi.advanceTimersByTimeAsync(250);
  await expect(changing).resolves.toMatchObject({ privacyScreen: true });
  expect(call).toHaveBeenLastCalledWith('remote_desktop_privacy', { id: 'native-lease', ticket: 'test' });
  expect(session.closed).toBe(false);
  await session.close();
});

it('keeps normal sessions open on a privacy preflight refusal but closes an ambiguous accepted toggle', async () => {
  const original = call.getMockImplementation()!;
  let accepted = false;
  call.mockImplementation(async (command, args) => {
    if (command !== 'remote_desktop_privacy') return original(command, args);
    if (!accepted) throw '请先在电脑的远程设置中开启无人值守，再使用隐私屏。';
    if ((args as { ticket?: string }).ticket) throw new Error('lost reply');
    return { ticket: 'test', pending: true };
  });
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, []);
  await session.open();
  await expect(session.privacy(true)).rejects.toThrow('无人值守');
  expect(session.closed).toBe(false);
  accepted = true;
  const changing = expect(session.privacy(true)).rejects.toThrow('隐私屏未能切换');
  await vi.advanceTimersByTimeAsync(250); await changing;
  expect(session.closed).toBe(true);
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_close', { id: 'native-lease' });
});
it('starts automatic native capture at maximum quality and restores it after manual settings', async () => {
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, []);
  await session.open();
  const automatic = { width: 2560, fps: 60, bitrate: 12_000_000, codec: 'h264',
    adaptiveFps: true, adaptiveResolution: true };
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_open', { request: expect.objectContaining({
    profile: automatic,
  }) });
  await session.update({ quality: 'clear', fps: 45 });
  expect(call).toHaveBeenLastCalledWith('remote_desktop_stream_update', { id: 'native-lease', profile: {
    width: 1920, fps: 45, bitrate: 8_000_000, codec: 'h264', adaptiveFps: false, adaptiveResolution: false,
  } });
  await session.update(DEFAULT_SETTINGS);
  expect(call).toHaveBeenLastCalledWith('remote_desktop_stream_update', { id: 'native-lease', profile: automatic });
  await session.close();
});

it('requests HEVC only for receivers that advertised it', async () => {
  const session = new NativeDesktopSession({ ...DEFAULT_SETTINGS, videoCodecs: ['h265', 'h264'] }, []);
  await session.open();
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_open', { request: expect.objectContaining({
    profile: expect.objectContaining({ codec: 'h265' }),
  }) });
  await session.close();
});
beforeEach(() => {
  vi.useFakeTimers(); call.mockReset();
  call.mockImplementation(async command => {
    if (command === 'remote_desktop_stream_available') return true;
    if (command === 'remote_desktop_open') return 'native-lease';
    if (command === 'remote_desktop_stream_open') return { sdp: 'offer' };
    return { closed: false };
  });
});
afterEach(() => { vi.useRealTimers(); });

it.each([
  ['remote_desktop_stream_available', false, 'runtime-check', 'runtime-unavailable'],
  ['remote_desktop_stream_available', 'private native failure', 'runtime-check', 'unknown'],
  ['remote_desktop_open', '请在 Mac 的远程设置中开启屏幕录制权限，然后重新连接。',
    'capture-open', 'screen-permission'],
  ['remote_desktop_open', '未找到可用显示器，请确认电脑已连接显示器并登录桌面。', 'capture-open', 'no-displays'],
  ['remote_desktop_stream_open', '未能启动屏幕共享，请重新打开电脑端应用后重试。', 'stream-open', 'encoder-start'],
])('uploads early native startup failures at %s', async (failingCommand, error, stage, desktopError) => {
  const original = call.getMockImplementation()!, diagnostic = vi.fn();
  call.mockImplementation(async (command, args) => {
    if (command !== failingCommand) return original(command, args);
    if (error === false) return false;
    throw error;
  });
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, [], undefined, diagnostic);
  await expect(session.open()).rejects.toBeDefined();
  const failures = diagnostic.mock.calls.filter(([event]) => event === 'desktop-failed');
  expect(failures).toHaveLength(1);
  expect(failures[0][1]).toMatchObject({ stage, desktopError, durationMs: expect.any(Number) });
  if (typeof error === 'string') expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(error);
  if (stage !== 'stream-open') expect(call.mock.calls.some(([command]) => command === 'remote_desktop_stream_open'))
    .toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('reports safe platform and display metadata without names, IDs or credentials', async () => {
  const original = call.getMockImplementation()!, diagnostic = vi.fn();
  call.mockImplementation(async (command, args) => {
    if (command === 'remote_desktop_open') return { id: 'private-lease', nativeOnly: true, platform: 'macos',
      displays: [{ id: 'private-id', name: 'private-name' }], permissions: { enabled: true } };
    return original(command, args);
  });
  const session = new NativeDesktopSession(DEFAULT_SETTINGS,
    [{ urls: 'turn:private.test', username: 'private-user', credential: 'private-secret' }], undefined, diagnostic);
  await session.open();
  expect(diagnostic).toHaveBeenCalledWith('desktop-stage', expect.objectContaining({
    stage: 'ready', hostPlatform: 'macos', displayCount: 1, nativeOnly: true, desktopEnabled: true,
  }));
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private');
  await session.close();
});

it('renews only the authenticated expiry and closes when renewal is refused', async () => {
  const expiresAt = Date.now() + 30_000;
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, [], expiresAt);
  await session.open();
  expect(call).toHaveBeenCalledWith('remote_desktop_open', { displayId: undefined, expiresAt });
  await vi.advanceTimersByTimeAsync(2000);
  expect(call).toHaveBeenCalledWith('remote_desktop_renew', { id: 'native-lease', expiresAt });
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (command, args) => {
    if (command === 'remote_desktop_renew') throw new Error('expired');
    return original(command, args);
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(session.closed).toBe(true);
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_close', { id: 'native-lease' });
});

it('releases a lease returned after cancellation without starting capture', async () => {
  let resolveLease!: (value: string) => void;
  call.mockImplementation(async command => command === 'remote_desktop_stream_available'
    ? true : command === 'remote_desktop_open' ? new Promise<string>(resolve => { resolveLease = resolve; }) : undefined);
  const diagnostic = vi.fn();
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, [], undefined, diagnostic);
  const opening = session.open();
  const rejected = expect(opening).rejects.toThrow('连接已结束');
  await vi.advanceTimersByTimeAsync(0);
  session.close(); resolveLease('late-lease');
  await rejected;
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_close', { id: 'late-lease' });
  expect(call.mock.calls.some(([command]) => command === 'remote_desktop_stream_open')).toBe(false);
  expect(diagnostic).toHaveBeenCalledWith('desktop-stage', expect.objectContaining({ stage: 'cancelled' }));
  expect(diagnostic.mock.calls.some(([event]) => event === 'desktop-failed')).toBe(false);
});

it('waits for failed encoder cleanup before allowing the fallback to open', async () => {
  const original = call.getMockImplementation()!;
  const events: string[] = [];
  call.mockImplementation(async (command, args) => {
    if (command === 'remote_desktop_stream_open') throw new Error('unsupported encoder');
    if (command === 'remote_desktop_stream_close') {
      await new Promise(resolve => setTimeout(resolve, 30)); events.push('closed'); return;
    }
    return original(command, args);
  });
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, []);
  const opening = session.open().catch(() => { events.push('fallback'); });
  await vi.advanceTimersByTimeAsync(50); await opening;
  expect(events).toEqual(['closed', 'fallback']);
});

it('passes authenticated TURN credentials and polls without overlap', async () => {
  const ice = [{ urls: 'turn:relay.test:3479', username: 'temporary', credential: 'test-only' }];
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, ice);
  expect(await session.open()).toEqual({ sdp: 'offer', iceServers: ice });
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_open', { request: expect.objectContaining({
    iceServers: [{ ...ice[0], urls: [ice[0].urls] }],
  }) });
  let resolveStatus!: (value: { closed: boolean }) => void;
  call.mockImplementation(command => command === 'remote_desktop_stream_status'
    ? new Promise(resolve => { resolveStatus = resolve; }) : Promise.resolve(undefined));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(call.mock.calls.filter(([command]) => command === 'remote_desktop_stream_status')).toHaveLength(1);
  session.close(); resolveStatus({ closed: false });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(call.mock.calls.filter(([command]) => command === 'remote_desktop_stream_status')).toHaveLength(1);
});

it('opens the selected screen, returns discovery and waits for native close before another screen opens', async () => {
  const original = call.getMockImplementation()!;
  const display = { id: 'second', name: 'DISPLAY2', width: 1080, height: 1920, primary: false };
  let release!: () => void;
  call.mockImplementation(async (command, args) => {
    if (command === 'remote_desktop_open') return { id: 'lease-2', displays: [display], displayId: display.id };
    if (command === 'remote_desktop_stream_close') return new Promise<void>(resolve => { release = resolve; });
    return original(command, args);
  });
  const session = new NativeDesktopSession({ ...DEFAULT_SETTINGS, displayId: display.id }, []);
  expect(await session.open()).toMatchObject({ displays: [display], displayId: display.id });
  expect(call).toHaveBeenCalledWith('remote_desktop_open', { displayId: display.id });
  let closed = false;
  const closing = session.close().then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  const repeatedClose = session.close();
  release(); await closing; await repeatedClose;
  expect(closed).toBe(true);
  expect(call.mock.calls.filter(([command]) => command === 'remote_desktop_stream_close')).toHaveLength(1);
});
