import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeviceStatusConnection } from '../../../../shared/realtime/deviceStatusConnection';

class Socket {
  static instances: Socket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn();
  constructor() { Socket.instances.push(this); }
  snapshot() { this.onmessage?.({ data: 'snapshot' }); }
  fail(code = 1006) { this.onclose?.({ code }); }
}
const connections: DeviceStatusConnection[] = [];
function start(options: { random?: () => number; recover?: () => Promise<void> } = {}) {
  const connection = new DeviceStatusConnection({ url: 'ws://fixture/device-switch', subscribe: () => 'subscribe',
    message: data => data === 'snapshot', retry: { random: options.random ?? (() => 1) },
    recoverAuthentication: options.recover });
  connections.push(connection); connection.start(); return connection;
}
beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => {
  connections.splice(0).forEach(connection => connection.stop());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('does not reset on open or failed authentication, and resets only on snapshot', async () => {
  start();
  for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
    const count = Socket.instances.length;
    Socket.instances.at(-1)!.onopen?.(); Socket.instances.at(-1)!.fail(4001);
    await vi.advanceTimersByTimeAsync(delay - 1); expect(Socket.instances).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(1); expect(Socket.instances).toHaveLength(count + 1);
  }
  Socket.instances.at(-1)!.snapshot(); Socket.instances.at(-1)!.fail();
  await vi.advanceTimersByTimeAsync(1000); expect(Socket.instances).toHaveLength(8);
});

it('staggered clients schedule one dial even when error and close arrive together', async () => {
  start({ random: () => 0 }); start({ random: () => 1 });
  for (const socket of [...Socket.instances]) { socket.onerror?.(); socket.fail(); }
  await vi.advanceTimersByTimeAsync(499); expect(Socket.instances).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1); expect(Socket.instances).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(500); expect(Socket.instances).toHaveLength(4);
});

it('manual/network recovery bypasses one wait without clearing failure history or overlapping dials', async () => {
  const connection = start(); Socket.instances[0].fail();
  connection.retryNow(); connection.retryNow(); expect(Socket.instances).toHaveLength(2);
  Socket.instances[1].fail();
  await vi.advanceTimersByTimeAsync(1999); expect(Socket.instances).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1); expect(Socket.instances).toHaveLength(3);
});

it('foreground resume cancels the old timer; background/logout ignore stale events', async () => {
  const connection = start(); const oldClose = Socket.instances[0].onclose!;
  Socket.instances[0].fail(); connection.setForeground(false);
  await vi.advanceTimersByTimeAsync(60_000); expect(Socket.instances).toHaveLength(1);
  connection.setForeground(true); expect(Socket.instances).toHaveLength(2);
  oldClose({ code: 1006 });
  connection.stop(); await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(2); expect(vi.getTimerCount()).toBe(0);
});

it('preserves native auth recovery, but HTTP success cannot reset WebSocket failures', async () => {
  const recover = vi.fn(async () => undefined); const connection = start({ recover });
  for (const delay of [1000, 2000]) {
    const count = Socket.instances.length;
    Socket.instances.at(-1)!.fail(4001); connection.retryNow();
    await vi.advanceTimersByTimeAsync(delay - 1); expect(Socket.instances).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(1); expect(Socket.instances).toHaveLength(count + 1);
  }
  expect(recover).toHaveBeenCalledTimes(2);
});

it('cancels pending authentication recovery on logout and times out an unacknowledged subscription', async () => {
  let finish!: () => void;
  const connection = start({ recover: () => new Promise<void>(resolve => { finish = resolve; }) });
  Socket.instances[0].fail(4001); connection.stop(); finish();
  await vi.advanceTimersByTimeAsync(60_000); expect(Socket.instances).toHaveLength(1);
  start(); await vi.advanceTimersByTimeAsync(15_000); expect(Socket.instances[1].close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000); expect(Socket.instances).toHaveLength(3);
});

it('backs off constructor failures and platforms that emit only error', async () => {
  const createSocket = vi.fn(() => { throw new Error('offline'); });
  const connection = new DeviceStatusConnection({ url: 'ws://fixture', subscribe: () => '',
    message: () => false, createSocket, retry: { random: () => 1 } });
  connections.push(connection); connection.start();
  await vi.advanceTimersByTimeAsync(2999); expect(createSocket).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(createSocket).toHaveBeenCalledTimes(3);
  connection.stop(); start(); Socket.instances[0].onerror?.();
  await vi.advanceTimersByTimeAsync(1250); expect(Socket.instances).toHaveLength(2);
});
