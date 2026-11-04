import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteImages } from './images';
import { guiApi } from '../../../../shared/conversation/api';
import { ImageCache } from '../../../../shared/remote-chat/client/imageCache';
import { contentHash } from '../../../../shared/remote-chat/historySync';
import { DEFAULT_CHAT_POLICY, MIB, setChatPolicy } from '../../../../shared/remote-chat/policy';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
beforeEach(() => { vi.resetAllMocks(); setChatPolicy(DEFAULT_CHAT_POLICY); });

it('keeps nested MCP image bytes on the host until the remote client requests their reference', async () => {
  const images = new RemoteImages();
  const data = 'abcd'.repeat(100_000);
  const block = { type: 'image', mimeType: 'image/png', data };
  const original = { type: 'mcpToolCall', result: { content: [block], structuredContent: { screenshot: block } } };
  const prepared = images.prepare(original, 'tool-thread');
  const reference = (prepared.result.content[0] as unknown as { imageUrl: string }).imageUrl;
  expect(reference).toMatch(/^chat-image:\/\//);
  expect(JSON.stringify(prepared).length).toBeLessThan(400);
  expect(prepared.result.content[0]).toEqual({ type: 'inputImage', imageUrl: reference });
  expect(prepared.result.structuredContent.screenshot).toEqual(prepared.result.content[0]);
  expect(original.result.content[0]).toBe(block);
  expect(block.data).toBe(data);
  expect(guiApi.request).not.toHaveBeenCalled();
  vi.mocked(guiApi.request).mockResolvedValue({ url: 'data:image/png;base64,aW1hZ2U=' });
  await images.request({ operation: 'imagePreview', threadId: 'tool-thread', source: reference });
  expect(guiApi.request).toHaveBeenCalledExactlyOnceWith({ operation: 'imagePreview', threadId: 'tool-thread',
    source: `data:image/png;base64,${data}`, variant: 'thumbnail', maxBytes: expect.any(Number) });
});

it('recovers an earlier tool image even when the full history exceeds the host image cache', async () => {
  const images = new RemoteImages();
  const first = { type: 'image', mimeType: 'image/png', data: 'abcd'.repeat(9 * MIB) };
  const last = { ...first, data: 'efgh'.repeat(9 * MIB) };
  const reference = (images.prepare(first, 'large-history') as unknown as { imageUrl: string }).imageUrl;
  images.prepare(last, 'large-history');
  vi.mocked(guiApi.request).mockImplementation(async request => request.operation === 'read'
    ? { thread: { id: 'large-history', turns: [{ items: [{ result: { content: [first, last] } }] }] } }
    : { url: 'data:image/png;base64,aW1hZ2U=' });
  await images.request({ operation: 'imagePreview', threadId: 'large-history', source: reference });
  expect(guiApi.request).toHaveBeenCalledWith({ operation: 'read', threadId: 'large-history' });
  const preview = vi.mocked(guiApi.request).mock.calls.at(-1)?.[0];
  expect(preview).toMatchObject({ operation: 'imagePreview', source: `data:image/png;base64,${first.data}` });
}, 20_000);

it('replaces inline and generated originals with stable references scoped to the task', async () => {
  const images = new RemoteImages();
  const original = 'data:image/png;base64,' + 'abcd'.repeat(400_000);
  const prepared = images.prepare({ type: 'imageGeneration', result: original.slice(original.indexOf(',') + 1) }, 'task');
  expect(JSON.stringify(prepared).length).toBeLessThan(200);
  expect(images.prepare({ imageUrl: original }, 'task').imageUrl).toBe(prepared.result);
  vi.mocked(guiApi.request).mockResolvedValue({ url: 'data:image/jpeg;base64,YQ==' });
  await images.request({ operation: 'imagePreview', threadId: 'task', source: prepared.result });
  expect(guiApi.request).toHaveBeenCalledWith({ operation: 'imagePreview', threadId: 'task',
    source: original, variant: 'thumbnail', maxBytes: 20 * 1024 * 1024 });
  vi.mocked(guiApi.request).mockResolvedValue({ thread: { id: 'other', turns: [] } });
  await expect(images.request({ operation: 'imagePreview', threadId: 'other', source: prepared.result })).rejects.toThrow();
});

it('fetches an original only on demand in bounded chunks, then reuses the cached image', async () => {
  const images = new RemoteImages();
  const original = 'data:image/png;base64,' + 'abcd'.repeat(700_000);
  const thumbnail = 'data:image/jpeg;base64,YQ==';
  vi.mocked(guiApi.request).mockImplementation(async (request) => ({
    url: request.operation === 'imagePreview' && request.variant === 'thumbnail' ? thumbnail : original,
  }));
  const requests: Record<string, unknown>[] = [];
  const cache = new ImageCache(async <T>(body: Record<string, unknown>) => {
    const result = await images.request(body);
    requests.push({ ...body, bytes: JSON.stringify(result).length });
    return result as T;
  });
  expect(await cache.load('task', 'image.png')).toBe(thumbnail);
  expect(requests).toHaveLength(1);
  expect(await cache.load('task', 'image.png', true)).toBe(original);
  const completed = requests.length;
  expect(completed).toBeGreaterThan(10);
  expect(requests.every((request) => Number(request.bytes) < 270_000)).toBe(true);
  expect(await cache.load('task', 'image.png', true)).toBe(original);
  expect(requests).toHaveLength(completed);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
});

it('rejects original chunks from a changed source', async () => {
  let request = 0;
  const cache = new ImageCache(async <T>() => (++request === 1
    ? { data: 'prefix', total: 100, hash: contentHash('first') }
    : { data: 'changed', total: 100, hash: contentHash('second') }) as T);
  await expect(cache.load('task', 'image.png', true)).rejects.toThrow('原图加载中断');
});

it('keeps the UI event loop available while verifying an original and still rejects corrupt bytes', async () => {
  const original = 'data:image/png;base64,' + 'abcd'.repeat(2 * MIB);
  const hash = contentHash(original);
  let corrupt = false;
  const cache = new ImageCache(async <T>(body: { offset?: number }) => {
    const offset = body.offset ?? 0;
    const data = original.slice(offset, offset + 256 * 1024);
    return { data: corrupt ? 'x' + data.slice(1) : data, total: original.length, hash } as T;
  });
  let beats = 0;
  const timer = setInterval(() => { beats++; }, 0);
  try {
    const first = cache.load('task', 'original.png', true);
    expect(cache.load('task', 'original.png', true)).toBe(first);
    expect(await first).toBe(original);
    expect(beats).toBeGreaterThan(0);
    corrupt = true;
    await expect(cache.load('task', 'corrupt.png', true)).rejects.toThrow('原图加载中断');
  } finally { clearInterval(timer); }
});

it('allows originals above the former cap and retains the active original across chunk requests', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, imagePreviewMaxMb: 64 });
  const original = 'data:image/png;base64,' + 'abcd'.repeat(17 * MIB);
  const images = new RemoteImages();
  vi.mocked(guiApi.request).mockResolvedValue({ url: original });
  const body = { operation: 'imageChunk', threadId: 'task', source: 'large.png' };
  const first = await images.request(body);
  expect(first).toMatchObject({ total: original.length });
  await images.request({ ...body, offset: 256 * 1024 });
  expect(guiApi.request).toHaveBeenCalledTimes(1);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, imagePreviewMaxMb: 20 });
  await expect(images.request(body)).rejects.toThrow();
});

it('loads an original above 20 MB using the configured limit and rejects it after the limit decreases', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, imagePreviewMaxMb: 32 });
  const original = 'data:image/png;base64,' + 'abcd'.repeat(8 * MIB);
  const hash = contentHash(original);
  const cache = new ImageCache(async <T>(body: { offset?: number }) => {
    const offset = body.offset ?? 0;
    return { data: original.slice(offset, offset + 256 * 1024), total: original.length, hash } as T;
  });
  expect(await cache.load('task', 'large.png', true)).toBe(original);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, imagePreviewMaxMb: 20 });
  await expect(cache.load('task', 'large.png', true)).rejects.toThrow('原图加载中断');
});
