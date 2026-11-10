import { afterEach, expect, it, vi } from 'vitest';
import { checkPreviewSize } from '../../../../shared/file-preview/kinds';
import { readPdfFile } from '../../../../shared/file-preview/readPdfFile';
import { DEFAULT_CHAT_POLICY, MIB, setChatPolicy, setChatConnectionMode }
  from '../../../../shared/remote-chat/policy';
import { downloadFile } from '../../../../shared/remote-chat/fileDownload';
import { projectDownloads } from '../../../../shared/project-browser/downloads';

afterEach(() => { setChatConnectionMode('offline'); setChatPolicy(DEFAULT_CHAT_POLICY); vi.unstubAllGlobals(); });

it('uses the Admin file preview limit for PDFs, including values above the old 64 MB cap', () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 100, fileDownloadMaxMb: 1 });
  expect(() => checkPreviewSize(80 * MIB, 'report.PDF')).not.toThrow();
  expect(() => checkPreviewSize(100 * MIB, 'report.pdf')).not.toThrow();
  expect(() => checkPreviewSize(100 * MIB + 1, 'report.pdf')).toThrow();
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 1 });
  expect(() => checkPreviewSize(MIB + 1, 'report.pdf')).toThrow();
  for (const size of [-1, NaN, Infinity, 1.5]) expect(() => checkPreviewSize(size, 'report.pdf')).toThrow();
});

it('preserves unlimited local/P2P PDF viewing and reapplies the latest limit on relay fallback', () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 1 });
  setChatConnectionMode('direct');
  expect(() => checkPreviewSize(1000 * MIB, 'report.pdf')).not.toThrow();
  setChatConnectionMode('relay');
  expect(() => checkPreviewSize(2 * MIB, 'report.pdf')).toThrow();
  expect(() => checkPreviewSize(1000 * MIB, 'report.pdf', 'direct')).not.toThrow();
});

it('rejects oversized PDF metadata before fetching any bytes', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(readPdfFile({ url: '/paper.pdf', size: 3 * MIB, remote: true,
    signal: new AbortController().signal })).rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
  expect(fetch).not.toHaveBeenCalled();
});

it('counts real response bytes even when Content-Length is absent or understated', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 1 });
  for (const declared of [undefined, '1']) {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(MIB)); controller.enqueue(new Uint8Array(1));
    }, cancel }), { headers: declared ? { 'Content-Length': declared } : {} });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(readPdfFile({ url: '/paper.pdf', remote: true, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
    expect(cancel).toHaveBeenCalledOnce();
  }
});

it('cancels the response before consuming an oversized declared body', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }),
    { headers: { 'Content-Length': String(3 * MIB) } })));
  await expect(readPdfFile({ url: '/paper.pdf', remote: true, signal: new AbortController().signal }))
    .rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
  expect(cancel).toHaveBeenCalledOnce();
});

it('keeps ordinary downloads separate from preview transfers and closes both after rejection', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 100, fileDownloadMaxMb: 1 });
  const info = { id: '12345678-1234-1234-1234-123456789012', name: 'paper.pdf', size: 2 * MIB, mimeType: 'application/pdf' };
  const client = { open: vi.fn(async () => info), read: vi.fn(), close: vi.fn(async () => {}) };
  const target = vi.fn(async () => { throw new Error('target reached'); });
  const options = { client, threadId: 'thread', path: 'paper.pdf', signal: new AbortController().signal,
    target, progress: vi.fn() };
  await expect(downloadFile(options)).rejects.toThrow('1 MB');
  expect(target).not.toHaveBeenCalled();
  await expect(downloadFile({ ...options, preview: 'pdf', checkSize: size => checkPreviewSize(size, 'paper.pdf') }))
    .rejects.toThrow('target reached');
  expect(client.open).toHaveBeenLastCalledWith('thread', 'paper.pdf', { preview: 'pdf' });
  expect(client.close).toHaveBeenCalledTimes(2);
});

it('keeps project PDF range reads on the preview limit instead of the download limit', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 100, fileDownloadMaxMb: 1 });
  const request = vi.fn(async <T,>(_body: unknown) => undefined as T);
  const read = { threadId: 'transfer', id: 'id', offset: 0, length: 1 };
  await projectDownloads(request).read({ ...read, preview: 'pdf' });
  expect(request).toHaveBeenLastCalledWith({ operation: 'fileRead', ...read, preview: 'pdf', maxBytes: 100 * MIB });
  await projectDownloads(request).read(read);
  expect(request).toHaveBeenLastCalledWith({ operation: 'fileRead', ...read, maxBytes: MIB });
  await projectDownloads(request, 'direct').read({ ...read, preview: 'pdf' });
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ maxBytes: Number.MAX_SAFE_INTEGER }));
});
