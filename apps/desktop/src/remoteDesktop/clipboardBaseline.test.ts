// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readBrowserClipboardBaseline } from '../../../../shared/remote-desktop/views/clipboardContent';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['prompt', 'denied'])('does not read or prompt for clipboard access when permission is %s', async state => {
  const readText = vi.fn();
  vi.stubGlobal('navigator', { permissions: { query: vi.fn().mockResolvedValue({ state }) },
    clipboard: { readText } });
  await expect(readBrowserClipboardBaseline()).resolves.toBeUndefined();
  expect(readText).not.toHaveBeenCalled();
});

it('records a baseline only with an existing grant and tolerates unsupported permissions', async () => {
  vi.stubGlobal('navigator', { permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    clipboard: { readText: vi.fn().mockResolvedValue('old local') } });
  await expect(readBrowserClipboardBaseline()).resolves.toEqual({ format: 'text', text: 'old local' });
  vi.stubGlobal('navigator', {});
  await expect(readBrowserClipboardBaseline()).resolves.toBeUndefined();
});

it('bounds waiting for the permission query without reading the clipboard', async () => {
  vi.useFakeTimers();
  const readText = vi.fn();
  vi.stubGlobal('navigator', { permissions: { query: vi.fn(() => new Promise(() => {})) },
    clipboard: { readText } });
  const baseline = readBrowserClipboardBaseline();
  await vi.advanceTimersByTimeAsync(250);
  await expect(baseline).resolves.toBeUndefined();
  expect(readText).not.toHaveBeenCalled();
});
