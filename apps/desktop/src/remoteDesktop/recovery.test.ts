import { afterEach, expect, it, vi } from 'vitest';
import { DesktopRecovery } from '../../../../shared/remote-desktop/recovery';

afterEach(() => vi.useRealTimers());
it('backs off repeated failures, resets only after a stable connection and stops on close', () => {
  vi.useFakeTimers();
  const reconnect = vi.fn();
  const recovery = new DesktopRecovery(reconnect, vi.fn());
  recovery.failed('offline'); recovery.failed('offline');
  vi.advanceTimersByTime(1000); expect(reconnect).toHaveBeenCalledTimes(1);
  recovery.connected(); vi.advanceTimersByTime(500);
  recovery.failed('offline'); vi.advanceTimersByTime(1000);
  expect(reconnect).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000); expect(reconnect).toHaveBeenCalledTimes(2);
  recovery.connected(); vi.advanceTimersByTime(30_000);
  recovery.failed('offline'); vi.advanceTimersByTime(1000);
  expect(reconnect).toHaveBeenCalledTimes(3);
  recovery.failed('offline'); recovery.stop(); vi.runAllTimers();
  expect(reconnect).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds retries when the host remains unavailable', () => {
  vi.useFakeTimers();
  const reconnect = vi.fn(); const status = vi.fn();
  const recovery = new DesktopRecovery(reconnect, status);
  for (let attempt = 0; attempt < 9; attempt++) {
    recovery.failed('unavailable'); vi.runAllTimers();
  }
  expect(reconnect).toHaveBeenCalledTimes(6);
  expect(status).toHaveBeenLastCalledWith('unavailable');
  recovery.stop();
});

it('waits for an offline host without exhausting retries and reconnects once it returns', () => {
  vi.useFakeTimers();
  const reconnect = vi.fn(); const status = vi.fn();
  const recovery = new DesktopRecovery(reconnect, status);
  recovery.failed('disconnected');
  recovery.setAvailable(false);
  vi.advanceTimersByTime(120_000);
  expect(reconnect).not.toHaveBeenCalled();
  expect(status).toHaveBeenLastCalledWith('远程电脑已断开，恢复在线后将自动重连。');
  recovery.setAvailable(true);
  expect(reconnect).toHaveBeenCalledOnce();
  recovery.setAvailable(true);
  expect(reconnect).toHaveBeenCalledOnce();
  recovery.connected(); recovery.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('leaves a healthy media connection alone when signaling disconnects and respects closing', () => {
  vi.useFakeTimers();
  const reconnect = vi.fn(); const status = vi.fn();
  const recovery = new DesktopRecovery(reconnect, status);
  recovery.connected(); recovery.setAvailable(false); recovery.setAvailable(true);
  expect(reconnect).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled();
  recovery.setAvailable(false); recovery.failed('offline'); recovery.stop(); recovery.setAvailable(true);
  vi.runAllTimers(); expect(reconnect).not.toHaveBeenCalled();
});
