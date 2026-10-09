// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../pages/codexGui/api';
import { getGuiController } from '../pages/codexGui/session';
import { GuiThreadTitles } from '../pages/codexGui/threadTitles';
import { fetchCloudTitleSettings } from '../api/cloudTitleSettings';
import type { GuiEvent, Thread } from '../pages/codexGui/types';
import { applyChatEvent } from '../../../../shared/remote-chat/client/events';
import { initialChatState } from '../../../../shared/remote-chat/client/types';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';

vi.mock('../pages/codexGui/composerBridge', () => ({ guiComposer: {
  validateSend: async () => ({ model: 'model', effort: 'high', access: 'workspace-write' }),
} }));
vi.mock('../pages/codexGui/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: vi.fn() }));
vi.mock('../api/cloudTitleSettings', () => ({ fetchCloudTitleSettings: vi.fn() }));

const thread: Thread = { id: 'phone', cwd: '', preview: '检查手机聊天标题', updatedAt: 1, turns: [] };
const receive = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchCloudTitleSettings).mockResolvedValue({ model: 'configured-title-model', effort: 'medium' });
  const titles = new GuiThreadTitles({ active: () => true, currentName: () => undefined, receive });
  vi.mocked(getGuiController).mockReturnValue({ titles,
    getSnapshot: () => ({ projectOverrides: {} }) } as ReturnType<typeof getGuiController>);
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === 'start' || request.operation === 'resume') return { thread: structuredClone(thread) };
    if (request.operation === 'generateTitle') return { title: '手机聊天标题修复' };
    return {};
  });
});

function request(host: ChatOperations, body: Record<string, unknown>, id: string, mode: ConnectionMode = 'relay') {
  return host.execute({ kind: 'request', method: 'request', id, body }, mode);
}

it.each(['direct', 'relay'] as const)('names the first remote send once over %s with the PC chat closed', async (mode) => {
  const host = new ChatOperations();
  await request(host, { operation: 'start' }, 'start', mode);
  const body = { operation: 'send', threadId: thread.id, text: thread.preview };
  expect((await request(host, body, 'send', mode)).error).toBeUndefined();
  await request(host, body, 'send', mode);
  await request(host, body, 'next-send', mode);
  await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
  const calls = vi.mocked(guiApi.request).mock.calls.filter(([value]) => value.operation === 'generateTitle');
  expect(calls).toEqual([[{ operation: 'generateTitle', threadId: thread.id, prompt: thread.preview,
    settings: { model: 'configured-title-model', effort: 'medium' } }]]);
  expect(fetchCloudTitleSettings).toHaveBeenCalledTimes(1);
});

it('keeps sends and polling responsive while configuration and title generation are pending', async () => {
  let configure!: (value: { model: string; effort: 'low' }) => void;
  vi.mocked(fetchCloudTitleSettings).mockReturnValue(new Promise((resolve) => { configure = resolve; }));
  const host = new ChatOperations();
  await host.execute({ kind: 'request', method: 'connect', id: 'connect' });
  await request(host, { operation: 'start' }, 'start');
  expect(await request(host, { operation: 'send', threadId: thread.id, text: thread.preview }, 'send'))
    .toMatchObject({ data: {} });
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'generateTitle' }));
  let finish!: (value: { title: string }) => void;
  vi.mocked(guiApi.request).mockImplementation(async (value) => value.operation === 'generateTitle'
    ? new Promise((resolve) => { finish = resolve; }) : { data: [], nextCursor: null });
  configure({ model: 'remote-model', effort: 'low' });
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect((await request(host, { operation: 'list' }, 'poll')).error).toBeUndefined();
  expect(receive).not.toHaveBeenCalled();
  finish({ title: '手机聊天标题修复' });
  await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
});

it.each([
  { ...thread, name: '手动命名' },
  { ...thread, turns: [{ id: 'old', status: 'completed', items: [] }] },
])('preserves existing and manual titles on resume: %j', async (existing) => {
  vi.mocked(guiApi.request).mockResolvedValue({ thread: existing });
  const host = new ChatOperations();
  await request(host, { operation: 'resume', threadId: thread.id }, 'resume');
  await request(host, { operation: 'send', threadId: thread.id, text: '继续' }, 'send');
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'generateTitle' }));
});

it('waits for a successful send before naming a resumed empty thread', async () => {
  const host = new ChatOperations();
  await request(host, { operation: 'resume', threadId: thread.id }, 'resume');
  const body = { operation: 'send', threadId: thread.id, text: thread.preview };
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error('send failed'));
  expect((await request(host, body, 'failed')).error).toBe('send failed');
  expect(fetchCloudTitleSettings).not.toHaveBeenCalled();
  await request(host, body, 'retry');
  await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
});

it('applies title notifications immediately to the shared native and Web thread views', () => {
  const event: GuiEvent = { method: 'thread/name/updated',
    params: { threadId: thread.id, threadName: '手机聊天标题修复' } };
  const other = { ...thread, id: 'other', name: '另一个聊天' };
  const state = { ...initialChatState(), threads: [thread, other], selected: thread };
  const updated = applyChatEvent(state, event);
  expect(updated.threads[0]).toMatchObject({ name: '手机聊天标题修复', preview: thread.preview });
  expect(updated.selected?.name).toBe('手机聊天标题修复');
  expect(updated.threads[1]).toBe(other);
});
