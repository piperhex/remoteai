// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from '../pages/codexGui/controller';
import { getGuiController } from '../pages/codexGui/session';
import { guiApi } from '../pages/codexGui/api';
import { saveProject } from '../pages/codexGui/projectCatalog';
import { initialState } from '../pages/codexGui/preferences';
import { guiComposer } from '../pages/codexGui/composerBridge';
import type { Thread } from '../pages/codexGui/types';
import { ChatOperations } from './operations';
import { readRemoteProjects, selectRemoteProject } from './projects';

vi.mock('../pages/codexGui/api', () => ({ guiApi: { request: vi.fn() } }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: vi.fn() }));
vi.mock('../pages/codexGui/composerBridge', () => ({ guiComposer: { validateSend: vi.fn() } }));
const thread: Thread = { id: 'chat', cwd: '/old', preview: '', updatedAt: 1, turns: [] };
let controller: GuiController;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); controller = new GuiController();
  vi.mocked(getGuiController).mockReturnValue(controller);
  Object.assign(controller.getSnapshot(), { connection: 'ready', threads: [thread], selected: 'local',
    projects: ['/recent'] });
  vi.mocked(guiComposer.validateSend).mockResolvedValue({ model: 'model', effort: 'high', access: 'workspace-write' });
  vi.mocked(guiApi.request).mockImplementation(async body => {
    if (body.operation === 'projectDirectories') return { directory: '/canonical', entries: [] };
    if (body.operation === 'list') return { data: [thread], nextCursor: null };
    return { thread };
  });
});
afterEach(() => { controller.dispose(); vi.restoreAllMocks(); });

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
