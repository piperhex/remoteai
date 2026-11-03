import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import type { ChatConnection } from '../../../../../../shared/remote-chat/client/connection';
import type { ChatProject, ChatState } from '../../../../../../shared/remote-chat/client/types';
import { historyDelta } from '../../../../../../shared/remote-chat/historySync';

const original = { id: 'chat', cwd: '/original', preview: '', updatedAt: 1, turns: [] };
const folder = { cwd: '/new', label: 'new' };
let controller: ChatController;
const request = vi.fn<ChatConnection['request']>();
beforeEach(() => {
  request.mockReset().mockResolvedValue(folder);
  controller = new ChatController(() => ({ start() {}, stop() {},
    request: <T,>(...args: Parameters<ChatConnection['request']>) => request(...args) as Promise<T> }));
  Object.assign(controller.snapshot(), { ready: true, selected: original, threads: [original] });
});
afterEach(() => controller.stop());

it('switches an idle conversation and preserves its messages and composer settings', async () => {
  const before = controller.snapshot();
  expect(await controller.selectProject(folder)).toBe(true);
  expect(request).toHaveBeenCalledWith('request', { operation: 'guiProjectSelect', cwd: '/new', threadId: 'chat' });
  expect(controller.snapshot()).toMatchObject({ selected: { ...original, cwd: '/new' },
    threads: [{ ...original, cwd: '/new' }], settings: before.settings, workspaceBusy: false });
});

const unavailableStates: Partial<ChatState>[] = [
  { ready: false }, { selectedArchived: true }, { sending: true }, { goalBusy: true },
  { workspaceBusy: true }, { compacting: 'chat' }, { queueBusy: true },
  { selected: { ...original, turns: [{ id: 'turn', status: 'inProgress', items: [] }] } },
  { queue: { revision: 1, threads: { chat: [{ id: 'message', text: 'pending',
    imageCount: 0, attachmentCount: 0, busy: false }] } } },
  { approvals: [{ id: 1, method: 'approval', params: { threadId: 'chat' } }] },
];
it.each(unavailableStates)('rejects project changes while unavailable: %j', async patch => {
  Object.assign(controller.snapshot(), patch);
  expect(await controller.selectProject(folder)).toBe(false);
  expect(request).not.toHaveBeenCalled();
});

it('keeps the original project after failure and blocks duplicate selection and sending', async () => {
  let reject!: (reason: Error) => void;
  request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = controller.selectProject(folder);
  expect(await controller.selectProject(folder)).toBe(false);
  expect(await controller.send({ text: 'continue', access: 'workspace-write' })).toBe(false);
  reject(new Error('暂时无法读取文件夹。'));
  expect(await pending).toBe(false);
  expect(controller.snapshot()).toMatchObject({ selected: original, workspaceBusy: false, error: '暂时无法读取文件夹。' });
});

it('does not let a stale list or history read replace the newly selected folder', async () => {
  let finishSelect!: (project: ChatProject) => void;
  let finishList!: (result: unknown) => void;
  let finishHistory!: (result: unknown) => void;
  request.mockImplementation((_method, body) => new Promise(resolve => {
    const operation = (body as { operation: string }).operation;
    if (operation === 'guiProjectSelect') finishSelect = resolve;
    if (operation === 'list') finishList = resolve;
    if (operation === 'syncHistory') finishHistory = resolve;
  }));
  const selecting = controller.selectProject(folder);
  const listing = controller.list();
  const reading = controller.refreshSelected();
  finishSelect(folder); await selecting;
  finishList({ data: [original], nextCursor: null });
  finishHistory(historyDelta(original));
  await Promise.all([listing, reading]);
  expect(controller.snapshot()).toMatchObject({ selected: { cwd: '/new' }, threads: [{ cwd: '/new' }],
    loading: false, historyLoading: false });
});

it('does not apply an earlier choice to a different conversation', async () => {
  let finish!: (project: ChatProject) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = controller.selectProject(folder);
  const other = { ...original, id: 'other', cwd: '/other' };
  Object.assign(controller.snapshot(), { selected: other });
  finish(folder); await pending;
  expect(controller.snapshot().selected).toEqual(other);
  expect(controller.snapshot().threads[0].cwd).toBe('/new');
});

it('can clear a draft and does not replace a newer draft while selecting', async () => {
  Object.assign(controller.snapshot(), { selected: null, draftProject: { cwd: '/original', label: 'original' } });
  expect(await controller.selectProject(null)).toBe(true);
  expect(controller.snapshot().draftProject).toBeNull();
  let finish!: (project: ChatProject) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = controller.selectProject(folder);
  controller.chooseDraftProject({ cwd: '/newer', label: 'newer' });
  finish(folder); await pending;
  expect(controller.snapshot().draftProject?.cwd).toBe('/newer');
});

it('moves a nonselected chat, clears its group, and preserves the active chat and draft', async () => {
  const other = { ...original, id: 'other', cwd: '/other' };
  const draftProject = { cwd: '/draft', label: 'draft' };
  Object.assign(controller.snapshot(), { selected: other, draftProject });
  request.mockResolvedValueOnce({ ...folder, sidebar: { revision: 1,
    threads: { chat: { cwd: '/new', projectName: 'new', title: 'chat', running: false } }, readState: {},
    grouping: { groups: [], projects: {}, threads: {} } } });
  await controller.moveThreadToProject('chat', '/new');
  expect(request).toHaveBeenCalledWith('request', { operation: 'guiProjectSelect', cwd: '/new',
    threadId: 'chat', removeFromGroup: true });
  expect(controller.snapshot()).toMatchObject({ selected: other, draftProject, workspaceBusy: false,
    threads: [{ cwd: '/new' }], sidebar: { grouping: { threads: {} }, threads: { chat: { cwd: '/new' } } } });
});

it('does not apply a late move result after disconnecting', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = controller.moveThreadToProject('chat', '/new');
  controller.stop();
  finish(folder);
  await expect(pending).rejects.toThrow('connectToYourComputerFirst');
  expect(controller.snapshot().threads[0].cwd).toBe('/original');
});

it('keeps placement on failure and prevents duplicate moves or moving running conversations', async () => {
  let reject!: (error: Error) => void;
  request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = controller.moveThreadToProject('chat', '/new');
  await expect(controller.moveThreadToProject('chat', '/other')).rejects.toThrow('waitForTheCurrentTask');
  reject(new Error('folder unavailable'));
  await expect(pending).rejects.toThrow('folder unavailable');
  expect(controller.snapshot()).toMatchObject({ workspaceBusy: false, selected: original, threads: [original] });
  Object.assign(controller.snapshot(), { selected: { ...original,
    turns: [{ id: 'active', status: 'inProgress', items: [] }] } });
  await expect(controller.moveThreadToProject('chat', '/new')).rejects.toThrow('waitForTheCurrentTask');
  expect(request).toHaveBeenCalledTimes(1);
});

it('preserves a newer sidebar placement when an earlier move acknowledgement arrives late', async () => {
  const sidebar = (revision: number, cwd: string) => ({ revision,
    threads: { chat: { cwd, projectName: cwd, title: 'Chat', running: false } }, readState: {},
    grouping: { groups: [], projects: {}, threads: {} } });
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = controller.moveThreadToProject('chat', '/new');
  Object.assign(controller.snapshot(), { sidebar: sidebar(3, '/newer') });
  finish({ ...folder, sidebar: sidebar(2, '/new') });
  await pending;
  expect(controller.snapshot()).toMatchObject({ selected: { cwd: '/newer' }, threads: [{ cwd: '/newer' }],
    sidebar: { revision: 3 } });
});
