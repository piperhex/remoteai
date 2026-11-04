// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_POLICY, base64Bytes, checkDownloadSize, MIB, setChatPolicy }
  from '../../../../shared/remote-chat/policy';
import { compressChatImage } from '../../../../shared/remote-chat/compressImage';
import { sliceHistory } from '../../../../shared/remote-chat/historyPage';
import type { Thread } from '../../../../shared/remote-chat/client/types';
import { ChatOperations } from './operations';
import { guiApi } from '../../../../shared/conversation/api';
import { downloadChatImage } from '../../../../shared/remote-chat/views/downloadImage';

vi.mock('../pages/codexGui/composerBridge', () => ({ guiComposer: {
  validateSend: async () => ({ model: 'model', effort: 'high', access: 'workspace-write' }),
} }));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn(), connect: vi.fn() } }));
afterEach(() => { setChatPolicy(DEFAULT_CHAT_POLICY); vi.resetAllMocks(); });

it('checks the current limit before starting a web download, including previously cached images', () => {
  const original = 'data:image/png;base64,' + 'YWFh'.repeat(Math.ceil(MIB / 3));
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: 1 });
  expect(() => downloadChatImage(original)).toThrow('1 MB');
  expect(document.querySelector('a[download]')).toBeNull();
});

it('applies changed history page sizes without moving the previously loaded boundary', () => {
  const thread = { id: 'chat', turns: [
    { id: 'turn', items: Array.from({ length: 500 }, (_, id) => ({ id: `${id}` })) },
  ] } as Thread;
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, historyPageSize: 150 });
  const first = sliceHistory(thread);
  expect(first.thread.turns?.[0].items).toHaveLength(150);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, historyPageSize: 200 });
  const next = sliceHistory(thread, { start: first.page.start, older: true });
  expect(next.thread.turns?.[0].items).toHaveLength(350);
  expect(next.page.hasMore).toBe(true);
});

it('overrides client-supplied pagination and preview limits and preserves retried request bodies', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, threadPageSize: 1000, filePreviewMaxMb: 1 });
  vi.mocked(guiApi.request).mockResolvedValue({ data: [], nextCursor: null });
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, id: 'page', method: 'request' as const,
    body: { operation: 'list', archived: false, cursor: 'next', limit: 100 } };
  await operations.execute(request);
  await operations.execute(request);
  expect(guiApi.request).toHaveBeenCalledTimes(1);
  expect(guiApi.request).toHaveBeenCalledWith({ ...request.body, limit: 1000 });
  expect(request.body.limit).toBe(100);
  await operations.execute({ ...request, id: 'preview', body: {
    operation: 'textPreview', threadId: 'chat', path: 'text.txt', maxBytes: 99999999,
  } } as Parameters<ChatOperations['execute']>[0]);
  expect(guiApi.request).toHaveBeenLastCalledWith(expect.objectContaining({ maxBytes: MIB }));
});

it('compresses actual bytes to the target and reduces dimensions when quality alone is insufficient', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, imageMaxEdge: 1024, imageTargetKb: 32 });
  const encode = vi.fn(async (edge: number, quality: number) => ({ value: { edge, quality },
    bytes: edge > 512 ? 50_000 : 30_000 }));
  expect(await compressChatImage(encode)).toEqual({ edge: 512, quality: 0.8 });
  expect(encode).toHaveBeenCalledTimes(4);
  await expect(compressChatImage(async () => ({ value: '', bytes: MIB }))).rejects.toThrow('32 KB');
});

it.each([100, Number.MAX_SAFE_INTEGER])('forwards larger text preview limits safely: %s MB', async (limit) => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: limit });
  vi.mocked(guiApi.request).mockResolvedValue({ path: 'text.txt', text: 'content' });
  const result = await new ChatOperations().execute({ kind: 'request', id: 'large-preview', method: 'request',
    body: { operation: 'textPreview', threadId: 'chat', path: 'text.txt', maxBytes: 1 } });
  expect(result.error).toBeUndefined();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({
    maxBytes: Math.min(Number.MAX_SAFE_INTEGER, limit * MIB),
  }));
});

it('allows downloads above the old cap and enforces the configured size', () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: 100 });
  expect(() => checkDownloadSize(21 * MIB)).not.toThrow();
  expect(() => checkDownloadSize(100 * MIB)).not.toThrow();
  expect(() => checkDownloadSize(100 * MIB + 1)).toThrow('100 MB');
});

it('counts base64 padding accurately and applies new download limits at the time of saving', () => {
  expect(base64Bytes('data:image/png;base64,YQ==')).toBe(1);
  expect(base64Bytes('YWI=')).toBe(2);
  checkDownloadSize(2 * MIB);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: 1 });
  expect(() => checkDownloadSize(MIB)).not.toThrow();
  expect(() => checkDownloadSize(MIB + 1)).toThrow('1 MB');
});

it.each(['send', 'steer'])('checks uploads against host settings for direct %s requests', async (operation) => {
  const body = { operation, threadId: 'chat', turnId: 'turn', text: '', images: [], fileUploadMaxMb: 100,
    attachments: [{ kind: 'file', name: 'notes.txt', path: '', data: Buffer.alloc(MIB + 1).toString('base64') }] };
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileUploadMaxMb: 1 });
  const result = await new ChatOperations().execute({ kind: 'request', id: operation, method: 'request', body });
  expect(result.error).toContain('1 MB');
  expect(guiApi.request).not.toHaveBeenCalled();
});

it('compresses large configured targets enough to fit the transport without changing the policy', async () => {
  const policy = { ...DEFAULT_CHAT_POLICY, imageTargetKb: 1000000 };
  const encode = vi.fn(async (_edge: number, quality: number) => ({ value: quality,
    bytes: quality > 0.5 ? 5 * MIB : MIB }));
  expect(await compressChatImage(encode, policy, 2 * MIB)).toBe(0.5);
  expect(policy.imageTargetKb).toBe(1000000);
});
