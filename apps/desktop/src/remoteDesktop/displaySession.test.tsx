// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDesktopSession } from '../../../../shared/remote-desktop/useDesktopSession';
import { DesktopDisplaySession } from '../../../../shared/remote-desktop/displaySession';
import type { DesktopSecurity } from '../../../../shared/remote-desktop/security';
import type { DesktopCapabilities, DesktopClient, DesktopDisplays, DesktopResolution, DesktopSettings }
  from '../../../../shared/remote-desktop/protocol';
import type { DesktopDirectRetry } from '../../../../shared/remote-desktop/directRetry';
import { desktopOccupied } from '../../../../shared/remote-desktop/takeover';

interface FakeSession {
  options: { client: DesktopClient; stream: (stream?: MediaStream) => void; displays: (value: DesktopDisplays) => void;
    capabilities: (value: DesktopCapabilities) => void;
    failed: (message: string) => void; status: (value: string) => void; directRetry: DesktopDirectRetry };
  start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; input: ReturnType<typeof vi.fn>;
  settings: ReturnType<typeof vi.fn>; mute: ReturnType<typeof vi.fn>; sessionId: string;
  privacy: ReturnType<typeof vi.fn>;
  security: ReturnType<typeof vi.fn>;
  resolution: ReturnType<typeof vi.fn<(size: DesktopResolution) => Promise<void>>>;
}
const runtime = vi.hoisted(() => ({
  sessions: [] as FakeSession[], multiDisplay: false, openFailure: '',
  security: undefined as DesktopSecurity | undefined, privacyFailure: '',
}));
vi.mock('../../../../shared/remote-desktop/receiver', () => ({ DesktopReceiver: class {
  sessionId = `desktop-${runtime.sessions.length}`;
  start = vi.fn(async (settings: DesktopSettings) => {
    if (runtime.openFailure) { this.options.failed(runtime.openFailure); return; }
    this.options.displays({ displays: [], displayId: runtime.multiDisplay ? settings.displayId : 'first',
      security: runtime.security });
    if (runtime.multiDisplay || runtime.security) {
      this.options.capabilities({ displaySessions: true, control: true, privacyScreen: true });
    }
    this.options.stream({} as MediaStream);
  });
  stop = vi.fn(async () => { this.options.stream(undefined); });
  input = vi.fn(); settings = vi.fn(); mute = vi.fn();
  security = vi.fn(async (change: object) => ({ lockOnDisconnect: false, muteHost: false, ...change }));
  privacy = vi.fn(async (enabled: boolean) => {
    if (runtime.privacyFailure) throw new Error(runtime.privacyFailure);
    this.options.displays({ displayId: enabled ? 'private' : 'first', privacyScreen: enabled });
  });
  resolution = vi.fn(async (size: DesktopResolution) => {
    this.options.displays({ displayId: 'first', resolutions: [size],
      displays: [{ id: 'first', name: 'DISPLAY1', primary: true, ...size }] });
  });
  constructor(public options: FakeSession['options']) { runtime.sessions.push(this); }
} }));
const client: DesktopClient = { open: vi.fn(), signal: vi.fn(), settings: vi.fn(), close: vi.fn() };
const createPeer = vi.fn();
let root: Root;
let session: ReturnType<typeof useDesktopSession>;
function Harness({ active = true, connected = true, background = false }) {
  session = useDesktopSession({ client, active, connected, background, createPeer }); return null;
}
beforeEach(async () => {
  runtime.sessions.length = 0; runtime.multiDisplay = false; runtime.openFailure = '';
  runtime.security = undefined; runtime.privacyFailure = '';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('waits for takeover confirmation without auto-reconnecting and leaves cancellation idle', async () => {
  vi.useFakeTimers();
  await act(async () => runtime.sessions[0].options.failed(desktopOccupied(crypto.randomUUID())));
  expect(session.takeover.pending).toBe(true);
  expect(session.status).toBe('client.remoteDesktop.connectionInUse');
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(runtime.sessions).toHaveLength(1);
  await act(async () => session.takeover.cancel());
  expect(session.takeover.pending).toBe(false);
  expect(session.status).toBe('client.remoteDesktop.connectionCancelled');
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(runtime.sessions).toHaveLength(1);
});

it('restarts once after confirmation and discards prompts when the viewer closes', async () => {
  const group = crypto.randomUUID();
  vi.mocked(client.open).mockClear();
  await act(async () => runtime.sessions[0].options.failed(desktopOccupied(group)));
  await act(async () => { session.takeover.confirm(); session.takeover.confirm(); });
  expect(runtime.sessions).toHaveLength(2); expect(session.takeover.pending).toBe(false);
  const settings: DesktopSettings = { fps: 'auto', quality: 'auto' };
  await runtime.sessions[1].options.client.open('confirmed', settings);
  await runtime.sessions[1].options.client.open('retry', settings);
  expect(client.open).toHaveBeenNthCalledWith(1, 'confirmed', settings, group);
  expect(client.open).toHaveBeenNthCalledWith(2, 'retry', settings, undefined);
  await act(async () => runtime.sessions[1].options.failed(desktopOccupied(crypto.randomUUID())));
  await act(async () => root.render(<Harness active={false} />));
  expect(session.takeover.pending).toBe(false);
  await act(async () => session.takeover.confirm());
  expect(runtime.sessions).toHaveLength(2);
});

it('restores host privacy preferences once and does not loop after a failed restore', async () => {
  runtime.security = { lockOnDisconnect: true, muteHost: false, privacyScreen: true };
  runtime.privacyFailure = '隐私屏未能切换，请重新连接后重试。';
  const status = vi.fn();
  const options = { client, createPeer, status, stream: vi.fn(), stats: vi.fn() };
  const restore = { failed: false };
  const first = new DesktopDisplaySession(options, restore);
  await first.start({ fps: 'auto', quality: 'auto' });
  expect(runtime.sessions.at(-1)!.privacy).toHaveBeenCalledWith(true);
  expect(status).toHaveBeenCalledWith(runtime.privacyFailure);
  await first.stop();
  const reconnected = new DesktopDisplaySession(options, restore);
  await reconnected.start({ fps: 'auto', quality: 'auto' });
  expect(runtime.sessions.at(-1)!.privacy).not.toHaveBeenCalled();
  await reconnected.stop();
});

it('serializes security updates, retains values through privacy and discards replies from a closed session', async () => {
  const current = runtime.sessions[0];
  let complete!: (value: { lockOnDisconnect: boolean; muteHost: boolean }) => void;
  current.security.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  let updating!: Promise<boolean>;
  await act(async () => { updating = session.security.update({ lockOnDisconnect: true }); });
  expect(session.security.saving).toBe(true);
  await act(async () => session.security.update({ muteHost: true }));
  expect(current.security).toHaveBeenCalledOnce();
  await act(async () => { complete({ lockOnDisconnect: true, muteHost: false }); await updating; });
  expect(session.security.value.lockOnDisconnect).toBe(true);
  await act(async () => current.options.displays({ displayId: 'private', privacyScreen: true }));
  expect(session.security.value.lockOnDisconnect).toBe(true);
  current.security.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await act(async () => { updating = session.security.update({ muteHost: true }); });
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => { complete({ lockOnDisconnect: true, muteHost: true }); await updating; });
  expect(session.security.value).toEqual({ lockOnDisconnect: false, muteHost: false });
});

it('uses host resolutions, prevents overlapping changes and refreshes display dimensions', async () => {
  const current = runtime.sessions[0];
  const size = { width: 1920, height: 1080 };
  await act(async () => current.options.displays({ displayId: 'first', resolutions: [size] }));
  await act(async () => session.resolution.change(size));
  expect(current.resolution).not.toHaveBeenCalled();
  await act(async () => current.options.capabilities({ control: true, resolution: true, privacyScreen: true }));
  expect(session.resolution.options).toEqual([size]);
  let finish!: () => void;
  const original = current.resolution.getMockImplementation()!;
  current.resolution.mockImplementationOnce(async value => {
    await new Promise<void>(resolve => { finish = resolve; }); await original(value);
  });
  let pending!: Promise<void>;
  await act(async () => { pending = session.resolution.change(size); });
  expect(session.saving).toBe(true);
  await act(async () => { await session.resolution.change(size); await session.togglePrivacy(); });
  expect(current.resolution).toHaveBeenCalledOnce(); expect(current.privacy).not.toHaveBeenCalled();
  await act(async () => { finish(); await pending; });
  expect(session.displays[0]).toMatchObject(size); expect(session.saving).toBe(false);
  expect(current.stop).not.toHaveBeenCalled(); expect(session.status).toBe('');
});

it('only toggles privacy with control capability, keeps the session and resets on reconnect', async () => {
  const first = runtime.sessions[0];
  expect(session.privacyScreen).toBe(false);
  await act(async () => session.togglePrivacy());
  expect(first.privacy).not.toHaveBeenCalled();
  await act(async () => first.options.capabilities({ control: false, privacyScreen: true }));
  await act(async () => session.togglePrivacy());
  expect(first.privacy).not.toHaveBeenCalled();
  await act(async () => first.options.capabilities({ control: true, privacyScreen: true }));
  await act(async () => session.togglePrivacy());
  expect(session.privacyScreen).toBe(true); expect(session.settings.displayId).toBe('private');
  expect(first.stop).not.toHaveBeenCalled(); expect(runtime.sessions).toHaveLength(1);
  await act(async () => session.update({ ...session.settings, displayId: 'physical' }));
  expect(first.stop).not.toHaveBeenCalled();
  await act(async () => session.togglePrivacy());
  expect(session.privacyScreen).toBe(false); expect(session.settings.displayId).toBe('first');
  await act(async () => session.togglePrivacy());
  await act(async () => session.retry());
  expect(session.privacyScreen).toBe(false);
  expect(runtime.sessions[1].privacy).not.toHaveBeenCalled();
});

it('leaves privacy off after a rejected toggle and releases the saving state', async () => {
  const first = runtime.sessions[0];
  first.privacy.mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => first.options.capabilities({ control: true, privacyScreen: true }));
  await act(async () => session.togglePrivacy());
  expect(session.privacyScreen).toBe(false); expect(session.saving).toBe(false);
  expect(session.status).toBe('unavailable'); expect(first.stop).not.toHaveBeenCalled();
});

