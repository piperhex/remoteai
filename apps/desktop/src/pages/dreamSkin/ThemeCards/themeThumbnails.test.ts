import { expect, it, vi } from 'vitest';
import { ThemeThumbnails } from './themeThumbnails';

vi.mock('../../../api/backend', () => ({ loadDreamSkinThemePreview: vi.fn() }));
const signal = () => new AbortController().signal;

it('limits decoding concurrency and skips cards scrolled away before their turn', async () => {
  const complete = new Map<string, (value: string) => void>();
  const read = vi.fn((id: string) => new Promise<string>(resolve => complete.set(id, resolve)));
  const previews = new ThemeThumbnails(read);
  const release = previews.retain();
  const first = previews.load('first', signal());
  const second = previews.load('second', signal());
  const cancelled = new AbortController();
  const third = previews.load('third', cancelled.signal);
  const fourth = previews.load('fourth', signal());
  expect(read.mock.calls.flat()).toEqual(['first', 'second']);
  cancelled.abort();
  expect(await third).toBeNull();
  complete.get('first')!('small-first');
  await first;
  expect(read.mock.calls.flat()).toEqual(['first', 'second', 'fourth']);
  complete.get('second')!('small-second');
  complete.get('fourth')!('small-fourth');
  await Promise.all([second, fourth]);
  release();
});

it('does not retain abandoned in-flight images and clears cache when the last browser closes', async () => {
  let finish: (value: string) => void = () => {};
  const read = vi.fn(async () => 'thumbnail');
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const previews = new ThemeThumbnails(read);
  const release = previews.retain();
  const cancelled = new AbortController();
  const abandoned = previews.load('theme', cancelled.signal);
  cancelled.abort(); finish('abandoned');
  expect(await abandoned).toBeNull();
  expect(await previews.load('theme', signal())).toBe('thumbnail');
  await previews.load('theme', signal());
  expect(read).toHaveBeenCalledTimes(2);
  release();
  const reopened = previews.retain();
  await previews.load('theme', signal());
  expect(read).toHaveBeenCalledTimes(3);
  reopened();
});

it('bounds cache bytes and evicts the least recently used thumbnail', async () => {
  const read = vi.fn(async (id: string) => id + 'x'.repeat(400_000));
  const previews = new ThemeThumbnails(read);
  const release = previews.retain();
  await previews.load('first', signal());
  await previews.load('second', signal());
  await previews.load('first', signal());
  await previews.load('third', signal());
  await previews.load('first', signal());
  expect(read).toHaveBeenCalledTimes(3);
  await previews.load('second', signal());
  expect(read).toHaveBeenCalledTimes(4);
  release();
});
