import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hotLinkHarness } from './hotLinkHarness';
import { DEFAULT_CHAT_POLICY, parseChatPolicy, setChatPolicy } from '../../../../shared/remote-chat/policy';

let harness: ReturnType<typeof hotLinkHarness>;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { harness?.close(); setChatPolicy(DEFAULT_CHAT_POLICY); vi.clearAllTimers(); vi.useRealTimers(); });

it('keeps relay connected through a four-second round trip while P2P is unavailable', async () => {
  harness = hotLinkHarness({ relayDelay: 2000 });
  harness.paths.direct = false;
  await vi.advanceTimersByTimeAsync(5000);
  expect(harness.links.phone.connectionMode).toBe('relay');
  const request = { kind: 'request' as const, id: 'slow-relay', method: 'connect' as const };
  const sent = harness.links.phone.send(request);
  await vi.advanceTimersByTimeAsync(20_000);
  await sent;
  expect(harness.messages.pc).toEqual([request]);
  expect(harness.reconnect).not.toHaveBeenCalled();
  expect(harness.error).not.toHaveBeenCalled();
  expect(harness.modes.phone).toEqual(['relay']);
});

it('keeps a relay session through a brief pause but reconnects a sustained black hole only once', async () => {
  harness = hotLinkHarness();
  harness.paths.direct = false;
  await vi.advanceTimersByTimeAsync(1500);
  harness.paths.relay = false;
  await vi.advanceTimersByTimeAsync(5000);
  expect(harness.links.phone.connectionMode).toBe('relay');
  expect(harness.reconnect).not.toHaveBeenCalled();
  harness.paths.relay = true;
  await vi.advanceTimersByTimeAsync(1500);
  expect(harness.links.phone.connectionMode).toBe('relay');
  harness.paths.relay = false;
  await vi.advanceTimersByTimeAsync(29_000);
  expect(harness.reconnect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000);
  expect(harness.reconnect).toHaveBeenCalledOnce(); // Only the viewer owns a per-session socket.
  harness.restoreRelay();
  await vi.advanceTimersByTimeAsync(1500);
  expect(harness.links.phone.connectionMode).toBe('relay');
  expect(harness.error).not.toHaveBeenCalled();
});

it('applies a changed relay timeout to existing sessions without overflowing timers', async () => {
  harness = hotLinkHarness();
  harness.paths.direct = false;
  await vi.advanceTimersByTimeAsync(1500);
  harness.paths.relay = false;
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, relayHeartbeatTimeoutSeconds: Number.MAX_SAFE_INTEGER });
  await vi.advanceTimersByTimeAsync(35_000);
  expect(harness.reconnect).not.toHaveBeenCalled();
  expect(harness.links.phone.connectionMode).toBe('relay');
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, relayHeartbeatTimeoutSeconds: 10 });
  await vi.advanceTimersByTimeAsync(250);
  expect(harness.reconnect).toHaveBeenCalledOnce();
  harness.restoreRelay();
  await vi.advanceTimersByTimeAsync(1500);
  expect(harness.links.phone.connectionMode).toBe('relay');
});

it('defaults older relay policies to 30 seconds and rejects invalid timeout settings', () => {
  const legacy: Record<string, unknown> = { ...DEFAULT_CHAT_POLICY };
  delete legacy.relayHeartbeatTimeoutSeconds;
  expect(parseChatPolicy(legacy).relayHeartbeatTimeoutSeconds).toBe(30);
  for (const value of [0, -1, 1.5, NaN, Infinity, '30', null]) {
    expect(() => parseChatPolicy({ ...DEFAULT_CHAT_POLICY, relayHeartbeatTimeoutSeconds: value })).toThrow();
  }
});

it('isolates a silent viewer and recovers while another relay chat keeps sending requests', async () => {
  harness = hotLinkHarness();
  const healthy = hotLinkHarness();
  harness.paths.direct = healthy.paths.direct = false;
  try {
    await vi.advanceTimersByTimeAsync(1500);
    harness.paths.relay = false;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(harness.reconnect.mock.calls).toEqual([['phone']]);
    expect(healthy.reconnect).not.toHaveBeenCalled();
    const request = { kind: 'request' as const, id: 'unaffected', method: 'connect' as const };
    const pending = healthy.links.phone.send(request);
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(healthy.messages.pc).toEqual([request]);
    expect(healthy.modes.pc).toEqual(['relay']);
    harness.paths.relay = true;
    harness.links.phone.enableRelay();
    await vi.advanceTimersByTimeAsync(1500);
    expect(harness.links.pc.connectionMode).toBe('relay');
    expect(harness.links.phone.connectionMode).toBe('relay');
    expect(harness.reconnect.mock.calls).toEqual([['phone']]);
  } finally { healthy.close(); }
});
