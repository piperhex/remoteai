// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteFiles } from './files';
import { ChatOperations } from './operations';
import { invoke } from '../api/backend';
import { createGuiFilesClient, type FilePreviewData } from '../../../../shared/remote-chat/files';
import { PREVIEW_CHUNK_CHARACTERS } from '../../../../shared/remote-chat/filePreviewText';
import { chunks } from '../../../../shared/remote-chat/framing';

vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
beforeEach(() => vi.resetAllMocks());
const target = { path: 'F:/remote/models.json', threadId: 'thread' };
const preview: FilePreviewData = { ...target, sessionId: 'preview', name: 'models.json', kind: 'text',
  text: '', url: 'http://127.0.0.1:1234/preview/models.json' };

it('reassembles large JSON through bounded relay responses without losing Unicode or escapes', async () => {
  const text = '{"content":"' + '中😀\\"'.repeat(2_000_000) + '"}';
  const files = new RemoteFiles();
  vi.mocked(invoke).mockResolvedValueOnce({ ...preview, text, size: new TextEncoder().encode(text).length });
  let reads = 0;
  const request = async <T,>(body: object): Promise<T> => {
    const reply = await files.request(body as Record<string, unknown>, 'viewer');
    // Serialization enforces the actual relay envelope bound, including escaped surrogate pairs.
    expect(() => chunks({ kind: 'response', id: 'test', data: reply }, 'frame', 'relay').next()).not.toThrow();
    if ('operation' in body && body.operation === 'guiFilePreviewText') reads += 1;
    return reply as T;
  };
  const client = createGuiFilesClient(request);
  const result = await client.open(target);
  expect(result?.text).toBe(text);
  expect(reads).toBe(Math.ceil(text.length / PREVIEW_CHUNK_CHARACTERS));
  await client.close('preview');
  await expect(files.request({ operation: 'guiFilePreviewText', id: 'preview', offset: 0, length: 10 }, 'viewer'))
    .rejects.toThrow();
});

it('keeps text chunks scoped to the owning connection and rejects invalid ranges', async () => {
  const files = new RemoteFiles();
  vi.mocked(invoke).mockResolvedValueOnce({ ...preview, text: 'a'.repeat(PREVIEW_CHUNK_CHARACTERS + 1) });
  await files.request({ operation: 'guiFilePreviewOpen', target, chunkedText: true }, 'owner');
  const request = { operation: 'guiFilePreviewText', id: 'preview', offset: 0, length: 10 };
  await expect(files.request(request, 'other')).rejects.toThrow();
  for (const range of [{ offset: -1 }, { length: PREVIEW_CHUNK_CHARACTERS + 1 }, { length: 0 },
    { offset: 0.5 }, { offset: PREVIEW_CHUNK_CHARACTERS }, { length: NaN }]) {
    await expect(files.request({ ...request, ...range }, 'owner')).rejects.toThrow();
  }
  files.release('owner');
  await expect(files.request(request, 'owner')).rejects.toThrow();
});

it('closes the preview if a chunk is missing or corrupt', async () => {
  const request = vi.fn(async (body: object) => {
    if ('operation' in body && body.operation === 'guiFilePreviewOpen') {
      return { ...preview, text: null, textLength: PREVIEW_CHUNK_CHARACTERS + 1 };
    }
    return { offset: 0, text: 'incomplete' };
  });
  const client = createGuiFilesClient(request as Parameters<typeof createGuiFilesClient>[0]);
  await expect(client.open(target)).rejects.toThrow();
  expect(request).toHaveBeenLastCalledWith({ operation: 'guiFilePreviewClose', id: 'preview' });
});

it('still accepts inline replies from older computers', async () => {
  const request = vi.fn(async () => ({ ...preview, text: '{}' }));
  const client = createGuiFilesClient(request as Parameters<typeof createGuiFilesClient>[0]);
  expect((await client.open(target))?.text).toBe('{}');
  expect(request).toHaveBeenCalledTimes(1);
});

it('routes chunk reads through RPC without retaining file data after the preview closes', async () => {
  const operations = new ChatOperations();
  vi.mocked(invoke).mockResolvedValueOnce({ ...preview, text: 'a'.repeat(PREVIEW_CHUNK_CHARACTERS + 1) });
  const execute = (id: string, body: object) => operations.execute({ kind: 'request', id, method: 'request', body });
  const opened = await execute('open', { operation: 'guiFilePreviewOpen', target, chunkedText: true });
  expect(opened.data).toMatchObject({ text: null, textLength: PREVIEW_CHUNK_CHARACTERS + 1 });
  const read = { operation: 'guiFilePreviewText', id: 'preview', offset: 0, length: 10 };
  expect((await execute('read', read)).data).toEqual({ offset: 0, text: 'a'.repeat(10) });
  await execute('close', { operation: 'guiFilePreviewClose', id: 'preview' });
  expect((await execute('read', read)).error).toBeTruthy();
  operations.release();
});
