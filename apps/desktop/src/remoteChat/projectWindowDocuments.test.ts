import { expect, it, vi } from 'vitest';
import { ProjectDocuments } from '../../../../shared/project-browser/documents';
import type { ProjectBrowserClient, ProjectDocument } from '../../../../shared/project-browser/protocol';

function fixture() {
  const original: ProjectDocument = { path: '/project/old/file.txt', text: 'saved page', kind: 'text',
    size: 400_000, revision: 'revision', readOnly: false,
    window: { token: crypto.randomUUID(), offset: 64_000, end: 128_000, previous: 0 } };
  const client: ProjectBrowserClient = { list: vi.fn(), save: vi.fn(), release: vi.fn().mockResolvedValue(undefined),
    mutate: vi.fn().mockResolvedValue({ path: '/project/new', directory: true }),
    read: vi.fn().mockResolvedValueOnce(original).mockImplementation(async target => ({
      ...original, path: target.path, window: target.window,
    })) };
  return { client, original, store: new ProjectDocuments(client, '/project') };
}

it('rebinds a moved page while retaining its unsaved draft and saved revision', async () => {
  const { client, original, store } = fixture();
  await store.open(original.path);
  store.edit(original.path, 'unsaved page');
  await store.mutate({ cwd: '/project', path: '/project/old', action: 'rename', name: 'new' });
  const moved = store.get('/project/new/file.txt')!;
  expect(moved.text).toBe('unsaved page');
  expect(moved.document?.text).toBe('saved page');
  expect(moved.document?.window?.token).not.toBe(original.window!.token);
  expect(client.release).toHaveBeenCalledWith({ cwd: '/project', path: original.path, window: original.window });
  expect(client.read).toHaveBeenLastCalledWith(expect.objectContaining({ path: moved.path,
    window: expect.objectContaining({ open: true, offset: 64_000, end: 128_000 }) }));
});

it('keeps a draft visible but prevents saving with a stale view if rebind conflicts', async () => {
  const { client, original, store } = fixture();
  await store.open(original.path);
  store.edit(original.path, 'keep me');
  vi.mocked(client.read).mockResolvedValueOnce({ ...original, revision: 'external' });
  await store.mutate({ cwd: '/project', path: '/project/old', action: 'rename', name: 'new' });
  const moved = store.get('/project/new/file.txt')!;
  expect(moved.text).toBe('keep me');
  expect(moved.error).toBeTruthy();
  expect(moved.document?.readOnly).toBe(true);
  expect(await store.save(moved.path)).toBe(false);
  expect(client.save).not.toHaveBeenCalled();
});

it('releases a deleted file page without opening a new snapshot', async () => {
  const { client, original, store } = fixture();
  await store.open(original.path);
  await store.mutate({ cwd: '/project', path: '/project/old', action: 'delete' });
  expect(client.release).toHaveBeenCalledTimes(1);
  expect(client.read).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().tabs).toEqual([]);
});
