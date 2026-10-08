// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ChatConnection, ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { compactUnavailableReason } from '../../../../shared/remote-chat/client/composerCommands';
import type { GuiEvent, Skill, Thread } from '../pages/codexGui/types';
import { guiApi } from '../pages/codexGui/api';
import { ChatOperations } from './operations';
import { remoteQueue } from './queue';

vi.mock('../pages/codexGui/composerBridge', () => ({ guiComposer: {
  validateSend: async () => ({ model: 'model', effort: 'high', access: 'workspace-write' }),
} }));
vi.mock('../pages/codexGui/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
const skill: Skill = { name: 'review', path: 'C:/skills/review/SKILL.md', description: '检查代码', enabled: true };
const thread: Thread = { id: 'chat', preview: '', cwd: 'C:/project', updatedAt: 1, turns: [] };
const models = [{ id: 'model', model: 'model', displayName: 'Model', isDefault: true,
  defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }];
let controller: ChatController;
let handlers: ConnectionEvents;
let remote: Thread;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(remoteQueue, 'request').mockResolvedValue({ revision: 0, threads: {} });
  remote = structuredClone(thread);
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (['read', 'resume', 'start'].includes(request.operation)) return { thread: structuredClone(remote) };
    if (request.operation === 'skills') return { data: [{ skills: [{ ...skill, iconUrl: 'x'.repeat(9 * 1024 * 1024) }],
      errors: [] }] };
    return { data: [], nextCursor: null };
  });
  const operations = new ChatOperations();
  let serial = 0;
  controller = new ChatController((events) => {
    handlers = events;
    return { start() { events.mode('relay'); events.ready(); }, stop() {},
      async request(method, body) {
        if ((body as { operation?: string })?.operation === 'models') return { data: models, nextCursor: null };
        const response = await operations.execute({ kind: 'request', id: String(++serial), method, body });
        if (response.error) throw new Error(response.error);
        return response.data;
      },
    } as ChatConnection;
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
});
afterEach(() => controller.stop());

it('loads project skills through the PC allowlist without transferring large icons', async () => {
  const result = await controller.loadSkills(thread.cwd);
  expect(result.data[0].skills).toMatchObject([skill]);
  expect(JSON.stringify(result).length).toBeLessThan(1000);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: 'skills', cwd: thread.cwd });
});

it.each(['new', 'existing', 'running'])('delivers structured skill references to the PC in a %s chat', async (mode) => {
  if (mode === 'running') remote.turns = [{ id: 'turn', status: 'inProgress', items: [] }];
  if (mode !== 'new') await controller.select(remote);
  const skills = [{ name: skill.name, path: skill.path }];
  expect(await controller.send({ text: '$review 检查', images: [], skills, access: 'workspace-write' })).toBe(true);
  const expected = expect.objectContaining({
    operation: mode === 'new' ? 'send' : 'queueEnqueue', skills,
  });
  if (mode === 'new') expect(guiApi.request).toHaveBeenCalledWith(expected);
  else expect(remoteQueue.request).toHaveBeenCalledWith(expected, 'relay');
});

it('resumes and checks the PC thread before compacting, and waits for completion before sending again', async () => {
  expect(compactUnavailableReason(controller.snapshot())).toContain('开始对话');
  await controller.select(remote);
  vi.mocked(guiApi.request).mockClear();
  expect(await controller.compact()).toBe(true);
  expect(vi.mocked(guiApi.request).mock.calls.map(([request]) => request.operation))
    .toEqual(['resume', 'read', 'compact']);
  expect(controller.snapshot().compacting).toBe(thread.id);
  expect(await controller.compact()).toBe(false);
  expect(await controller.send({ text: 'wait', access: 'workspace-write' })).toBe(false);
  handlers.event({ method: 'thread/compacted', params: { threadId: thread.id } } satisfies GuiEvent);
  expect(controller.snapshot().compacting).toBeUndefined();
});

it('does not compact when the PC started a turn before resume completed', async () => {
  await controller.select(remote);
  remote.turns = [{ id: 'running', status: 'inProgress', items: [] }];
  expect(await controller.compact()).toBe(false);
  expect(controller.snapshot().compacting).toBeUndefined();
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'compact' }));
});

it('rejects a catalog response from a disconnected session', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const request = controller.loadSkills(thread.cwd);
  handlers.mode('offline');
  finish({ data: [] });
  await expect(request).rejects.toThrow('连接');
});

it('keeps an in-flight catalog usable when the same PC switches from relay to direct transport', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const request = controller.loadSkills(thread.cwd);
  handlers.mode('direct');
  finish({ data: [{ skills: [skill], errors: [] }] });
  expect((await request).data[0].skills).toMatchObject([skill]);
});

it('releases the compaction guard after an error or disconnect', async () => {
  await controller.select(remote);
  expect(await controller.compact()).toBe(true);
  handlers.event({ method: 'error', params: { threadId: thread.id, error: { message: '未完成' } } });
  expect(controller.snapshot().compacting).toBeUndefined();
  expect(await controller.compact()).toBe(true);
  handlers.mode('offline');
  expect(controller.snapshot().compacting).toBeUndefined();
});