it('keeps the ordinary desktop while setup awaits a local decision and allows retry after installation', async () => {
  const current = runtime.sessions[0];
  const message = '请在电脑上确认安装，完成后再点一次隐私屏。';
  current.privacy.mockRejectedValueOnce(new Error(message));
  await act(async () => current.options.capabilities({ control: true, privacyScreen: true }));
  await act(async () => session.togglePrivacy());
  expect(session.status).toBe(message);
  expect(session.privacyScreen).toBe(false);
  expect(session.saving).toBe(false);
  expect(session.stream).toBeDefined();
  expect(current.stop).not.toHaveBeenCalled();
  await act(async () => session.togglePrivacy());
  expect(session.privacyScreen).toBe(true);
  expect(session.status).toBe('');
  expect(runtime.sessions).toHaveLength(1);
});

it('keeps direct backoff across automatic reconnects and resets it after the viewer closes', async () => {
  vi.useFakeTimers();
  const first = runtime.sessions[0]; first.options.directRetry.failed();
  await act(async () => {
    first.options.failed('Connection lost'); await vi.advanceTimersByTimeAsync(1000);
  });
  expect(runtime.sessions).toHaveLength(2);
  expect(runtime.sessions[1].options.directRetry).toBe(first.options.directRetry);
  expect(runtime.sessions[1].options.directRetry.delay).toBe(15_000);
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => root.render(<Harness />));
  expect(runtime.sessions[2].options.directRetry).not.toBe(first.options.directRetry);
  expect(runtime.sessions[2].options.directRetry.delay).toBe(5000);
});

