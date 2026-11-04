import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadSpeed } from '../../../../shared/downloads/downloadSpeed';
import { monitorDownloadSpeed } from '../../../../shared/downloads/monitorDownloadSpeed';
import type { DownloadTask } from '../../../../shared/downloads/types';

afterEach(() => vi.useRealTimers());

describe('two-second download speed', () => {
  it('uses elapsed time at startup and excludes a resumed offset', () => {
    const speed = new DownloadSpeed(10_000, 100);
    expect(speed.sample(10_000, 100)).toBe(0);
    expect(speed.sample(11_000, 1_100)).toBe(1_000);
    expect(speed.sample(13_000, 1_600)).toBe(2_000);
  });

  it('drops old bursts instead of averaging the entire transfer or the latest interval', () => {
    const speed = new DownloadSpeed(0, 0);
    expect(speed.sample(10_000, 500)).toBe(20_000);
    expect(speed.sample(11_000, 2_000)).toBe(5_500);
    expect(speed.sample(12_000, 2_500)).toBe(1_000);
    expect(speed.sample(13_000, 3_000)).toBe(1_500);
  });

  it('expires stalled traffic at the window boundary and handles same-time chunks', () => {
    const speed = new DownloadSpeed(0, 0);
    speed.sample(1_000, 1_000);
    expect(speed.sample(2_000, 1_000)).toBe(2_000);
    expect(speed.sample(2_000, 2_999)).toBe(1_000);
    expect(speed.sample(2_000, 3_000)).toBe(0);
    expect(speed.sample(2_500, 4_000)).toBe(250);
  });
});

const task: DownloadTask = {
  id: 'download', name: 'file.bin', source: { owner: 'owner', deviceId: 'pc', deviceName: 'PC',
    path: 'C:/file.bin', scope: 'computer' },
  status: 'downloading', received: 10_000, size: 100_000, createdAt: 0, message: '',
};

describe('download speed lifecycle', () => {
  it('refreshes stalled downloads and stops timers when the transfer leaves downloading', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] });
    const update = vi.fn();
    const monitor = monitorDownloadSpeed(update);
    monitor.update(task);
    vi.advanceTimersByTime(1_000);
    monitor.update({ ...task, received: 12_000 });
    expect(update.mock.lastCall?.[0].bytesPerSecond).toBe(2_000);
    vi.advanceTimersByTime(1_000);
    expect(update.mock.lastCall?.[0].bytesPerSecond).toBe(1_000);
    vi.advanceTimersByTime(1_000);
    expect(update.mock.lastCall?.[0].bytesPerSecond).toBe(0);
    monitor.update({ ...task, received: 12_000, status: 'verifying' });
    expect(update.mock.lastCall?.[0].bytesPerSecond).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    monitor.stop();
  });

  it('starts a fresh window after pause, retry or a source restart', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] });
    const update = vi.fn();
    const monitor = monitorDownloadSpeed(update);
    monitor.update(task);
    vi.advanceTimersByTime(1_000);
    monitor.update({ ...task, received: 12_000 });
    monitor.update({ ...task, received: 12_000, status: 'paused' });
    vi.advanceTimersByTime(30_000);
    monitor.update({ ...task, received: 12_000 });
    vi.advanceTimersByTime(1_000);
    monitor.update({ ...task, received: 13_000 });
    expect(update.mock.lastCall?.[0].bytesPerSecond).toBe(1_000);
    monitor.update({ ...task, received: 0 });
    expect(update.mock.lastCall?.[0].bytesPerSecond).toBe(0);
    vi.advanceTimersByTime(1_000);
    monitor.update({ ...task, received: 500 });
    expect(update.mock.lastCall?.[0].bytesPerSecond).toBe(500);
    monitor.stop();
    expect(vi.getTimerCount()).toBe(0);
    const calls = update.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(update).toHaveBeenCalledTimes(calls);
  });
});
