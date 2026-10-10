import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteDesktopHost } from './host';
import { HostSession as DesktopHostSession } from './hostSession';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

vi.mock('./hostSession', () => ({ HostSession: vi.fn(class {
  closed = false;
  open = vi.fn(async () => ({ sdp: 'offer', iceServers: [] }));
  signal = vi.fn(async () => ({ candidates: [] }));
  update = vi.fn();
  privacy = vi.fn(async (enabled: boolean) => ({ privacyScreen: enabled, displayId: 'private' }));
  resolution = vi.fn(async () => ({ displayId: 'selected' }));
  close = vi.fn(() => { this.closed = true; });
}) }));
beforeEach(() => vi.clearAllMocks());
const opening = { action: 'open', id: 'desktop-1', settings: DEFAULT_SETTINGS };

it('validates resolution dimensions and binds changes to the authenticated owner', async () => {
  const host = new RemoteDesktopHost(); host.register('alice', []); host.register('bob', []);
  await host.request(opening, 'alice');
  const change = { action: 'resolution', id: 'desktop-1', resolution: { width: 1920, height: 1080 } };
  await expect(host.request(change, 'bob')).rejects.toThrow('连接已结束');
  for (const resolution of [null, {}, { width: '1920', height: 1080 }, { width: 0, height: 1080 },
    { width: 1920, height: 8193 }, { width: 1920.5, height: 1080 }]) {
    await expect(host.request({ ...change, resolution }, 'alice')).rejects.toThrow('有效的分辨率');
  }
  const session = vi.mocked(DesktopHostSession).mock.results[0].value;
  expect(session.resolution).not.toHaveBeenCalled();
  await expect(host.request(change, 'alice')).resolves.toMatchObject({ displayId: 'selected' });
  expect(session.resolution).toHaveBeenCalledWith(change.resolution); host.release();
});

it('privacy is explicit, owner-bound and requires a boolean switch', async () => {
  const host = new RemoteDesktopHost();
  host.register('alice', []); host.register('bob', []);
  await host.request(opening, 'alice');
  const session = vi.mocked(DesktopHostSession).mock.results[0].value;
  expect(session.privacy).not.toHaveBeenCalled();
  const change = { action: 'privacy', id: 'desktop-1', enabled: true };
  await expect(host.request(change, 'bob')).rejects.toThrow('连接已结束');
  await expect(host.request({ ...change, id: 'wrong' }, 'alice')).rejects.toThrow('连接已结束');
  await expect(host.request({ ...change, enabled: 'true' }, 'alice')).rejects.toThrow('无效');
  expect(session.privacy).not.toHaveBeenCalled();
  await expect(host.request(change, 'alice')).resolves.toMatchObject({ privacyScreen: true });
  expect(session.close).not.toHaveBeenCalled();
  host.release();
});

it('requires a registered chat session and derives ICE servers from its authenticated configuration', async () => {
  const host = new RemoteDesktopHost();
  await expect(host.request(opening, 'unknown')).rejects.toThrow('连接电脑');
  host.register('alice', [{ urls: 'stun:example.test' }]);
  await host.request({ ...opening, owner: 'forged', iceServers: [{ urls: 'stun:forged.test' }] }, 'alice');
  expect(DesktopHostSession).toHaveBeenCalledWith(
    DEFAULT_SETTINGS, [{ urls: 'stun:example.test' }], undefined, undefined);
});
it('isolates controls between sessions and releases media when its owner disconnects', async () => {
  const host = new RemoteDesktopHost();
  host.register('alice', []); host.register('bob', []);
  await host.request(opening, 'alice');
  await expect(host.request({ action: 'settings', id: 'desktop-1', settings: DEFAULT_SETTINGS }, 'bob'))
    .rejects.toThrow('连接已结束');
  await expect(host.request(opening, 'bob')).rejects.toThrow('已有');
  host.release('bob');
  expect(vi.mocked(DesktopHostSession).mock.results[0].value.closed).toBe(false);
  host.release('alice');
  expect(vi.mocked(DesktopHostSession).mock.results[0].value.closed).toBe(true);
});
it('closes an in-flight capture when the chat session expires', async () => {
  const host = new RemoteDesktopHost(); host.register('alice', []);
  const openingTask = host.request(opening, 'alice');
  host.release();
  await expect(openingTask).rejects.toThrow('已结束');
  expect(vi.mocked(DesktopHostSession).mock.results[0].value.closed).toBe(true);
  await expect(host.request({ action: 'signal', id: 'desktop-1', candidates: [] }, 'alice'))
    .rejects.toThrow('连接电脑');
});

it('releases an expired session and its native adapter before replacing it', async () => {
  const host = new RemoteDesktopHost(); host.register('alice', []);
  await host.request(opening, 'alice');
  const expired = vi.mocked(DesktopHostSession).mock.results[0].value;
  expired.closed = true;
  await host.request({ ...opening, id: 'desktop-2' }, 'alice');
  expect(expired.close).toHaveBeenCalledOnce();
  host.release();
});
