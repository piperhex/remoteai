import { expect, it, vi } from 'vitest';
import { nativeHtmlAsset } from './nativeHtmlAsset';

const id = '11111111-1111-4111-8111-111111111111';
it('reads original image bytes and preserves MIME fallback through the authenticated reader', async () => {
  const client = { open: vi.fn(async () => ({ id, size: 3, name: 'image.svg', mimeType: 'application/octet-stream' })),
    read: vi.fn(async () => ({ offset: 0, data: 'YWJj' })), close: vi.fn(async () => {}) };
  const asset = await nativeHtmlAsset({ client, threadId: 'thread', path: 'F:/report/image.svg',
    signal: new AbortController().signal });
  expect(asset).toEqual({ base64: 'YWJj', mime: 'image/svg+xml' });
  expect(client.open).toHaveBeenCalledWith('thread', 'F:/report/image.svg');
  expect(client.close).toHaveBeenCalledWith('thread', id);
});
it('closes asset sessions on failure or cancellation', async () => {
  const controller = new AbortController();
  const client = { open: async () => ({ id, size: 3, name: 'a.png', mimeType: 'image/png' }),
    read: async () => { controller.abort(); return { offset: 0, data: 'YWJj' }; }, close: vi.fn(async () => {}) };
  await expect(nativeHtmlAsset({ client, threadId: 'thread', path: '/a.png', signal: controller.signal }))
    .rejects.toThrow();
  expect(client.close).toHaveBeenCalledWith('thread', id);
});
