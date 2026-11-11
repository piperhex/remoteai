import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type { PaseoAgentHandle } from '@getpaseo/client';
import { CliImages } from './images';
import { CliImageHistory } from './imageHistory';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    expect(relative(tmpdir(), root)).toMatch(/^remoteai-image-history-[^\\/]+$/);
    await rm(root, { recursive: true, force: true });
  }
});
it('restores repeated prompts by user-turn order across pages and caches older counts per replay epoch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remoteai-image-history-')); roots.push(root);
  const images = new CliImages(root);
  await images.save('agent', 'first-client-id', { text: 'Same prompt', images: ['data:image/png;base64,Zmlyc3Q='] }, 1);
  await images.save('agent', 'third-client-id', { text: 'Same prompt', images: ['data:image/png;base64,dGhpcmQ='] }, 3);
  let epoch = 'replay-1';
  const rows = Array.from({ length: 6 }, (_, index) => ({ seqStart: index + 1, seqEnd: index + 1,
    item: { type: index % 2 ? 'assistant_message' : 'user_message', text: 'Same prompt' } }));
  const page = (end = 6) => ({ agent: { id: 'agent' }, entries: rows.slice(Math.max(0, end - 2), end),
    startCursor: { epoch, seq: Math.max(1, end - 1) }, hasOlder: end > 2 });
  const refetch = vi.fn(async (options: { cursor?: { seq: number } }) => page(options.cursor ? options.cursor.seq - 1 : 6));
  const agent = { id: 'agent', timeline: { refetch } } as unknown as PaseoAgentHandle;
  const history = new CliImageHistory(images);
  type Page = Awaited<ReturnType<PaseoAgentHandle['timeline']['refetch']>>;
  const read = () => history.entries(agent, page() as unknown as Page);
  const entry = (await read())[0];
  expect(await images.load('agent', entry.images![0])).toBe('data:image/png;base64,dGhpcmQ=');
  expect(refetch).toHaveBeenCalledTimes(2);
  expect(await read()).toEqual([entry, expect.anything()]);
  expect(refetch).toHaveBeenCalledTimes(2);
  expect(await history.nextOrdinal(agent)).toBe(4);
  epoch = 'replay-2';
  expect((await read())[0]).toEqual(entry);
  expect(refetch).toHaveBeenCalledTimes(5);
  // A retry with only text must replace an unaccepted image at the same native turn position.
  await images.save('agent', 'replacement', { text: 'Text only', images: [] }, 3);
  expect((await read())[0]).toMatchObject({ text: 'Text only', images: [] });
});
