import { afterEach, expect, it, vi } from 'vitest';
import { hotLinkHarness } from './hotLinkHarness';
import { NativePath, type NativePathEvent } from '../../../../shared/remote-chat/nativePath';
import type { Channel } from '../../../../shared/remote-chat/protocol';

const WRITE_DELAY_MS = 10;
const config = { secret: 'ab'.repeat(32), servers: ['udp://peer.example:11010'],
  stunServers: ['stun.example:3478'], expiresAt: 1_000_000 };
let harness: ReturnType<typeof hotLinkHarness> | undefined;
afterEach(() => { harness?.close(); harness = undefined; vi.useRealTimers(); });

function nativeChannel(channel: Channel) {
  let receive!: (event: NativePathEvent) => void;
  channel.onMessage(text => receive({ type: 'data', text }));
  const path = new NativePath({ sessionId: 'session', desktop: false, config }, {
    open: async (_options, callback) => { receive = callback; return 'native'; },
    send: async (_id, text) => {
      await new Promise(resolve => setTimeout(resolve, WRITE_DELAY_MS));
      channel.send(text);
    },
    close: async () => channel.close(),
  });
  receive({ type: 'open' });
  return path;
}

it('keeps a healthy native path selected while a large reply fills its bounded send queue', async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  harness = hotLinkHarness({ wrapDirectChannel: nativeChannel });
  await vi.advanceTimersByTimeAsync(4_500);
  expect(harness.links.pc.connectionMode).toBe('direct');
  const modesBefore = harness.modes.pc.length;
  const reply = { kind: 'response' as const, id: 'history', data: 'x'.repeat(2_000_000) };
  const delivered = harness.links.pc.send(reply);
  await vi.advanceTimersByTimeAsync(15_000);
  await delivered;
  expect(harness.messages.phone).toEqual([reply]);
  expect(harness.modes.pc.slice(modesBefore)).not.toContain('relay');
  expect(harness.links.pc.connectionMode).toBe('direct');
  expect(harness.error).not.toHaveBeenCalled();
});

it('still falls back and delivers the pending reply when the native writer actually fails', async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  let failed = false;
  harness = hotLinkHarness({ wrapDirectChannel: channel => nativeChannel({ ...channel,
    send: text => { if (failed) throw new Error('Writer disconnected'); channel.send(text); },
  }) });
  await vi.advanceTimersByTimeAsync(4_500);
  expect(harness.links.pc.connectionMode).toBe('direct');
  failed = true;
  const reply = { kind: 'response' as const, id: 'pending', data: 'retain this reply' };
  const delivered = harness.links.pc.send(reply);
  await vi.advanceTimersByTimeAsync(1_500);
  await delivered;
  expect(harness.links.pc.connectionMode).toBe('relay');
  expect(harness.messages.phone).toEqual([reply]);
  expect(harness.error).not.toHaveBeenCalled();
});