it('releases dragging and waits for close before reconnecting with the chosen screen', async () => {
  const old = runtime.sessions[0];
  let release!: () => void;
  const closed = new Promise<void>(resolve => { release = resolve; });
  old.stop.mockImplementation(() => closed);
  act(() => session.pointer.button('left', true));
  const next: DesktopSettings = { fps: 90, quality: 'clear', displayId: 'second' };
  let switching!: Promise<void>;
  await act(async () => { switching = session.update(next); });
  expect(old.input).toHaveBeenLastCalledWith({ kind: 'button', button: 'left', down: false });
  expect(session.saving).toBe(true); expect(runtime.sessions).toHaveLength(1);
  await act(async () => session.update({ ...next, displayId: 'third' }));
  expect(old.stop).toHaveBeenCalledOnce();
  await act(async () => { release(); await switching; });
  expect(runtime.sessions).toHaveLength(2);
  expect(runtime.sessions[1].start).toHaveBeenCalledWith(next);
  // The host may fall back to its primary display if the requested screen was removed.
  expect(session.settings.displayId).toBe('first');
});

it('does not reopen a screen when the viewer closes during a pending switch', async () => {
  let release!: () => void;
  runtime.sessions[0].stop.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  let switching!: Promise<void>;
  await act(async () => { switching = session.update({ ...session.settings, displayId: 'second' }); });
  const finishSwitch = release;
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => { finishSwitch(); await switching; release(); });
  expect(runtime.sessions).toHaveLength(1);
});

