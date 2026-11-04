// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { browserDownloadTarget, prepareBrowserDownload } from '../../../../shared/remote-chat/views/fileDownloadTarget';
import type { FileInfo } from '../../../../shared/remote-chat/fileDownload';
const info: FileInfo = { id: 'id', name: 'app.apk', size: 2, mimeType: 'application/vnd.android.package-archive' };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('opens the save picker from the user gesture and writes binary data without a Blob buffer', async () => {
  const writable = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
  const picker = vi.fn(async () => ({ createWritable: async () => writable }));
  vi.stubGlobal('showSaveFilePicker', picker);
  const prepare = prepareBrowserDownload('F:/project/app.apk');
  expect(picker).toHaveBeenCalledWith({ suggestedName: 'app.apk' });
  const target = await (await prepare)(info);
  await target.write('AP8='); await target.finish(); await target.dispose();
  expect(writable.write).toHaveBeenCalledWith(new Uint8Array([0, 255]));
  expect(writable.close).toHaveBeenCalledOnce();
  expect(writable.abort).not.toHaveBeenCalled();
});

it('aborts an unfinished direct save instead of publishing partial bytes', async () => {
  const writable = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
  vi.stubGlobal('showSaveFilePicker', async () => ({ createWritable: async () => writable }));
  const target = await (await prepareBrowserDownload('app.apk'))(info);
  await target.write('AP8='); await target.dispose();
  expect(writable.abort).toHaveBeenCalledOnce();
  expect(writable.close).not.toHaveBeenCalled();
});

it('removes browser temporary files when opening the disk writer fails', async () => {
  const removeEntry = vi.fn(async () => undefined);
  const directory = { removeEntry, getFileHandle: async () => ({
    createWritable: async () => { throw new Error('quota'); },
  }) };
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => directory } });
  await expect(browserDownloadTarget(info)).rejects.toThrow('quota');
  expect(removeEntry).toHaveBeenCalledOnce();
});

it('removes a cancelled browser temporary file immediately', async () => {
  const writable = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
  const removeEntry = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ removeEntry,
    getFileHandle: async () => ({ createWritable: async () => writable }),
  }) } });
  const target = await browserDownloadTarget(info);
  await target.dispose();
  expect(writable.abort).toHaveBeenCalledOnce();
  expect(removeEntry).toHaveBeenCalledOnce();
});
