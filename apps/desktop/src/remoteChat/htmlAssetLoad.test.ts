// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { HTML_ASSET_TIMEOUT_MS, loadHtmlAsset } from '../../../../shared/file-preview/htmlAssetLoad';
import { prepareHtmlPreview } from '../../../../shared/file-preview/htmlAssets';
import { loadHtmlMedia } from '../../../../shared/file-preview/htmlMedia';
import type { PreviewLoader } from '../../../../shared/file-preview/kinds';

afterEach(() => vi.useRealTimers());

it('shows the document before transferring media and continues past an unresponsive peer', async () => {
  vi.useFakeTimers();
  const load = vi.fn<PreviewLoader>(async path => path.endsWith('stalled.png')
    ? new Promise(() => {}) : new Blob(['image'], { type: 'image/png' }));
  const controller = new AbortController();
  const result = await prepareHtmlPreview({ path: '/index.html', load, signal: controller.signal,
    mediaChannel: 'test', text: '<h1>Report</h1><img src="stalled.png"><img src="ready.png">' });
  expect(result.html).toContain('<h1>Report</h1>');
  const document = new DOMParser().parseFromString(result.html, 'text/html');
  expect(document.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/);
  expect(document.querySelector('img')?.getAttribute('aria-busy')).toBe('true');
  expect(load).not.toHaveBeenCalled();
  const update = vi.fn();
  const pending = loadHtmlMedia({ assets: result.media, signal: controller.signal, update });
  await vi.advanceTimersByTimeAsync(HTML_ASSET_TIMEOUT_MS);
  await pending;
  expect(update).toHaveBeenCalledTimes(2);
  expect(update.mock.calls.some(([, value]) => value.startsWith('data:image/png'))).toBe(true);
  expect(result.hasFailed()).toBe(true);
});

it('settles cancellation promptly even if the remote read ignores its abort signal', async () => {
  const controller = new AbortController();
  const load = vi.fn<PreviewLoader>(() => new Promise(() => {}));
  const pending = loadHtmlAsset({ load, path: '/stalled.png', signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve();
  controller.abort();
  await rejected;
  expect(load.mock.calls[0][1].signal.aborted).toBe(true);
});

it('cancels the transfer on timeout and releases the wait when its peer never settles', async () => {
  vi.useFakeTimers();
  const load = vi.fn<PreviewLoader>(() => new Promise(() => {}));
  const pending = loadHtmlAsset({ load, path: '/stalled.png', signal: new AbortController().signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(HTML_ASSET_TIMEOUT_MS);
  await rejected;
  expect(load.mock.calls[0][1].signal.aborted).toBe(true);
});
