import { afterEach, expect, it, vi } from 'vitest';
import { DesktopUpdateConnection, type UpdateSocket } from '../../../../shared/desktop-update/connection';

class Socket implements UpdateSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn();
}
afterEach(() => vi.useRealTimers());

it('update subscriptions grow through failed opens, reset on snapshots, and cancel after stop', async () => {
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  const connection = new DesktopUpdateConnection({ authorize: async () => ({ baseUrl: 'http://fixture',
    accessToken: 'test' }), retryRandom: () => 1,
    createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
  connection.start(); await vi.advanceTimersByTimeAsync(0);
  try {
    for (const delay of [3000, 6000, 12000, 24000, 30000, 30000]) {
      const count = sockets.length;
      sockets.at(-1)!.onopen?.(); sockets.at(-1)!.onerror?.();
      await vi.advanceTimersByTimeAsync(delay - 1); expect(sockets).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1); expect(sockets).toHaveLength(count + 1);
    }
    sockets.at(-1)!.onmessage?.({ data: JSON.stringify({ type: 'devices-snapshot', devices: [] }) });
    sockets.at(-1)!.onclose?.(); await vi.advanceTimersByTimeAsync(3000);
    expect(sockets).toHaveLength(8);
  } finally { connection.stop(); }
  await vi.advanceTimersByTimeAsync(60_000); expect(sockets).toHaveLength(8); expect(vi.getTimerCount()).toBe(0);
});
