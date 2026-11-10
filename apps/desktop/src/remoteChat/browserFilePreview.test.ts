import { expect, it, vi } from 'vitest';
import { fromByteArray } from 'base64-js';
import { filePreviewKind, PREVIEW_BYTE_LIMIT } from '../../../../shared/file-preview/kinds';
import { sshPreviewLoader } from '../../../../shared/file-preview/sshLoader';
import { projectPreviewLoader } from '../../../../shared/file-preview/projectLoader';
import { createSshProjectClient } from '../../../../shared/terminal/sshProjectClient';
import type { SshApi, SshFileReply } from '../../../../shared/terminal/ssh';
import { PROJECT_FILE_CHUNK_BYTES, type ProjectBrowserClient } from '../../../../shared/project-browser/protocol';

function sshFixture(size: number) {
  const files = vi.fn<SshApi['files']>(async (_id, request): Promise<SshFileReply> => {
    if (request.type === 'list') return { type: 'list', path: '/', truncated: false,
      entries: [{ name: 'report.PDF', path: '/report.PDF', size, directory: false }] };
    if (request.type === 'readChunk') return { type: 'file', data: fromByteArray(new Uint8Array(request.length)) };
    throw new Error('Unexpected request');
  });
  return { files, api: { files } as unknown as SshApi };
}

it('recognizes the conversation preview extensions without treating code as media', () => {
  expect(['a.PDF', 'a.mdx', 'a.xhtml', 'a.svg', 'a.flac', 'a.mov'].map(filePreviewKind))
    .toEqual(['pdf', 'markdown', 'html', 'image', 'audio', 'video']);
  expect(filePreviewKind('a.ts')).toBeUndefined();
  expect(filePreviewKind('a.zip')).toBeUndefined();
});

it('opens SSH PDF metadata without first decoding the whole file as text', async () => {
  const { api, files } = sshFixture(12 * 1024 * 1024);
  const { client } = createSshProjectClient(api, 'selected-ssh');
  expect(await client.read({ cwd: '/', path: '/report.PDF' })).toMatchObject({ kind: 'binary', readOnly: true });
  expect(files).toHaveBeenCalledTimes(1);
  expect(files.mock.calls[0][0]).toBe('selected-ssh');
});

it('reads SSH previews in bounded packets and stops after cancellation', async () => {
  const { api, files } = sshFixture(PROJECT_FILE_CHUNK_BYTES * 3);
  const controller = new AbortController();
  const load = sshPreviewLoader(api, 'selected-ssh');
  await expect(load('/report.PDF', { signal: controller.signal, progress: received => {
    if (received) controller.abort();
  } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(files.mock.calls.filter(([, request]) => request.type === 'readChunk')).toHaveLength(1);
});

it('rejects oversized SSH previews before reading or allocating their contents', async () => {
  const { api, files } = sshFixture(PREVIEW_BYTE_LIMIT + 1);
  await expect(sshPreviewLoader(api, 'ssh')('/report.PDF', { signal: new AbortController().signal, progress: vi.fn() }))
    .rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
  expect(files).toHaveBeenCalledTimes(1);
});

it('project previews use the selected project transfer and close it on failure', async () => {
  const id = '12345678-1234-1234-1234-123456789012';
  const transfer = { open: vi.fn(async () => ({ id, size: 4, name: 'report.PDF', mimeType: 'application/pdf' })),
    read: vi.fn(async () => { throw new Error('Disconnected'); }), close: vi.fn(async () => {}), browse: vi.fn() };
  const client = { transfer } as unknown as ProjectBrowserClient;
  await expect(projectPreviewLoader(client, 'D:/remote')('D:/remote/report.PDF',
    { signal: new AbortController().signal, progress: vi.fn() })).rejects.toThrow('Disconnected');
  expect(transfer.open).toHaveBeenCalledWith(expect.objectContaining({ scope: 'project', cwd: 'D:/remote',
    path: 'D:/remote/report.PDF' }), expect.any(Object));
  expect(transfer.close).toHaveBeenCalledWith(expect.any(String), id);
});