it('preserves healthy media during a signaling outage and waits for the host after media fails', async () => {
  vi.useFakeTimers();
  const first = runtime.sessions[0];
  await act(async () => root.render(<Harness connected={false} />));
  expect(first.stop).not.toHaveBeenCalled(); expect(session.stream).toBeDefined();
  await act(async () => {
    first.options.stream(undefined); first.options.failed('offline');
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(runtime.sessions).toHaveLength(1);
  expect(session.status).toBe('远程电脑已断开，恢复在线后将自动重连。');
  await act(async () => session.retry());
  expect(runtime.sessions).toHaveLength(1);
  await act(async () => root.render(<Harness />));
  expect(first.stop).toHaveBeenCalledOnce();
  expect(runtime.sessions).toHaveLength(2); expect(session.stream).toBeDefined();
});

it('cancels pending offline recovery when the viewer closes', async () => {
  vi.useFakeTimers();
  await act(async () => root.render(<Harness connected={false} />));
  await act(async () => runtime.sessions[0].options.failed('offline'));
  await act(async () => root.render(<Harness active={false} connected={false} />));
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => { session.retry(); await vi.runAllTimersAsync(); });
  expect(runtime.sessions).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
});

async function enableDisplaySessions() {
  runtime.multiDisplay = true;
  await act(async () => runtime.sessions[0].options.capabilities({
    displaySessions: true, control: true, privacyScreen: true,
  }));
}

it('opens only visited displays, parks the previous one at 1 FPS and reuses it on return', async () => {
  await enableDisplaySessions();
  const first = runtime.sessions[0];
  expect(runtime.sessions).toHaveLength(1);
  act(() => session.pointer.button('left', true));
  await act(async () => session.update({ fps: 90, quality: 'clear', displayId: 'second' }));
  const second = runtime.sessions[1];
  expect(first.input).toHaveBeenLastCalledWith({ kind: 'button', button: 'left', down: false });
  expect(first.settings).toHaveBeenLastCalledWith({ fps: 1, quality: 'auto', displayId: 'first' });
  expect(first.stop).not.toHaveBeenCalled();
  expect(second.start).toHaveBeenCalledWith({
    fps: 90, quality: 'clear', displayId: 'second', retainedSession: first.sessionId,
  });
  expect(first.mute).toHaveBeenLastCalledWith(true);
  expect(second.mute).toHaveBeenLastCalledWith(false);
  await act(async () => session.update({ ...session.settings, displayId: 'first' }));
  expect(runtime.sessions).toHaveLength(2);
  expect(first.start).toHaveBeenCalledOnce();
  expect(first.settings).toHaveBeenLastCalledWith({ fps: 90, quality: 'clear', displayId: 'first' });
  expect(second.settings).toHaveBeenLastCalledWith({ fps: 1, quality: 'clear', displayId: 'second' });
  expect(second.stop).not.toHaveBeenCalled();
  expect(session.settings).toEqual({ fps: 90, quality: 'clear', displayId: 'first' });
  act(() => session.input({ kind: 'key', key: 'desktop' }));
  expect(first.input).toHaveBeenLastCalledWith({ kind: 'key', key: 'desktop' });
  expect(second.input).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness active={false} />));
  expect(first.stop).toHaveBeenCalledOnce(); expect(second.stop).toHaveBeenCalledOnce();
});

it('parks every visited display when leaving during a switch and restores only the selected one', async () => {
  await enableDisplaySessions();
  const first = runtime.sessions[0];
  let finish!: () => void;
  first.settings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const chosen: DesktopSettings = { fps: 48, quality: 'clear', displayId: 'second' };
  await act(async () => { void session.update(chosen); });
  await act(async () => root.render(<Harness background />));
  await act(async () => finish());
  const second = runtime.sessions[1];
  expect(first.settings).toHaveBeenLastCalledWith({ fps: 1, quality: 'auto', displayId: 'first' });
  expect(second.settings).toHaveBeenLastCalledWith({ ...chosen, fps: 1 });
  expect(session.settings).toEqual(chosen);

  let resume!: () => void;
  second.settings.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<Harness background />));
  await act(async () => root.render(<Harness />));
  await act(async () => resume());
  expect(second.settings).toHaveBeenLastCalledWith(chosen);
  expect(first.settings).toHaveBeenCalledOnce();
  expect(runtime.sessions).toHaveLength(2);
  expect(first.stop).not.toHaveBeenCalled();
  expect(second.stop).not.toHaveBeenCalled();
});

