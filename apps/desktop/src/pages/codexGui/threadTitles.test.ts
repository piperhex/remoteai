// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { guiApi } from '../../../../../shared/conversation/api';
import { GuiThreadTitles } from './threadTitles';
import { reduceEvent, conversation } from '../../../../../shared/conversation/events';
import { initialState } from './preferences';
import type { Thread } from '../../../../../shared/conversation/types';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
vi.mock('../../api/cloudTitleSettings', () => ({ fetchCloudTitleSettings: async () => {
  throw new Error('offline');
} }));
const thread: Thread = { id: 'one', cwd: '', preview: '原始消息', updatedAt: 1, turns: [] };
const receive = vi.fn();
const host = { active: () => true, currentName: () => undefined, receive };
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });

it('generates once without waiting for the answer and uses the default model and effort', async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ title: '熊骑车 SVG 动画' });
  const titles = new GuiThreadTitles(host);
  await Promise.all([titles.generate(thread, '画熊骑车'), titles.generate(thread, '画熊骑车')]);
  expect(guiApi.request).toHaveBeenCalledExactlyOnceWith({ operation: 'generateTitle', threadId: 'one',
    prompt: '画熊骑车', settings: { model: 'gpt-5.6-luna', effort: 'low' } });
  expect(receive).toHaveBeenCalledWith({ method: 'thread/name/updated',
    params: { threadId: 'one', threadName: '熊骑车 SVG 动画' } });
});

it('leaves the preview untouched when generation fails', async () => {
  vi.mocked(guiApi.request).mockRejectedValue(new Error('timeout'));
  const titles = new GuiThreadTitles(host);
  await titles.generate(thread, 'hello');
  expect(receive).not.toHaveBeenCalled();
  expect(thread.preview).toBe('原始消息');
});

it('does not rename existing conversations or manually named threads', async () => {
  const titles = new GuiThreadTitles(host);
  await titles.generate({ ...thread, name: '手动标题' }, 'hello');
  await titles.generate({ ...thread, turns: [{ id: 'old', status: 'completed', items: [] }] }, 'hello');
  expect(guiApi.request).not.toHaveBeenCalled();
});

it('ignores a result after the GUI session is disposed', async () => {
  let active = true;
  vi.mocked(guiApi.request).mockImplementation(async () => { active = false; return { title: 'title' }; });
  await new GuiThreadTitles({ ...host, active: () => active }).generate(thread, 'hello');
  expect(receive).not.toHaveBeenCalled();
});

it('does not overwrite a newer manual title when an older generation response arrives', async () => {
  let name: string | undefined;
  vi.mocked(guiApi.request).mockImplementation(async () => { name = '手动标题'; return { title: '自动标题' }; });
  await new GuiThreadTitles({ ...host, currentName: () => name }).generate(thread, 'hello');
  expect(receive).not.toHaveBeenCalled();
});

it('updates both the sidebar and open conversation on a title notification', () => {
  const state = { ...initialState(), threads: [thread], conversations: { one: conversation(thread) } };
  const next = reduceEvent(state, { method: 'thread/name/updated', params: { threadId: 'one', threadName: '简短标题' } });
  expect(next.threads[0].name).toBe('简短标题');
  expect(next.conversations.one.thread.name).toBe('简短标题');
  expect(next.conversations.one.thread.preview).toBe('原始消息');
});
