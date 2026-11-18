import { expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { FILE_CHUNK_BYTES } from '../../../../shared/remote-chat/fileDownload';
import { chatHandshake } from '../../../../shared/remote-chat/handshake';
import { canCacheHtmlPreview } from '../../../../shared/remote-chat/htmlDocument';
import { MIB } from '../../../../shared/remote-chat/policy';

it('reads a relative HTML link in bounded chunks across a UTF-8 character on a relay connection', async () => {
  const text = 'x'.repeat(FILE_CHUNK_BYTES - 1) + '课程' + 'y'.repeat(2 * MIB) + '</html>';
  const bytes = Buffer.from(text);
  const path = 'C:/project/course/index.html';
  const id = '12345678-1234-1234-1234-123456789012';
  const request = vi.fn(async (method: string, input: unknown) => {
    const body = input as { operation?: string; offset: number; length: number };
    if (method === 'connect') return { ...chatHandshake, directorySyncV1: false, approvals: [], htmlFileStreamsV1: true };
    switch (body?.operation) {
      case 'guiFileAction': return { path, metadata: { size: bytes.length } };
      case 'fileOpen': return { id, name: 'index.html', mimeType: 'text/html', size: bytes.length };
      case 'fileRead': return { offset: body.offset,
        data: bytes.subarray(body.offset, body.offset + body.length).toString('base64') };
      case 'textPreview': throw new Error('Large HTML must use chunked reads');
      default: return { data: [], nextCursor: null };
    }
  });
  const controller = new ChatController(events => ({
    request: <T>(method: string, body?: unknown) => request(method, body) as Promise<T>,
    start: () => { events.mode('relay'); events.ready(); }, stop: () => events.mode('offline'),
  }));
  try {
    controller.start();
    await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
    const result = await controller.textPreview('thread', 'course/index.html');
    expect(result.path).toBe(path);
    expect(result.size).toBe(bytes.length);
    expect(result.text === text).toBe(true);
    expect(request).toHaveBeenCalledWith('request', { operation: 'fileOpen', threadId: 'thread', path, preview: 'html' });
    expect(request).toHaveBeenCalledWith('request', { operation: 'fileClose', threadId: 'thread', id });
  } finally { controller.stop(); }
});

it('keeps small HTML eligible for the offline text cache', () => {
  expect(canCacheHtmlPreview(MIB, 'relay')).toBe(true);
  expect(canCacheHtmlPreview(65 * MIB, 'direct')).toBe(false);
});
