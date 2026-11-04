// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_POLICY, MIB, checkDownloadSize, checkFileUploadSize, getChatPolicy,
  imagePreviewByteLimit, setChatConnectionMode, setChatPolicy, textPreviewByteLimit, videoByteLimit }
  from '../../../../shared/remote-chat/policy';
import { Assembler, chunks } from '../../../../shared/remote-chat/framing';
import { validateChatImages } from '../../../../shared/remote-chat/attachments';
import { ChatOperations } from './operations';
import { guiApi } from '../../../../shared/conversation/api';
import { pickChatImages } from '../../../../shared/remote-chat/views/pickChatImages';
import { ReliableDelivery } from '../../../../shared/remote-chat/delivery';

vi.mock('../pages/codexGui/composerBridge', () => ({ guiComposer: {
  validateSend: async () => ({ model: 'model', effort: 'high', access: 'workspace-write' }),
} }));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn(), connect: vi.fn() } }));
afterEach(() => { setChatConnectionMode('offline'); setChatPolicy(DEFAULT_CHAT_POLICY); vi.resetAllMocks(); });

it('removes transfer caps on P2P and reapplies updated Relay settings on fallback and disconnect', () => {
  setChatConnectionMode('direct');
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileUploadMaxMb: 1, fileDownloadMaxMb: 1 });
  expect(imagePreviewByteLimit()).toBe(Number.MAX_SAFE_INTEGER);
  expect(textPreviewByteLimit()).toBe(Number.MAX_SAFE_INTEGER);
  expect(videoByteLimit()).toBe(Number.MAX_SAFE_INTEGER);
  expect(getChatPolicy().imageMaxEdge).toBe(Number.MAX_SAFE_INTEGER);
  expect(getChatPolicy().historyPageSize).toBe(DEFAULT_CHAT_POLICY.historyPageSize);
  expect(() => checkFileUploadSize(1000 * MIB)).not.toThrow();
  expect(() => checkDownloadSize(1000 * MIB)).not.toThrow();
  for (const mode of ['relay', 'offline'] as const) {
    setChatConnectionMode(mode);
    expect(() => checkFileUploadSize(2 * MIB)).toThrow('1 MB');
    expect(() => checkDownloadSize(2 * MIB)).toThrow('1 MB');
  }
});

it('transfers a large P2P message through fallback while new Relay messages remain bounded', () => {
  const message = { kind: 'response' as const, id: 'large', data: 'x'.repeat(9 * MIB) };
  const frames = chunks(message, 'large', 'direct');
  const assembler = new Assembler();
  expect(assembler.accept(frames.next().value!, 'direct')).toBeNull();
  let result = null;
  for (const frame of frames) result = assembler.accept(frame, 'relay');
  expect(result).toEqual(message);
  expect(() => chunks(message, 'relay', 'relay').next()).toThrow('过大');
});

it('retains the received path when a P2P fragment waits for an earlier Relay fragment', () => {
  const accept = vi.fn();
  const delivery = new ReliableDelivery({ send: () => true, accept });
  delivery.accept({ kind: 'data', sequence: 2, text: 'large direct fragment' }, vi.fn(), 'direct');
  expect(accept).not.toHaveBeenCalled();
  delivery.accept({ kind: 'data', sequence: 1, text: 'earlier relay fragment' }, vi.fn(), 'relay');
  expect(accept).toHaveBeenNthCalledWith(1, 'earlier relay fragment', 'relay');
  expect(accept).toHaveBeenNthCalledWith(2, 'large direct fragment', 'direct');
});

it('isolates concurrent P2P and Relay previews on the same host', async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ path: 'file.txt', text: 'contents' });
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, method: 'request' as const,
    body: { operation: 'textPreview', threadId: 'chat', path: 'file.txt', maxBytes: Number.MAX_SAFE_INTEGER } };
  await Promise.all([operations.execute({ ...request, id: 'direct' }, 'direct'),
    operations.execute({ ...request, id: 'relay' }, 'relay')]);
  expect(guiApi.request).toHaveBeenNthCalledWith(1, { ...request.body, maxBytes: Number.MAX_SAFE_INTEGER });
  expect(guiApi.request).toHaveBeenNthCalledWith(2, { ...request.body, maxBytes: 2 * MIB });
});

it.each(['send', 'steer'])('uses the host connection for %s upload limits and ignores forged provenance', async (operation) => {
  vi.mocked(guiApi.request).mockImplementation(async request => request.operation === 'send'
    ? { turn: { id: 'turn', status: 'inProgress', items: [] } }
    : { thread: { id: 'chat', cwd: '', preview: '', updatedAt: 1, turns: [] } });
  const body = { operation, threadId: 'chat', turnId: 'turn', text: '', images: [], transferMode: 'direct',
    attachments: [{ kind: 'file', name: 'large.txt', path: '', data: Buffer.alloc(4 * MIB).toString('base64') }] };
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, method: 'request' as const, body };
  expect((await operations.execute({ ...request, id: 'relay' }, 'relay')).error).toContain('2 MB');
  expect(guiApi.request).not.toHaveBeenCalled();
  expect((await operations.execute({ ...request, id: 'direct' }, 'direct')).error).toBeUndefined();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ transferMode: 'direct' }));
});

it('keeps original web image bytes on P2P without applying the source, compression or envelope caps', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, imageSourceMaxMb: 1 });
  setChatConnectionMode('direct');
  const file = new File([new Uint8Array(5 * MIB)], 'original.png', { type: 'image/png' });
  const [image] = await pickChatImages([file], 8);
  expect(image.url).toBe(`data:image/png;base64,${Buffer.alloc(5 * MIB).toString('base64')}`);
  expect(() => validateChatImages([image.url])).not.toThrow();
  setChatConnectionMode('relay');
  expect(() => validateChatImages([image.url])).toThrow('较大');
  await expect(pickChatImages([file], 8)).rejects.toThrow('1 MB');
});

it('corrects P2P web file metadata without changing the original PNG payload', async () => {
  setChatConnectionMode('direct');
  const bytes = Uint8Array.from('\x89PNG\r\n\x1a\noriginal-pixels', character => character.charCodeAt(0));
  const [image] = await pickChatImages([new File([bytes], 'photo.jpg', { type: 'image/jpeg' })], 8);
  expect(image.url).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
});
