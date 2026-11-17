import { afterEach, expect, it, vi } from 'vitest';
import { SessionCipher } from '../../../../shared/remote-chat/cipher';
import type { SessionCipherFactory } from '../../../../shared/remote-chat/nativeSessionCipher';
import { hotLinkHarness } from './hotLinkHarness';

const asynchronous: SessionCipherFactory = options => {
  // This test adapter exercises asynchronous protocol scheduling; fixed Web/Rust vectors test the real codec.
  const cipher = new SessionCipher(options);
  return { native: true, handle: Promise.resolve('test-native-session'),
    encrypt: async text => cipher.encrypt(text), decrypt: async payload => cipher.decrypt(payload),
    createBulkCipher: async context => cipher.createBulkCipher(context), destroy: () => cipher.destroy() };
};
let harness: ReturnType<typeof hotLinkHarness> | undefined;
afterEach(() => { harness?.close(); vi.useRealTimers(); });

it('interoperates with an existing synchronous client and recovers lost asynchronous data', async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  harness = hotLinkHarness({ nativeCipher: { pc: asynchronous } });
  await vi.advanceTimersByTimeAsync(4500);
  expect(harness.modes.pc.at(-1)).toBe('direct');
  const message = { kind: 'response' as const, id: 'history', data: 'native history '.repeat(40_000) };
  harness.filter(packet => !(packet.side === 'pc' && packet.frame.kind === 'data' && packet.frame.sequence === 1));
  const sent = harness.links.pc.send(message);
  await vi.advanceTimersByTimeAsync(100);
  expect(harness.messages.phone).toEqual([]);
  harness.filter(() => true);
  await vi.advanceTimersByTimeAsync(3500); await sent;
  expect(harness.messages.phone).toEqual([message]);
  expect(harness.error).not.toHaveBeenCalled();
});

it('keeps native acknowledgements and heartbeats live across relay recovery', async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  harness = hotLinkHarness({ nativeCipher: { pc: asynchronous, phone: asynchronous } });
  harness.paths.direct = false;
  await vi.advanceTimersByTimeAsync(4500);
  const message = { kind: 'event' as const, event: { text: 'sync history' } };
  const sent = harness.links.pc.send(message);
  await vi.advanceTimersByTimeAsync(100); await sent;
  expect(harness.messages.phone).toEqual([message]);
  harness.paths.direct = true;
  await vi.advanceTimersByTimeAsync(5000);
  expect(harness.modes.pc.at(-1)).toBe('direct');
  expect(harness.error).not.toHaveBeenCalled();
});
