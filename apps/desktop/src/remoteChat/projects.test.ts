// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from '../pages/codexGui/controller';
import { getGuiController } from '../pages/codexGui/session';
import { guiApi } from '../../../../shared/conversation/api';
import { saveProject } from '../../../../shared/conversation/projectCatalog';
import { initialState } from '../pages/codexGui/preferences';
import { guiComposer } from '../pages/codexGui/composerBridge';
import type { Thread } from '../../../../shared/conversation/types';
import { ChatOperations } from './operations';
import { readRemoteProjects, selectRemoteProject } from './projects';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: vi.fn() }));
vi.mock('../pages/codexGui/composerBridge', () => ({ guiComposer: { validateSend: vi.fn() } }));
const thread: Thread = { id: 'chat', cwd: '/old', preview: '', updatedAt: 1, turns: [] };
let controller: GuiController;
let detachSidebar: () => void;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); controller = new GuiController();
  vi.mocked(getGuiController).mockReturnValue(controller);
  Object.assign(controller.getSnapshot(), { connection: 'ready', threads: [thread], selected: 'local',
    projects: ['/recent'] });
  detachSidebar = guiSidebar.attach(controller);
  vi.mocked(guiComposer.validateSend).mockResolvedValue({ model: 'model', effort: 'high', access: 'workspace-write' });
  vi.mocked(guiApi.request).mockImplementation(async body => {
    if (body.operation === 'projectDirectories') return { directory: '/canonical', entries: [] };
    if (body.operation === 'list') return { data: [thread], nextCursor: null };
    return { thread };
  });
});
afterEach(() => { detachSidebar(); controller.dispose(); vi.restoreAllMocks(); });

it('lists host saved and recent projects, deduplicates paths, and uses effective conversation folders', () => {
  saveProject({ path: '/recent', name: 'Saved name' });
  Object.assign(controller.getSnapshot(), { projectOverrides: { chat: '/changed' } });
  expect(readRemoteProjects()).toEqual([{ cwd: '/recent', label: 'Saved name' },
    { cwd: '/changed', label: 'changed' }]);
});

it('validates and persists a folder without switching the host’s selected conversation', async () => {
  const settings = controller.getSnapshot().settings;
  expect(await selectRemoteProject({ cwd: '/canonical/../canonical', threadId: 'chat' }))
    .toEqual({ cwd: '/canonical', label: 'canonical' });
  expect(guiApi.request).toHaveBeenCalledWith({ operation: 'projectDirectories', directory: '/canonical/../canonical' });
  expect(controller.getSnapshot()).toMatchObject({ selected: 'local', settings, workspaceBusy: false,
    projectOverrides: { chat: '/canonical' }, threads: [{ id: 'chat', cwd: '/canonical' }] });
  expect(initialState().projectOverrides).toEqual({ chat: '/canonical' });
});

it('initializes an idle host before switching and releases the busy guard on failure', async () => {
  Object.assign(controller.getSnapshot(), { connection: 'offline' });
  const connect = vi.spyOn(controller, 'connect').mockImplementation(async () => {
    Object.assign(controller.getSnapshot(), { connection: 'ready' });
  });
  await selectRemoteProject({ cwd: '/canonical' });
  expect(connect).toHaveBeenCalledWith({ reuseExisting: true });
  vi.mocked(guiApi.request).mockRejectedValueOnce('暂时无法读取文件夹。');
  await expect(selectRemoteProject({ cwd: '/missing', threadId: 'chat' })).rejects.toBe('暂时无法读取文件夹。');
  expect(controller.getSnapshot()).toMatchObject({ workspaceBusy: false, projectOverrides: {} });
});

it('rejects invalid input and rechecks a turn that starts while the directory is being validated', async () => {
  await expect(selectRemoteProject({ cwd: '', threadId: 'chat' })).rejects.toThrow('有效');
  await expect(selectRemoteProject({ cwd: '/new', threadId: '../chat' })).rejects.toThrow('有效');
  expect(guiApi.request).not.toHaveBeenCalled();
  vi.mocked(guiApi.request).mockImplementation(async body => body.operation === 'read'
    ? { thread: { ...thread, turns: [{ id: 'running', status: 'inProgress', items: [] }] } }
    : { directory: '/canonical', entries: [] });
  await expect(selectRemoteProject({ cwd: '/canonical', threadId: 'chat' })).rejects.toThrow('等待');
  expect(controller.getSnapshot()).toMatchObject({ workspaceBusy: false, projectOverrides: {} });
});

