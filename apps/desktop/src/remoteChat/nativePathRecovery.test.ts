import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativePathRecovery } from '../../../../shared/remote-chat/nativePathRecovery';
import { HotPeer } from '../../../../shared/remote-chat/hotPeer';
import type { NativeChannel, NativePathOptions } from '../../../../shared/remote-chat/nativePath';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { vi.useRealTimers(); });

function harness() {
  const options: NativePathOptions = { desktop: true, sessionId: 'session', config: {
    secret: 'secret', servers: [], stunServers: [], expiresAt: 200_000,
  } };
  const channels: NativeChannel[] = [];
  const create = vi.fn((_options: NativePathOptions) => {
    let state = 'connecting';
    const channel: NativeChannel = { get readyState() { return state; }, bufferedAmount: 0,
      renew: vi.fn(), send: vi.fn(), close: vi.fn(() => { state = 'closed'; }),
      onOpen: vi.fn(), onClose: vi.fn(), onMessage: vi.fn() };
    channels.push(channel); return channel;
  });
  return { options, create, channels, attach: vi.fn() };
}

it('restarts a terminated engine with the renewed grant and never duplicates a live attempt', () => {
  const test = harness();
  const recovery = new NativePathRecovery(test.options, test.create, test.attach);
  vi.advanceTimersByTime(30_000); recovery.recover(true);
  expect(test.create).toHaveBeenCalledOnce();
  recovery.renew(300_000); test.channels[0].close(); recovery.recover(true);
  expect(test.create).toHaveBeenCalledTimes(2);
  expect(test.create.mock.calls[1][0].config.expiresAt).toBe(300_000);
  expect(test.options.config.expiresAt).toBe(200_000);
  recovery.recover(true); expect(test.create).toHaveBeenCalledTimes(2);
  recovery.stop(); vi.advanceTimersByTime(20_000); recovery.recover(true);
  expect(test.create).toHaveBeenCalledTimes(2);
});

it('bounds failed retries and stops retrying without signaling or a valid grant', () => {
  const test = harness(); test.create.mockImplementation(() => { throw new Error('offline'); });
  const recovery = new NativePathRecovery(test.options, test.create, test.attach);
  vi.advanceTimersByTime(4999); recovery.recover(true); expect(test.create).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1); recovery.recover(false); expect(test.create).toHaveBeenCalledOnce();
  recovery.recover(true); expect(test.create).toHaveBeenCalledTimes(2);
  vi.setSystemTime(200_000); recovery.recover(true); expect(test.create).toHaveBeenCalledTimes(2);
  recovery.stop();
});

it('does not attach already closed channels and releases channels when attachment fails', () => {
  const test = harness();
  const closed = test.create(test.options); closed.close();
  test.create.mockReturnValueOnce(closed);
  const recovery = new NativePathRecovery(test.options, test.create, test.attach);
  expect(test.attach).not.toHaveBeenCalled();
  test.attach.mockImplementationOnce(() => { throw new Error('attach failed'); });
  vi.advanceTimersByTime(5000); recovery.recover(true);
  expect(test.channels[1].close).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(5000); recovery.recover(true);
  expect(test.attach).toHaveBeenCalledTimes(2);
  recovery.stop();
});

it.each([true, false])('recovers native paths for desktop=%s while retaining the RTC peer', desktop => {
  const test = harness(); const createPeer = vi.fn(() => ({ offer: vi.fn(), accept: vi.fn(), close: vi.fn() }));
  const peer = new HotPeer({ desktop, sessionId: 'session', iceServers: [], nativeTraversal: test.options.config,
    createNativePath: test.create, createPeer, signal: vi.fn(), channel: vi.fn(), disconnected: vi.fn() });
  test.channels[0].close(); vi.advanceTimersByTime(5000); peer.recover(true, true);
  expect(test.create).toHaveBeenCalledTimes(2); expect(createPeer).toHaveBeenCalledOnce();
  peer.close(); vi.advanceTimersByTime(5000); peer.recover(true, true);
  expect(test.create).toHaveBeenCalledTimes(2);
});
