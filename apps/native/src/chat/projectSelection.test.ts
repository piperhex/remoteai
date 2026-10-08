import { expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { directoryProject } from '../../../../shared/remote-chat/projectDirectories';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';

async function setup() {
  const thread = { id: 'chosen', cwd: 'F:/projects/demo', preview: '', updatedAt: 1, turns: [] };
  const request = vi.fn(async (_method: string, body?: { operation?: string }) => {
    if (_method === 'connect') return [];
    if (body?.operation === 'models') return { data: [{ id: 'model', model: 'model', displayName: 'Model',
      isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] }], nextCursor: null };
    if (body?.operation === 'start' || body?.operation === 'read') return { thread };
    return { data: [], nextCursor: null };
  });
  let events: ConnectionEvents | undefined;
  const controller = new ChatController((callbacks) => {
    events = callbacks;
    return {
      request: async <T>(method: string, body?: unknown) =>
        await request(method, body as { operation?: string } | undefined) as T,
      start() { callbacks.mode('direct'); callbacks.ready(); }, stop() {},
    };
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  return { controller, request, events, thread };
}

it('uses the selected folder for the first message without creating a chat while choosing', async () => {
  const { controller, request } = await setup();
  try {
    const settings = controller.snapshot().settings;
    controller.chooseDraftProject(directoryProject('F:/projects/demo'));
    expect(controller.snapshot()).toMatchObject({ selected: null, draftProject: { label: 'demo' }, settings });
    expect(request.mock.calls.some(([, body]) => body?.operation === 'start')).toBe(false);
    await controller.send({ text: 'draft kept', access: 'workspace-write' });
    expect(request).toHaveBeenCalledWith('request', expect.objectContaining({ operation: 'start', cwd: 'F:/projects/demo' }));
    controller.chooseDraftProject(directoryProject('F:/other'));
    expect(controller.snapshot().draftProject).toBeNull();
  } finally { controller.stop(); }
});

it('does not change the project while disconnected or create a project from an empty path', async () => {
  const { controller, events } = await setup();
  try {
    controller.chooseDraftProject(directoryProject(''));
    expect(controller.snapshot().draftProject).toBeNull();
    events?.mode('offline');
    controller.chooseDraftProject(directoryProject('F:/other'));
    expect(controller.snapshot().draftProject).toBeNull();
  } finally { controller.stop(); }
});

it('requests directory browsing without changing the draft or sidebar', async () => {
  const { controller, request } = await setup();
  try {
    const snapshot = controller.snapshot();
    await controller.loadProjectDirectories('F:/projects');
    expect(request).toHaveBeenLastCalledWith('request', { operation: 'projectDirectories', directory: 'F:/projects' });
    expect(controller.snapshot()).toBe(snapshot);
  } finally { controller.stop(); }
});

it('labels Windows, Unix and root folders without changing their paths', () => {
  expect(directoryProject('F:\\projects\\demo\\')).toEqual({ cwd: 'F:\\projects\\demo\\', label: 'demo' });
  expect(directoryProject('/work/demo')).toEqual({ cwd: '/work/demo', label: 'demo' });
  expect(directoryProject('/')).toEqual({ cwd: '/', label: '/' });
  expect(directoryProject('F:/')).toEqual({ cwd: 'F:/', label: 'F:' });
});
