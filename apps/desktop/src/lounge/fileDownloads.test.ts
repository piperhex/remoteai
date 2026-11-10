import { expect, it, vi } from 'vitest';
import { loungeDownloadClient } from '../../../../shared/lounge/downloadClient';
import { decodeAttachmentText, loungePreviewKind } from '../../../../shared/lounge/filePresentation';
import { previewAttachment } from '../../../../shared/lounge/previewAttachment';
import type { LoungeAttachmentManager } from '../../../../shared/lounge/attachmentManager';
import type { LoungeAttachment } from '../../../../shared/lounge/attachments';
import { validateFileInfo } from '../../../../shared/remote-chat/fileDownload';

const attachment: LoungeAttachment = { id: '10000000-0000-4000-8000-000000000001',
  device: '10000000-0000-4000-8000-000000000002', name: 'report.pdf', mime: 'application/pdf',
  size: 700_001, kind: 'file', grant: 'signed' };
const transferId = '20000000-0000-4000-8000-000000000001';

it('adapts pipelined download ranges to bounded sequential attachment reads, including resumed offsets', async () => {
  const bytes = Buffer.alloc(attachment.size, 149);
  let active = 0;
  const reader = { close: vi.fn(), read: vi.fn(async (offset: number, length: number) => {
    expect(active++).toBe(0); expect(length).toBeLessThanOrEqual(192 * 1024);
    await Promise.resolve(); active--; return bytes.subarray(offset, offset + length).toString('base64');
  }) };
  const manager = { openReader: vi.fn(async () => reader) } as unknown as LoungeAttachmentManager;
  const client = loungeDownloadClient(manager);
  const info = await client.open({ scope: 'computer', path: attachment.name, attachment, transferId });
  const chunks = await Promise.all([0, 262144, 524288].map(offset => client.read({ threadId: transferId,
    id: info.id, offset, length: Math.min(262144, bytes.length - offset) })));
  expect(Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data, 'base64')))).toEqual(bytes);
  expect(info.revision).toBe(`${attachment.device}:${attachment.id}`);
  await expect(client.read({ threadId: 'other-transfer', id: info.id, offset: 0, length: 1 })).rejects.toThrow();
  await client.close(transferId, info.id);
  expect(reader.close).toHaveBeenCalledOnce();
  await expect(client.read({ threadId: transferId, id: info.id, offset: 0, length: 1 })).rejects.toThrow();
});

it('does not open arbitrary paths or invalid attachment grants', async () => {
  const openReader = vi.fn();
  const client = loungeDownloadClient({ openReader } as unknown as LoungeAttachmentManager);
  await expect(client.open({ scope: 'computer', path: '../secret', attachment, transferId })).rejects.toThrow();
  await expect(client.open({ scope: 'computer', path: attachment.name, transferId })).rejects.toThrow();
  expect(openReader).not.toHaveBeenCalled();
});

it('shares GUI file kinds and rejects corrupt text while accepting Chinese BOM encodings', () => {
  for (const [name, kind] of [['report.PDF', 'pdf'], ['page.html', 'html'], ['guide.md', 'markdown'],
    ['image.svg', 'image'], ['sound.wav', 'audio'], ['clip.mp4', 'video'], ['main.rs', 'text'], ['archive.zip', undefined]]) {
    expect(loungePreviewKind({ name: name!, mime: '' })).toBe(kind);
  }
  expect(decodeAttachmentText(new Uint8Array([255, 254, 45, 78]))).toBe('中');
  expect(decodeAttachmentText(new Uint8Array([254, 255, 78, 45]))).toBe('中');
  expect(() => decodeAttachmentText(new Uint8Array([65, 0, 66]))).toThrow();
  expect(() => decodeAttachmentText(new Uint8Array([255]))).toThrow();
});

it('checks preview size before allocating or opening a transfer', async () => {
  const download = vi.fn();
  await expect(previewAttachment({ file: { ...attachment, size: 65 * 1024 * 1024 },
    attachments: { download } as unknown as LoungeAttachmentManager,
    signal: new AbortController().signal, progress: () => {} }))
    .rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
  expect(download).not.toHaveBeenCalled();
});

it('keeps lounge size limits independent of ordinary remote file limits', () => {
  const client = loungeDownloadClient({} as LoungeAttachmentManager);
  const info = { id: transferId, name: 'large.zip', size: 21 * 1024 * 1024, mimeType: 'application/zip' };
  expect(() => validateFileInfo(info, 'relay')).toThrow();
  expect(() => validateFileInfo(info, 'relay', client.checkSize)).not.toThrow();
  expect(() => client.checkSize!(301 * 1024 * 1024)).toThrow();
});

it('detects transport streams without confusing TypeScript and decodes UTF16 on Hermes', () => {
  const bytes = new Uint8Array(400); bytes[0] = bytes[188] = 0x47;
  expect(loungePreviewKind({ name: 'clip.ts', mime: '' }, bytes)).toBe('video');
  expect(loungePreviewKind({ name: 'source.ts', mime: '' }, new TextEncoder().encode('const x = 1'))).toBe('text');
  vi.stubGlobal('TextDecoder', undefined);
  try {
    expect(decodeAttachmentText(new Uint8Array([255, 254, 45, 78, 61, 216, 0, 222]))).toBe('中😀');
    expect(() => decodeAttachmentText(new Uint8Array([255, 254, 0, 216]))).toThrow();
  } finally { vi.unstubAllGlobals(); }
});