it('opens a reconnecting background session at 1 FPS and restores automatic FPS on return', async () => {
  await act(async () => root.render(<Harness background />));
  await act(async () => session.retry());
  const reconnected = runtime.sessions[1];
  expect(reconnected.start).toHaveBeenCalledWith({ fps: 1, quality: 'auto', displayId: 'first' });
  await act(async () => root.render(<Harness />));
  expect(reconnected.settings).toHaveBeenLastCalledWith({ fps: 'auto', quality: 'auto', displayId: 'first' });
});

it('ignores background media callbacks and closes backgrounds before enabling privacy', async () => {
  await enableDisplaySessions();
  const first = runtime.sessions[0];
  await act(async () => session.update({ ...session.settings, displayId: 'second' }));
  const stream = session.stream;
  await act(async () => {
    first.options.stream(undefined);
    first.options.displays({ displayId: 'first' });
    first.options.status('background status');
  });
  expect(session.stream).toBe(stream); expect(session.settings.displayId).toBe('second');
  expect(session.status).not.toBe('background status');
  await act(async () => session.togglePrivacy());
  expect(first.stop).toHaveBeenCalledOnce();
  expect(runtime.sessions[1].privacy).toHaveBeenCalledWith(true);
  expect(runtime.sessions[1].stop).not.toHaveBeenCalled();
});

it('restores the current display after a failed new display and can retry', async () => {
  await enableDisplaySessions();
  const first = runtime.sessions[0];
  // A failed settings RPC must not open a second capture or change the selected screen.
  first.settings.mockRejectedValueOnce(new Error('settings unavailable'));
  await act(async () => session.update({ ...session.settings, displayId: 'second' }));
  expect(runtime.sessions).toHaveLength(1); expect(session.settings.displayId).toBe('first');
  expect(session.saving).toBe(false);
  await act(async () => session.update({ ...session.settings, displayId: 'second' }));
  expect(runtime.sessions).toHaveLength(2); expect(session.settings.displayId).toBe('second');
});

it('restores foreground quality after a rejected capture without dropping the existing connection', async () => {
  await enableDisplaySessions();
  const first = runtime.sessions[0];
  runtime.openFailure = '显示器已断开，请重新连接桌面。';
  await act(async () => session.update({ fps: 90, quality: 'clear', displayId: 'removed' }));
  expect(runtime.sessions).toHaveLength(2); expect(session.settings.displayId).toBe('first');
  expect(first.settings).toHaveBeenLastCalledWith({ fps: 'auto', quality: 'auto', displayId: 'first' });
  expect(first.stop).not.toHaveBeenCalled(); expect(session.saving).toBe(false);
  expect(session.status).toBe(runtime.openFailure);
  runtime.openFailure = '';
  await act(async () => session.update({ ...session.settings, displayId: 'second' }));
  expect(runtime.sessions).toHaveLength(3); expect(session.settings.displayId).toBe('second');
});

it('does not let a failed background interrupt the foreground and opens it again on the next visit', async () => {
  await enableDisplaySessions();
  const first = runtime.sessions[0];
  await act(async () => session.update({ ...session.settings, displayId: 'second' }));
  const stream = session.stream;
  await act(async () => first.options.failed('removed display'));
  expect(first.stop).toHaveBeenCalledOnce();
  expect(session.stream).toBe(stream); expect(session.settings.displayId).toBe('second');
  await act(async () => session.update({ ...session.settings, displayId: 'first' }));
  expect(runtime.sessions).toHaveLength(3);
  expect(runtime.sessions[2].start).toHaveBeenCalledWith(expect.objectContaining({ displayId: 'first' }));
});

it('cancels an in-flight switch without opening unvisited screens after closing', async () => {
  await enableDisplaySessions();
  let release!: () => void;
  runtime.sessions[0].settings.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = session.update({ ...session.settings, displayId: 'second' }); });
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => { release(); await pending; });
  expect(runtime.sessions).toHaveLength(1); expect(session.saving).toBe(false);
});
