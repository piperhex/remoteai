import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopRecovery } from '../../../../shared/remote-desktop/recovery';
import type { DesktopPermissionStatus } from '../../../../shared/remote-desktop/protocol';

const screenError = '请在 Mac 的远程设置中开启屏幕录制权限，然后重新连接。';
const inputError = '请在 Mac 的远程设置中开启辅助功能权限，然后重新连接。';
const reconnect = vi.fn();
const status = vi.fn();
const check = vi.fn<() => Promise<DesktopPermissionStatus>>();
let recovery: DesktopRecovery;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  check.mockResolvedValue({ required: 'screenRecording' });
  recovery = new DesktopRecovery(reconnect, status, check);
});
afterEach(() => { recovery.stop(); vi.useRealTimers(); });

it('polls grants without reopening capture or exhausting retries while the user decides', async () => {
  recovery.failed(screenError);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(reconnect).not.toHaveBeenCalled();
  expect(check).toHaveBeenCalledTimes(40);
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('请在 Mac 上允许屏幕录制'));
  check.mockResolvedValue({ required: null });
  await vi.advanceTimersByTimeAsync(3000);
  expect(reconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('requests the next missing permission once and reconnects after both grants', async () => {
  recovery.failed(screenError);
  check.mockResolvedValue({ required: 'accessibility' });
  await vi.advanceTimersByTimeAsync(3000);
  expect(reconnect).toHaveBeenCalledOnce();
  recovery.failed(inputError);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reconnect).toHaveBeenCalledOnce();
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('请在 Mac 上允许辅助功能'));
  check.mockResolvedValue({ required: null });
  await vi.advanceTimersByTimeAsync(3000);
  expect(reconnect).toHaveBeenCalledTimes(2);
});

it('keeps slow checks single-flight and ignores results after the viewer closes', async () => {
  let resolve!: (result: DesktopPermissionStatus) => void;
  check.mockImplementation(() => new Promise(done => { resolve = done; }));
  recovery.failed(screenError);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(check).toHaveBeenCalledOnce();
  recovery.stop(); resolve({ required: null }); await vi.advanceTimersByTimeAsync(30_000);
  expect(reconnect).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('pauses offline and resumes checking without another capture request', async () => {
  recovery.failed(screenError); recovery.setAvailable(false);
  await vi.advanceTimersByTimeAsync(30_000); expect(check).not.toHaveBeenCalled();
  recovery.setAvailable(true);
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('允许屏幕录制'));
  await vi.advanceTimersByTimeAsync(3000);
  expect(check).toHaveBeenCalledOnce(); expect(reconnect).not.toHaveBeenCalled();
});

it.each(['不支持的远程桌面操作。', '桌面连接信息无效，请重新连接。'])(
  'preserves permission guidance for older hosts: %s', async message => {
    check.mockRejectedValue(new Error(message)); recovery.failed(screenError);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(check).toHaveBeenCalledOnce(); expect(reconnect).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith(screenError);
    recovery.setAvailable(false); recovery.setAvailable(true);
    expect(status).toHaveBeenLastCalledWith(screenError);
  });

it('does not retry missing permissions with a legacy client that cannot check grants', async () => {
  recovery.stop(); recovery = new DesktopRecovery(reconnect, status);
  recovery.failed(screenError); recovery.setAvailable(false); recovery.setAvailable(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reconnect).not.toHaveBeenCalled(); expect(status).toHaveBeenLastCalledWith(screenError);
});

it('retries transient read failures but stops if the host disables remote desktop', async () => {
  check.mockRejectedValueOnce(new Error('timeout'));
  recovery.failed(screenError); await vi.advanceTimersByTimeAsync(6000);
  expect(check).toHaveBeenCalledTimes(2); expect(reconnect).not.toHaveBeenCalled();
  const disabled = '这台电脑未允许此远程操作，请在电脑的设置中调整。';
  check.mockRejectedValue(new Error(disabled)); await vi.advanceTimersByTimeAsync(30_000);
  expect(check).toHaveBeenCalledTimes(3); expect(status).toHaveBeenLastCalledWith(disabled);
});

it('cancels a scheduled network retry when the host reports missing permissions', async () => {
  recovery.failed('network'); recovery.failed(screenError);
  await vi.advanceTimersByTimeAsync(5000);
  expect(reconnect).not.toHaveBeenCalled(); expect(check).toHaveBeenCalledOnce();
});

it.each(['未能获取屏幕画面，请确认电脑已登录桌面后重试。', '获取屏幕画面超时，请重新连接。'])(
  'guides a Mac user to repair stale grants when capture retries fail: %s', async message => {
    for (let attempt = 0; attempt < 7; attempt++) {
      recovery.failed(message);
      await vi.advanceTimersByTimeAsync(15000);
    }
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('请在 Mac 的远程设置中修复权限'));
    expect(check).not.toHaveBeenCalled();
    expect(reconnect).toHaveBeenCalledTimes(6);
  });
