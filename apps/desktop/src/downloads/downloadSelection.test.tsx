// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DownloadTask } from '../../../../shared/downloads/types';
import { useDownloadTasks } from '../../../../shared/downloads/useDownloadTasks';
import { useDownloadSelection } from '../../../../shared/downloads/useDownloadSelection';

const mocks = vi.hoisted(() => ({ tasks: [] as DownloadTask[], remove: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../../shared/downloads/manager', () => ({ downloadManager: {
  subscribe: () => () => {}, snapshot: () => mocks.tasks, connection: () => undefined,
  error: () => '', initialize: async () => {}, remove: mocks.remove,
} }));

let root: ReturnType<typeof createRoot>;
let current: ReturnType<typeof useDownloadTasks> & ReturnType<typeof useDownloadSelection>;
function Fixture({ owner = 'owner', filter = 'all' }: { owner?: string; filter?: string }) {
  const downloads = useDownloadTasks(owner, { confirmRemove: mocks.confirm, additionalOwner: 'desktop-local' });
  const visible = downloads.tasks.filter(task => filter === 'all' || task.status === filter);
  current = { ...downloads, ...useDownloadSelection(visible, `${owner}:${filter}`) };
  return null;
}
const render = async (props = {}) => { await act(async () => root.render(<Fixture {...props} />)); };

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  mocks.tasks = ['remote', 'local', 'other'].map(id => ({ id, name: id, status: 'paused', size: 0,
    received: 0, createdAt: 0, message: '',
    source: { owner: id === 'local' ? 'desktop-local' : id === 'other' ? 'other' : 'owner',
      deviceId: id, deviceName: id, scope: 'computer', path: id } }));
  mocks.remove.mockImplementation(async id => { mocks.tasks = mocks.tasks.filter(task => task.id !== id); });
  root = createRoot(document.createElement('div'));
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('deletes local and remote selections once, keeps failures selected, and isolates other accounts', async () => {
  await act(async () => { current.toggle('remote'); current.toggle('local'); current.toggle('other'); });
  expect([...current.selected]).toEqual(['remote', 'local']);
  mocks.remove.mockImplementation(async id => {
    if (id === 'remote') throw new Error('private path');
    mocks.tasks = mocks.tasks.filter(task => task.id !== id);
  });
  await act(async () => { await current.removeTasks(['remote', 'local', 'other', 'remote']); });
  await render();
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(2);
  expect(mocks.remove.mock.calls.flat().sort()).toEqual(['local', 'remote']);
  expect([...current.selected]).toEqual(['remote']);
  expect(current.error).toBe('部分下载未能删除，请重试。');
});

it('keeps selection on cancellation and prevents repeated confirmation or overlapping removal', async () => {
  let confirm: (value: boolean) => void = () => {};
  mocks.confirm.mockImplementation(() => new Promise<boolean>(resolve => { confirm = resolve; }));
  await act(async () => current.toggle('local'));
  let pending: Promise<void>;
  await act(async () => { pending = current.removeTasks(['local']); });
  await act(async () => { await current.removeTasks(['local']); });
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(current.busy).toBe('local');
  await act(async () => { confirm(false); await pending; });
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(current.selected.has('local')).toBe(true);
  expect(current.busy).toBe('');
});

it('clears selections when the account, filter or available tasks change', async () => {
  await act(async () => current.toggle('local'));
  await render({ owner: 'other' });
  expect(current.selected.size).toBe(0);
  await act(async () => current.toggle('local'));
  await render({ owner: 'other', filter: 'paused' });
  expect(current.selected.size).toBe(0);
  await act(async () => current.toggle('local'));
  mocks.tasks = mocks.tasks.filter(task => task.id !== 'local');
  await render({ owner: 'other', filter: 'paused' });
  expect(current.selected.size).toBe(0);
});

it('selects every visible local and remote task, and clears a complete selection', async () => {
  await act(async () => current.toggle('local'));
  expect(current.allSelected).toBe(false);
  await act(async () => current.toggleAll());
  expect([...current.selected].sort()).toEqual(['local', 'remote']);
  expect(current.allSelected).toBe(true);
  await act(async () => current.toggleAll());
  expect(current.selected.size).toBe(0);
  expect(current.allSelected).toBe(false);
  await render({ filter: 'ready' });
  await act(async () => current.toggleAll());
  expect(current.selected.size).toBe(0);
  expect(current.allSelected).toBe(false);
  mocks.tasks = mocks.tasks.map(task => task.id === 'local' ? { ...task, status: 'ready' } : task);
  await render({ filter: 'ready' });
  await act(async () => current.toggleAll());
  expect([...current.selected]).toEqual(['local']);
  expect(current.allSelected).toBe(true);
});

it('does not auto-select new tasks and updates all-selected after individual changes', async () => {
  await act(async () => current.toggleAll());
  mocks.tasks = [...mocks.tasks, { ...mocks.tasks[0], id: 'new' }];
  await render();
  expect(current.selected.has('new')).toBe(false);
  expect(current.allSelected).toBe(false);
  await act(async () => current.toggleAll());
  expect(current.selected.size).toBe(3);
  expect(current.allSelected).toBe(true);
  await act(async () => current.toggle('new'));
  expect(current.allSelected).toBe(false);
  mocks.tasks = mocks.tasks.filter(task => task.id !== 'new');
  await render();
  expect(current.allSelected).toBe(true);
});
