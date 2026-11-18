import { afterEach, expect, it, vi } from 'vitest';
import { RemoteDocumentTransfers } from './documentTransfers';
import { guiApi } from '../../../../shared/conversation/api';
import { DEFAULT_CHAT_POLICY, MIB, setChatPolicy } from '../../../../shared/remote-chat/policy';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
const id = '12345678-1234-1234-1234-123456789012';
const info = { id, name: 'paper.pdf', size: 3 * MIB, mimeType: 'application/pdf' };
const options = { owner: 'viewer', mode: 'relay' as const };
const open = { operation: 'fileOpen', threadId: 'thread', path: 'paper.pdf', preview: 'pdf', maxBytes: 999999999 };
afterEach(() => { setChatPolicy(DEFAULT_CHAT_POLICY); vi.resetAllMocks(); });

it.each(['page.HTML', 'page.htm', 'page.xhtml'])('streams %s above both relay limits by its host handle', async path => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 1, fileDownloadMaxMb: 1 });
  const html = { ...info, size: 128 * MIB, name: path, mimeType: 'text/html' };
  vi.mocked(guiApi.request).mockResolvedValueOnce(html);
  const transfers = new RemoteDocumentTransfers();
  const request = { ...open, path, preview: 'html' };
  expect(transfers.handles(request)).toBe(true);
  await expect(transfers.request(request, options)).resolves.toEqual(html);
  const read = { operation: 'fileRead', threadId: 'thread', id, offset: html.size - 1, length: 1 };
  await transfers.request(read, options);
  expect(guiApi.request).toHaveBeenLastCalledWith({ ...read, maxBytes: Number.MAX_SAFE_INTEGER });
  await expect(transfers.request(read, { ...options, owner: 'other' })).rejects.toThrow();
  await transfers.request({ operation: 'fileClose', id, threadId: 'thread' }, options);
  expect(transfers.handles(read)).toBe(false);
});

it('closes a resolved non-HTML file before handing out an HTML preview handle', async () => {
  vi.mocked(guiApi.request).mockResolvedValueOnce(info);
  const transfers = new RemoteDocumentTransfers();
  await expect(transfers.request({ ...open, preview: 'html', path: 'alias.html' }, options)).rejects.toThrow();
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: 'fileClose', id, threadId: 'thread' });
});

it('uses Admin preview limits for file and project opens, ignoring forged maxBytes', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 100, fileDownloadMaxMb: 1 });
  vi.mocked(guiApi.request).mockResolvedValue(info);
  const transfers = new RemoteDocumentTransfers();
  await transfers.request(open, options);
  expect(guiApi.request).toHaveBeenLastCalledWith({ ...open, maxBytes: 100 * MIB });
  const project = { operation: 'downloadOpen', transferId: 'project-transfer', scope: 'project', cwd: 'C:/project',
    path: 'paper.PDF', filePreview: 'pdf', maxBytes: 1 };
  await transfers.request(project, options);
  expect(guiApi.request).toHaveBeenLastCalledWith({ ...project, maxBytes: 100 * MIB });
});

it('rechecks live settings on reads while leaving close available after the limit is reduced', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 100 });
  vi.mocked(guiApi.request).mockResolvedValue(info);
  const transfers = new RemoteDocumentTransfers();
  await transfers.request(open, options);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 1 });
  const read = { operation: 'fileRead', threadId: 'thread', id, offset: 0, length: 1 };
  await expect(transfers.request(read, options)).rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
  expect(guiApi.request).toHaveBeenCalledOnce();
  await transfers.request({ operation: 'fileClose', threadId: 'thread', id }, options);
  expect(transfers.handles(read)).toBe(false);
});

it('keeps owner and thread bindings and treats only host-created PDF handles as previews', async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ ...info, size: MIB });
  const transfers = new RemoteDocumentTransfers();
  await transfers.request(open, options);
  const read = { operation: 'fileRead', threadId: 'thread', id, offset: 0, length: 1 };
  await expect(transfers.request(read, { ...options, owner: 'another' })).rejects.toThrow();
  await expect(transfers.request({ ...read, threadId: 'another' }, options)).rejects.toThrow();
  expect(transfers.handles({ ...read, id: 'ordinary-download', preview: 'pdf' })).toBe(false);
  await expect(transfers.request({ ...open, path: 'program.exe' }, options)).rejects.toThrow();
});

it('uses the actual connection mode for direct reads and closes a late open after disconnect', async () => {
  const transfers = new RemoteDocumentTransfers();
  let finish!: (value: typeof info) => void;
  vi.mocked(guiApi.request).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const opening = transfers.request(open, { ...options, mode: 'direct' });
  expect(guiApi.request).toHaveBeenCalledWith({ ...open, maxBytes: Number.MAX_SAFE_INTEGER });
  transfers.release(options.owner);
  finish(info);
  await expect(opening).rejects.toThrow();
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: 'fileClose', id, threadId: 'thread' });
});