it('keeps the effective folder in list, history, events, and subsequent resume/send requests', async () => {
  await selectRemoteProject({ cwd: '/canonical', threadId: 'chat' });
  const operations = new ChatOperations();
  const execute = (operation: string) => operations.execute({ kind: 'request', id: operation, method: 'request',
    body: { operation, threadId: 'chat', archived: false } });
  expect(await execute('list')).toMatchObject({ data: { data: [{ id: 'chat', cwd: '/canonical' }] } });
  expect(await execute('read')).toMatchObject({ data: { thread: { cwd: '/canonical' } } });
  expect(operations.prepareEvent({ method: 'thread/started', params: { thread } }))
    .toMatchObject({ params: { threadId: 'chat', reason: 'thread/started' } });
  expect(await execute('syncHistory')).toMatchObject({ data: { patch: { set: { cwd: '/canonical' } } } });
  await execute('resume'); await execute('send');
  for (const operation of ['resume', 'send']) expect(guiApi.request).toHaveBeenCalledWith(
    expect.objectContaining({ operation, threadId: 'chat', cwd: '/canonical' }));
});

it('moves a nonselected chat into its destination project and publishes both placement changes together', async () => {
  await controller.groups.mutate({ action: 'create', group: { id: 'group', name: 'Group', parentId: null } });
  await controller.groups.mutate({ action: 'assign', targets: [{ kind: 'thread', id: 'chat' }], groupId: 'group' });
  const before = controller.getSnapshot();
  const publish = vi.fn();
  const unsubscribe = guiSidebar.subscribe(publish);
  const result = await selectRemoteProject({ cwd: '/canonical', threadId: 'chat', removeFromGroup: true });
  unsubscribe();
  expect(result).toMatchObject({ cwd: '/canonical', sidebar: {
    threads: { chat: { cwd: '/canonical' } }, grouping: { threads: {} },
  } });
  const moved = publish.mock.calls.map(([snapshot]) => snapshot)
    .filter(snapshot => snapshot.threads.chat.cwd === '/canonical');
  expect(moved.length).toBeGreaterThan(0);
  expect(moved.every(snapshot => !Object.hasOwn(snapshot.grouping.threads, 'chat'))).toBe(true);
  expect(controller.getSnapshot()).toMatchObject({ selected: before.selected, settings: before.settings,
    conversations: { chat: { thread: { cwd: '/canonical' } } } });
  expect(initialState()).toMatchObject({ projectOverrides: { chat: '/canonical' }, grouping: { threads: {} } });
});

it('uses the same validated move locally, preserving the draft and keeping grouping when validation fails', async () => {
  Object.assign(controller.getSnapshot(), { selected: null, settings: { cwd: '/draft' } });
  await controller.groups.mutate({ action: 'create', group: { id: 'group', name: 'Group', parentId: null } });
  await controller.groups.mutate({ action: 'assign', targets: [{ kind: 'thread', id: 'chat' }], groupId: 'group' });
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error('missing directory'));
  await expect(controller.moveThreadToProject('chat', '/missing')).rejects.toThrow('missing directory');
  expect(controller.getSnapshot()).toMatchObject({ grouping: { threads: { chat: 'group' } }, projectOverrides: {} });
  await controller.moveThreadToProject('chat', '/canonical');
  expect(controller.getSnapshot()).toMatchObject({ selected: null, settings: { cwd: '/draft' },
    grouping: { threads: {} }, projectOverrides: { chat: '/canonical' } });
});

it('rejects malformed move options and preserves placement when a task starts during validation', async () => {
  await expect(selectRemoteProject({ cwd: '/new', removeFromGroup: true })).rejects.toThrow('有效');
  await expect(selectRemoteProject({ cwd: '/new', threadId: 'chat', removeFromGroup: 'yes' })).rejects.toThrow('有效');
  await controller.groups.mutate({ action: 'create', group: { id: 'group', name: 'Group', parentId: null } });
  await controller.groups.mutate({ action: 'assign', targets: [{ kind: 'thread', id: 'chat' }], groupId: 'group' });
  vi.mocked(guiApi.request).mockImplementation(async body => body.operation === 'read'
    ? { thread: { ...thread, turns: [{ id: 'running', status: 'inProgress', items: [] }] } }
    : { directory: '/canonical', entries: [] });
  await expect(controller.moveThreadToProject('chat', '/canonical')).rejects.toThrow('等待');
  expect(controller.getSnapshot()).toMatchObject({ grouping: { threads: { chat: 'group' } }, projectOverrides: {} });
});
