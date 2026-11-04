import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { localDesktopClipboard } from '../../../../shared/remote-desktop/local/localClipboard';
import { ClipboardReadUnavailableError } from '../../../../shared/remote-desktop/clipboard';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const accessError = '无法访问剪贴板，请重新复制后再试。';
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

it('retries a temporary local clipboard lock without repeating the remote gesture', async () => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockRejectedValueOnce(accessError).mockResolvedValueOnce(undefined);
  const content = { format: 'text' as const, text: 'remote' };
  const writing = localDesktopClipboard.write(content);
  await vi.runAllTimersAsync(); await writing;
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenLastCalledWith('remote_desktop_write_local_clipboard', { content });
});

it('bounds clipboard access retries and preserves the error', async () => {
  vi.useFakeTimers(); vi.mocked(invoke).mockRejectedValue(accessError);
  const reading = expect(localDesktopClipboard.read()).rejects.toBeInstanceOf(ClipboardReadUnavailableError);
  await vi.runAllTimersAsync(); await reading;
  expect(invoke).toHaveBeenCalledTimes(3);
});

it('does not retry unsupported or invalid clipboard content', async () => {
  const error = '暂不支持复制文件夹，请先压缩后再复制。';
  vi.mocked(invoke).mockRejectedValue(error);
  await expect(localDesktopClipboard.read()).rejects.toBe(error);
  expect(invoke).toHaveBeenCalledTimes(1);
});
