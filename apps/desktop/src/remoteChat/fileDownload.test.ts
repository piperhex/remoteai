import { afterEach, expect, it, vi } from 'vitest';
import { downloadFile, DownloadCancelled, FILE_CHUNK_BYTES, type FileClient, type FileInfo }
  from '../../../../shared/remote-chat/fileDownload';
import { DEFAULT_CHAT_POLICY, setChatConnectionMode, setChatPolicy }
  from '../../../../shared/remote-chat/policy';

const info: FileInfo = { id: '01234567-0123-4123-8123-012345678901', size: 0,
  name: '安装包.exe', mimeType: 'application/octet-stream' };
afterEach(() => { setChatConnectionMode('offline'); setChatPolicy(DEFAULT_CHAT_POLICY); });

function fixture(size = FILE_CHUNK_BYTES * 2 + 17) {
  const source = Buffer.alloc(size);
  for (let index = 0; index < size; index++) source[index] = index % 256;
  const client: FileClient = { open: vi.fn(async () => ({ ...info, size })),
    read: vi.fn(async ({ offset, length }) => ({ offset, data: source.subarray(offset, offset + length).toString('base64') })),
    close: vi.fn(async () => undefined) };
  const chunks: Buffer[] = [];
  const destination = { write: vi.fn(async (data: string) => { chunks.push(Buffer.from(data, 'base64')); }),
    finish: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined) };
  const controller = new AbortController();
  const options = { client, threadId: 'chat', path: '安装包.exe', signal: controller.signal,
    target: vi.fn(async () => destination), progress: vi.fn() };
  return { source, client, destination, options, chunks, controller };
}

it('downloads every byte in bounded sequential chunks and releases both resources', async () => {
  const task = fixture();
  await downloadFile(task.options);
  expect(Buffer.concat(task.chunks)).toEqual(task.source);
  expect(task.client.read).toHaveBeenCalledTimes(3);
  expect(task.options.progress).toHaveBeenLastCalledWith(task.source.length, task.source.length);
  expect(task.destination.finish).toHaveBeenCalledOnce();
  expect(task.destination.dispose).toHaveBeenCalledOnce();
  expect(task.client.close).toHaveBeenCalledWith('chat', info.id);
});

it('saves empty files without issuing an invalid range read', async () => {
  const task = fixture(0);
  await downloadFile(task.options);
  expect(task.client.read).not.toHaveBeenCalled();
  expect(task.destination.finish).toHaveBeenCalledOnce();
});

it('waits for disk writes before requesting another chunk when configured for a single in-flight block', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadWindowSize: 1 });
  const task = fixture();
  let release: () => void = () => undefined;
  task.destination.write.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const running = downloadFile(task.options);
  await vi.waitFor(() => expect(task.destination.write).toHaveBeenCalledOnce());
  expect(task.client.read).toHaveBeenCalledOnce();
  release();
  await running;
});

it('cancels an in-flight read without saving or retaining a partial file', async () => {
  const task = fixture();
  vi.mocked(task.client.read).mockImplementationOnce(async () => {
    task.controller.abort(); return { offset: 0, data: '' };
  });
  await expect(downloadFile(task.options)).rejects.toBeInstanceOf(DownloadCancelled);
  expect(task.destination.write).not.toHaveBeenCalled();
  expect(task.destination.finish).not.toHaveBeenCalled();
  expect(task.destination.dispose).toHaveBeenCalledOnce();
  expect(task.client.close).toHaveBeenCalledOnce();
});

it.each([{ offset: 1, data: 'AA==' }, { offset: 0, data: '!!!!' }, { offset: 0, data: 'AA==' }])(
  'rejects corrupt and truncated chunks before writing: %j', async (chunk) => {
    const task = fixture(3);
    vi.mocked(task.client.read).mockResolvedValue(chunk);
    await expect(downloadFile(task.options)).rejects.toThrow('不完整');
    expect(task.destination.write).not.toHaveBeenCalled();
    expect(task.destination.dispose).toHaveBeenCalledOnce();
    expect(task.client.close).toHaveBeenCalledOnce();
  });

it('cleans up after disk failure and after the save destination cannot open', async () => {
  const task = fixture();
  task.destination.write.mockRejectedValueOnce(new Error('disk full'));
  await expect(downloadFile(task.options)).rejects.toThrow('disk full');
  expect(task.destination.finish).not.toHaveBeenCalled();
  expect(task.destination.dispose).toHaveBeenCalledOnce();
  task.options.target.mockRejectedValueOnce(new Error('denied'));
  await expect(downloadFile(task.options)).rejects.toThrow('denied');
  expect(task.client.close).toHaveBeenCalledTimes(2);
});

it('allows large P2P downloads and rechecks relay policy after the connection changes', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: 1 });
  const task = fixture(2 * 1024 * 1024);
  setChatConnectionMode('direct');
  await downloadFile(task.options);
  task.options.progress.mockImplementationOnce(() => setChatConnectionMode('relay'));
  await expect(downloadFile(task.options)).rejects.toThrow('1 MB');
  expect(task.client.close).toHaveBeenCalledTimes(2);
});
