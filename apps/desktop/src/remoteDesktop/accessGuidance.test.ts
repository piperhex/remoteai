import { afterEach, expect, it, vi } from 'vitest';
import { DesktopRecovery } from '../../../../shared/remote-desktop/recovery';
import { desktopFailure } from '../../../../shared/remote-desktop/diagnostics';
import { DesktopReceiver } from '../../../../shared/remote-desktop/receiver';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';
import { createErrorFormatter } from '@remoteai/i18n/errors';
import { resources } from '@remoteai/i18n/client';
import { changeDesktopDisplay } from '../../../../shared/remote-desktop/displayActions';
import type { DesktopDisplaySession } from '../../../../shared/remote-desktop/displaySession';

const locked = 'client.remoteDesktop.lockedRequiresUnattended';
const privacy = 'client.remoteDesktop.privacyRequiresUnattended';
const privacyFailed = 'client.remoteDesktop.privacyFailed';
const guidance = [locked, privacy, privacyFailed, '请先在电脑的远程设置中开启无人值守，再使用隐私屏。',
  '请在电脑上确认安装，完成后再点一次隐私屏。', '请先解锁电脑，再点隐私屏确认安装。',
  '隐私屏未能切换，请重新连接后重试。'];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(guidance)('retains host setup guidance instead of reconnecting or hiding it: %s', message => {
  vi.useFakeTimers();
  const reconnect = vi.fn(), status = vi.fn();
  const recovery = new DesktopRecovery(reconnect, status);
  recovery.failed('network failure');
  recovery.failed(message);
  recovery.setAvailable(false); recovery.setAvailable(true);
  vi.advanceTimersByTime(120_000);
  expect(status).toHaveBeenLastCalledWith(message);
  expect(reconnect).not.toHaveBeenCalled();
  recovery.stop(); expect(vi.getTimerCount()).toBe(0);
});

it.each([locked, privacy])('preserves Tauri string errors before media starts: %s', message => {
  vi.useFakeTimers();
  const status = vi.fn(), failed = vi.fn(), createPeer = vi.fn();
  const receiver = new DesktopReceiver({ client: { diagnostic: vi.fn(),
    open: vi.fn().mockRejectedValue(message), signal: vi.fn(), close: vi.fn(), settings: vi.fn() },
  createPeer, status, failed, stream: vi.fn(), stats: vi.fn() });
  return receiver.start(DEFAULT_SETTINGS).then(async () => {
    expect(createPeer).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith(message);
    expect(failed).toHaveBeenCalledWith(message);
    expect(desktopFailure(message).reason).toBe('permission');
    await receiver.stop(); expect(vi.getTimerCount()).toBe(0);
  });
});

it.each(['zh', 'en', 'ru', 'ja'] as const)('renders actionable reasons offline in %s', language => {
  const format = createErrorFormatter(resources);
  for (const key of [locked, privacy, privacyFailed] as const) {
    const text = format(language, new Error(key));
    expect(text).toBe(resources[language]?.[key]);
    expect(text).not.toContain('client.');
    expect(text).not.toBe('');
  }
});

it('preserves a native privacy refusal and releases the display transaction for another attempt', async () => {
  const current = {} as DesktopDisplaySession;
  const updating = { current: false }, saving = vi.fn(), status = vi.fn();
  await changeDesktopDisplay({ allowed: true, receiver: { current }, updating, saving, status,
    release: vi.fn(), message: 'pending', run: vi.fn().mockRejectedValue(privacy) });
  expect(status).toHaveBeenLastCalledWith(privacy);
  expect(updating.current).toBe(false);
  expect(saving).toHaveBeenLastCalledWith(false);
});

it('uses the declared English fallback when a viewer lacks Japanese access resources', () => {
  const format = createErrorFormatter({ zh: resources.zh, en: resources.en, ja: {} });
  expect(format('ja', locked)).toBe(resources.en[locked]);
});
