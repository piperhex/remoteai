import { expect, it, vi } from 'vitest';
import { PreviewDownloads, type PreviewBackend, type PreviewSource, type PreviewTask }
  from '../../../../shared/remote-chat/previewDownloads';

const identity = { owner: 'user@server', deviceId: 'pc' };
function fixture() {
  const tasks: PreviewTask[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const connection = { ...identity, deviceName: 'PC', ready: true };
  const backend: PreviewBackend<PreviewTask> = {
    initialize: async () => {}, snapshot: () => tasks, connection: () => connection, error: () => '',
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    enqueue: vi.fn(async (source: PreviewSource) => {
      const task = { id: crypto.randomUUID(), source, createdAt: Date.now(), status: 'completed',
        size: 12, received: 12, message: '' };
      tasks.push(task); emit(); return task.id;
    }),
    resume: vi.fn(async id => { tasks.find(task => task.id === id)!.status = 'completed'; emit(); }),
    remove: vi.fn(async id => { tasks.splice(tasks.findIndex(task => task.id === id), 1); emit(); }),
    image: vi.fn(async task => `blob:${task.id}`), text: vi.fn(async () => '文本内容'),
    save: vi.fn(async () => {}), release: vi.fn(),
  };
  return { backend, tasks, connection, listeners, emit, previews: new PreviewDownloads(backend, identity) };
}

it('routes text, thumbnails and originals through separate managed jobs and reuses originals for save', async () => {
  const { backend, previews, tasks } = fixture();
  expect(await previews.text('thread', './note.md')).toEqual({ path: './note.md', text: '文本内容' });
  const thumb = await previews.image('thread', './image.png', false);
  const [original, duplicate] = await Promise.all([
    previews.image('thread', './image.png', true), previews.image('thread', './image.png', true),
  ]);
  expect(original).toBe(duplicate);
  expect(original).not.toBe(thumb);
  expect(tasks.map(task => task.source.preview)).toEqual(['text', 'thumbnail', 'image']);
  expect(backend.enqueue).toHaveBeenCalledTimes(3);
  await previews.saveImage(original);
  expect(backend.enqueue).toHaveBeenCalledTimes(3);
  expect(backend.save).toHaveBeenCalledWith(tasks[2]);
  await expect(previews.saveImage(thumb)).rejects.toThrow('原图');
});

it('refreshes reopened online text and expired images while keeping offline snapshots', async () => {
  const { backend, previews, tasks, connection } = fixture();
  await previews.text('thread', 'note.txt');
  await previews.text('thread', 'note.txt');
  expect(backend.enqueue).toHaveBeenCalledTimes(2);
  const first = await previews.image('thread', 'image.png', true);
  tasks[2].createdAt = 0;
  connection.ready = false;
  expect(await previews.image('thread', 'image.png', true)).toBe(first);
  connection.ready = true;
  expect(await previews.image('thread', 'image.png', true)).not.toBe(first);
});

it('resumes a paused task and never reuses another account, device, thread or variant', async () => {
  const { backend, previews, tasks } = fixture();
  await previews.image('thread', 'image.png', true);
  const original = tasks[0]; original.status = 'paused';
  await previews.image('thread', 'image.png', true);
  expect(backend.resume).toHaveBeenCalledWith(original.id);
  for (const patch of [{ owner: 'other' }, { deviceId: 'other' }, { threadId: 'other' }, { preview: 'thumbnail' }]) {
    Object.assign(original.source, patch);
    await previews.image('thread', 'image.png', true);
    Object.assign(tasks.at(-1)!.source, patch);
  }
  expect(backend.enqueue).toHaveBeenCalledTimes(5);
});

it('discards missing cache content so retry can transfer again', async () => {
  const { backend, previews } = fixture();
  vi.mocked(backend.image).mockRejectedValueOnce(new Error('missing'));
  await expect(previews.image('thread', 'image.png', true)).rejects.toThrow('missing');
  await previews.image('thread', 'image.png', true);
  expect(backend.remove).toHaveBeenCalledTimes(1);
  expect(backend.enqueue).toHaveBeenCalledTimes(2);
});

it('cleans up waiting listeners on disposal and bounds old cache records without deleting exports', async () => {
  const { backend, previews, tasks, connection, listeners } = fixture();
  await previews.image('thread', 'image.png', true);
  tasks[0].size = 128 * 1024 * 1024;
  const old = tasks[0].id;
  await previews.image('thread', 'next.png', true);
  expect(backend.remove).toHaveBeenCalledWith(old);
  connection.ready = false;
  const pending = previews.image('thread', 'uncached.png', true);
  await Promise.resolve(); await Promise.resolve();
  const rejection = expect(pending).rejects.toThrow('关闭');
  previews.dispose(); await rejection;
  expect(listeners.size).toBe(0);
});

it('shares real progress across original viewers and detaches a closed viewer without cancelling the transfer', async () => {
  const { backend, previews, tasks, emit, listeners } = fixture();
  vi.mocked(backend.enqueue).mockImplementation(async source => {
    tasks.push({ id: 'transfer', source, createdAt: Date.now(), status: 'downloading', size: 4096,
      received: 1024, bytesPerSecond: 512, message: '' });
    return 'transfer';
  });
  const first = vi.fn(); const second = vi.fn(); const closed = new AbortController();
  const one = previews.image('thread', 'image.png', true, { onProgress: first, signal: closed.signal });
  const two = previews.image('thread', 'image.png', true, { onProgress: second });
  await vi.waitFor(() => expect(second).toHaveBeenLastCalledWith({
    received: 1024, total: 4096, bytesPerSecond: 512, status: 'downloading',
  }));
  expect(first.mock.calls[0][0]).toEqual({ received: 0, status: 'preparing' });
  expect(backend.enqueue).toHaveBeenCalledOnce();
  closed.abort(); const firstCount = first.mock.calls.length;
  tasks[0].received = 2048; emit();
  expect(second).toHaveBeenLastCalledWith(expect.objectContaining({ received: 2048 }));
  expect(first).toHaveBeenCalledTimes(firstCount);
  tasks[0].received = 4096; tasks[0].status = 'completed'; emit();
  expect(await one).toBe(await two);
  expect(second).toHaveBeenLastCalledWith({ received: 4096, total: 4096,
    bytesPerSecond: undefined, status: 'completed' });
  expect(listeners.size).toBe(0);
});

it('reports resumed text bytes and does not confuse its progress with a thumbnail or original', async () => {
  const { backend, previews, tasks, emit } = fixture();
  await previews.text('thread', 'note.txt');
  tasks[0].received = 6; tasks[0].status = 'paused';
  vi.mocked(backend.resume).mockImplementation(async () => { tasks[0].status = 'downloading'; emit(); });
  const report = vi.fn();
  const text = previews.text('thread', 'note.txt', { onProgress: report });
  await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ received: 6, total: 12 })));
  await previews.image('thread', 'note.txt', false);
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ received: 6, total: 12 }));
  tasks[0].received = 12; tasks[0].status = 'completed'; emit();
  await expect(text).resolves.toMatchObject({ text: '文本内容' });
});
