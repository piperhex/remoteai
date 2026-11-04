// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from '../pages/codexGui/controller';
import { getGuiController } from '../pages/codexGui/session';
import { guiApi } from '../../../../shared/conversation/api';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';
import { initialState } from '../pages/codexGui/preferences';
import { ChatOperations } from './operations';
import { changeRemoteProject } from './projectActions';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: vi.fn() }));
let controller: GuiController;
let detach: () => void;
const thread = { id: 'current', cwd: '/project', name: 'Keep me', preview: '', updatedAt: 1 };

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); controller = new GuiController();
  vi.mocked(getGuiController).mockReturnValue(controller);
  Object.assign(controller.getSnapshot(), { connection: 'ready', threads: [thread], selected: 'current',
    projects: ['/project'], pins: ['current'] });
  detach = guiSidebar.attach(controller);
  vi.mocked(guiApi.request).mockImplementation(async body => {
    if (body.operation !== 'list') throw new Error('Unexpected operation');
    if (body.archived) return { data: [{ ...thread, id: 'archived' }], nextCursor: null };
    return body.cursor ? { data: [{ ...thread, id: 'older' }], nextCursor: null }
      : { data: [thread], nextCursor: 'next' };
  });
});
afterEach(() => { detach(); controller.dispose(); vi.restoreAllMocks(); });

it('routes idempotent project pins and publishes host persistence without selecting a conversation', async () => {
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, method: 'request' as const, id: 'pin',
    body: { operation: 'guiProjectPin', cwd: '/project', pinned: true } };
  expect(await operations.execute(request)).toMatchObject({ data: { pinnedProjects: ['/project'] } });
  expect(await operations.execute({ ...request, id: 'retry' })).toMatchObject({ data: { pinnedProjects: ['/project'] } });
  expect(initialState().pinnedProjects).toEqual(['/project']);
  expect(controller.getSnapshot().selected).toBe('current');
  expect(await changeRemoteProject({ ...request.body, pinned: false })).toMatchObject({ pinnedProjects: [] });
});

it('removes a project through the host, preserving current, older and archived conversations', async () => {
  controller.projectActions.pin('/project');
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, method: 'request' as const, id: 'remove',
    body: { operation: 'guiProjectRemove', cwd: '/project' } };
  const result = await operations.execute(request);
  expect(result).toMatchObject({ data: { pinnedProjects: [], pins: [], threads: { current: { cwd: '' } } } });
  expect(initialState().projectOverrides).toEqual({ current: '', older: '', archived: '' });
  expect(controller.getSnapshot()).toMatchObject({ selected: 'current', threads: [{ id: 'current', cwd: '' }],
    removingProject: undefined, projects: [] });
  expect(guiApi.request).toHaveBeenCalledTimes(3);
  await operations.execute(request);
  expect(guiApi.request).toHaveBeenCalledTimes(3);
});

it('preserves project membership on failure and allows retry', async () => {
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error('offline'));
  await expect(changeRemoteProject({ operation: 'guiProjectRemove', cwd: '/project' }))
    .rejects.toThrow('client.conversation.couldNotRemoveTheProjectPleaseTryAgainYourConversations');
  expect(controller.getSnapshot()).toMatchObject({ projects: ['/project'], projectOverrides: {},
    removingProject: undefined });
  await expect(changeRemoteProject({ operation: 'guiProjectRemove', cwd: '/project' })).resolves.toBeTruthy();
});

it.each([{ cwd: '' }, { cwd: 5 }, { cwd: '/project', pinned: 'true' }, { cwd: 'x'.repeat(4097) }])(
  'rejects malformed project mutations: %j', async body => {
    await expect(changeRemoteProject({ operation: 'guiProjectPin', pinned: true, ...body }))
      .rejects.toThrow('client.workspaceActions.chooseAValidProjectFolder');
    expect(initialState().pinnedProjects).toEqual([]);
  });

it.each([{ sending: true }, { workspaceBusy: true }, { removingProject: '/other' }])(
  'rejects changes while the host is busy: %j', async patch => {
    Object.assign(controller.getSnapshot(), patch);
    await expect(changeRemoteProject({ operation: 'guiProjectRemove', cwd: '/project' }))
      .rejects.toThrow('client.workspaceActions.theProjectIsBusyPleaseTryAgainShortly');
    expect(guiApi.request).not.toHaveBeenCalled();
  });
