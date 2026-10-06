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
      const task = { id: crypto.randomUUID(), source, createdAt: Date.now(), status: 'completed', size: 12, message: '' };
      tasks.push(task); emit(); return task.id;
    }),
    resume: vi.fn(async id => { tasks.find(task => task.id === id)!.status = 'completed'; emit(); }),
    remove: vi.fn(async id => { tasks.splice(tasks.findIndex(task => task.id === id), 1); emit(); }),
    image: vi.fn(async task => `blob:${task.id}`), text: vi.fn(async () => '文本内容'),
    save: vi.fn(async () => {}), release: vi.fn(),
  };
  return { backend, tasks, connection, listeners, previews: new PreviewDownloads(backend, identity) };
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
