import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { NativeDesktopSession } from './nativeSession';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const call = vi.mocked(invoke);
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
  const session = new NativeDesktopSession(DEFAULT_SETTINGS, []);
  const opening = session.open();
  const rejected = expect(opening).rejects.toThrow('连接已结束');
  await vi.advanceTimersByTimeAsync(0);
  session.close(); resolveLease('late-lease');
  await rejected;
  expect(call).toHaveBeenCalledWith('remote_desktop_stream_close', { id: 'late-lease' });
  expect(call.mock.calls.some(([command]) => command === 'remote_desktop_stream_open')).toBe(false);
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
