import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from './controller';
import type { AuthSession } from '../types';
import type { Thread } from './types';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { COMPOSER_EVENT, type ComposerSnapshot } from '../../../../shared/remote-chat/composer';
import { historyDelta, type HistoryVersion } from '../../../../shared/remote-chat/historySync';
import { sliceHistory, type HistoryWindow } from '../../../../shared/remote-chat/historyPage';

const mocks = vi.hoisted(() => ({ request: vi.fn(), events: null as ConnectionEvents | null }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: {} }));
vi.mock('../downloads/previews', () => ({ createPreviewDownloads: () => ({ dispose: vi.fn() }) }));
vi.mock('../downloads/iosPreviews', () => ({ createIosPreviewDownloads: vi.fn() }));
vi.mock('../downloads/manager', () => ({ downloadOwner: () => 'test-owner' }));
vi.mock('./connection', () => ({ MobileChatConnection: class {
  constructor(events: ConnectionEvents) { mocks.events = events; }
  start() { mocks.events!.mode('relay'); mocks.events!.ready(); }
  stop() {}
  async request(method: string, body?: { operation: string; known?: HistoryVersion }) {
    const result = await mocks.request(method, body);
    return body?.operation === 'syncHistory' && result?.thread ? historyDelta(result.thread, body.known) : result;
  }
} }));
const session: AuthSession = { baseUrl: 'https://test', accessToken: 'test', refreshToken: 'test', email: 'test' };
const thread: Thread = { id: 'chat', preview: '', cwd: '/project', updatedAt: 1, turns: [] };
const models = [{ id: 'astra', model: 'astra', displayName: 'Astra', isDefault: true,
  defaultReasoningEffort: 'xhigh', supportedReasoningEfforts: ['xhigh', 'ultra'].map(reasoningEffort =>
    ({ reasoningEffort, description: '' })) }];
beforeEach(() => { mocks.request.mockReset(); });
afterEach(() => vi.useRealTimers());

async function connectedController() {
  mocks.request.mockImplementation(async (method, body) => method === 'connect' ? []
    : { data: body?.operation === 'models' ? models : [], nextCursor: null });
  const controller = new ChatController(session, 'computer');
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  mocks.request.mockReset();
  return controller;
}

describe('mobile chat actions', () => {
  it.each([true, false])('clears upload progress after sending finishes (success=%s)', async (success) => {
    const controller = await connectedController();
    mocks.request.mockResolvedValue({ thread });
    await controller.select(thread);
    let finish: () => void = () => {};
    mocks.request.mockImplementation(() => new Promise((resolve, reject) => {
      finish = () => success ? resolve(undefined) : reject(new Error('上传失败'));
    }));
    const sending = controller.send({ text: 'file', access: 'read-only',
      attachments: [{ kind: 'file', name: 'test.txt', path: '', data: 'YWJj' }] });
    expect(controller.snapshot().upload).toEqual({ phase: 'preparing', percent: 0 });
    mocks.events?.upload?.({ phase: 'uploading', percent: 45 });
    expect(controller.snapshot().upload?.percent).toBe(45);
    expect(await controller.send({ text: 'duplicate', access: 'read-only' })).toBe(false);
    mocks.events?.upload?.({ phase: 'confirming', percent: 100 });
    expect(controller.snapshot().sending).toBe(true);
    finish();
    expect(await sending).toBe(success);
    expect(controller.snapshot().upload).toBeUndefined();
    expect(controller.snapshot().sending).toBe(false);
    mocks.events?.upload?.({ phase: 'uploading', percent: 60 });
    expect(controller.snapshot().upload).toBeUndefined();
    controller.stop();
  });

  it('reopens expanded history at the latest page and can still load earlier messages', async () => {
    const controller = await connectedController();
    const history: Thread = { ...thread, turns: [{ id: 'long-turn', status: 'completed',
      items: Array.from({ length: 60 }, (_, index) => ({
        id: `message-${index}`, type: 'agentMessage', text: 'Reply',
      })) }] };
    const other = { ...thread, id: 'other' };
    mocks.request.mockImplementation(async (_method, body: {
      operation: string; threadId: string; window?: HistoryWindow; known?: HistoryVersion;
    }) => {
      if (body.operation !== 'syncHistory') return { data: [], nextCursor: null };
      const page = sliceHistory(body.threadId === thread.id ? history : other, body.window);
      return { ...historyDelta(page.thread, body.known), page: page.page };
    });
    await controller.select(thread);
    await controller.loadOlder();
    await controller.loadOlder();
    expect(controller.snapshot().selected?.turns?.[0].items).toHaveLength(30);
    for (let visit = 0; visit < 12; visit++) {
      await controller.select(other);
      const selecting = controller.select(thread);
      expect(controller.snapshot().selected?.turns?.[0].items).toHaveLength(10);
      expect(controller.snapshot().historyHasMore).toBe(true);
      await selecting;
    }
    await controller.loadOlder();
    expect(controller.snapshot().selected?.turns?.[0].items).toHaveLength(20);
    expect(controller.snapshot().selected?.turns?.[0].items[0].id).toBe('message-40');
    controller.stop();
  });

  it('releases the composer after enqueue acknowledgement while history is still loading', async () => {
    const controller = await connectedController();
    mocks.request.mockResolvedValue({ thread });
    await controller.select(thread);
    let finishHistory!: (value: unknown) => void;
    mocks.request.mockImplementation((_method, body) => body?.operation === 'queueEnqueue'
      ? Promise.resolve({ revision: 1, threads: { chat: [
        { id: 'pending', text: 'next', imageCount: 0, attachmentCount: 0, busy: false },
      ] } }) : new Promise((resolve) => { finishHistory = resolve; }));
    expect(await controller.send({ text: 'next', access: 'workspace-write' })).toBe(true);
    expect(controller.snapshot().sending).toBe(false);
    expect(controller.snapshot().historyLoading).toBe(true);
    expect(controller.snapshot().queue.threads.chat[0].text).toBe('next');
    finishHistory({ thread });
    await vi.waitFor(() => expect(controller.snapshot().historyLoading).toBe(false));
    controller.stop();
  });
  it('keeps independent search results and failures out of the sidebar state', async () => {
    const controller = await connectedController();
    mocks.request.mockResolvedValueOnce({ data: [thread], nextCursor: 'sidebar-next' });
    await controller.list();
    const sidebar = controller.snapshot();
    const result = { data: [{ ...thread, id: 'match' }], nextCursor: 'search-next' };
    mocks.request.mockResolvedValueOnce(result);
    expect(await controller.searchThreads({ search: 'match', archived: true, cursor: 'search-page' })).toEqual(result);
    expect(mocks.request).toHaveBeenLastCalledWith('request', {
      operation: 'list', search: 'match', archived: true, cursor: 'search-page',
    });
    expect(controller.snapshot()).toBe(sidebar);
    mocks.request.mockRejectedValueOnce(new Error('Search unavailable'));
    await expect(controller.searchThreads({ search: 'other', archived: false })).rejects.toThrow('Search unavailable');
    expect(controller.snapshot()).toBe(sidebar);
    controller.stop();
  });

  it('sends photos without text when creating a chat', async () => {
    const controller = await connectedController();
    mocks.request.mockResolvedValue({ thread });
    const images = ['data:image/jpeg;base64,/9j/photo'];
    expect(await controller.send({ text: '', images, access: 'workspace-write' })).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('request', {
      operation: 'send', threadId: 'chat', text: '', images, access: 'workspace-write',
      model: 'astra', effort: 'xhigh',
    });
  });

  it('includes photos when supplementing a running turn', async () => {
    const controller = await connectedController();
    const running = { ...thread, turns: [{ id: 'turn', status: 'inProgress', items: [] }] };
    mocks.request.mockResolvedValue({ thread: running });
    await controller.select(running);
    const images = ['data:image/jpeg;base64,/9j/photo'];
    expect(await controller.send({ text: '看这张照片', images, access: 'workspace-write' })).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('request', {
      operation: 'queueEnqueue', threadId: 'chat', text: '看这张照片', images, access: 'workspace-write',
      model: 'astra', effort: 'xhigh',
    });
  });

  it('delivers completion events for unselected chats and cleans up event subscriptions', async () => {
    const controller = await connectedController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribeEvents(listener);
    controller.setViewing(false);
    const event = { method: 'turn/completed', params: {
      threadId: 'other-chat', turn: { id: 'done', status: 'completed', items: [] },
    } };
    mocks.events!.event(event);
    expect(listener).toHaveBeenCalledWith(event);
    expect(mocks.request).not.toHaveBeenCalled();
    unsubscribe();
    mocks.events!.event(event);
    expect(listener).toHaveBeenCalledTimes(1);
  });


  it.each(['new', 'existing', 'running'])('sends image-only input in a %s chat', async (mode) => {
    const controller = await connectedController();
    const selected = mode === 'running'
      ? { ...thread, turns: [{ id: 'turn', status: 'inProgress', items: [] }] } : thread;
    mocks.request.mockResolvedValue({ thread: selected });
    if (mode !== 'new') await controller.select(selected);
    const images = ['data:image/jpeg;base64,aW1hZ2U='];
    expect(await controller.send({ text: '', images, access: 'workspace-write' })).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('request', expect.objectContaining({
      operation: mode === 'new' ? 'send' : 'queueEnqueue', text: '', images,
    }));
  });

  it('rejects invalid, excessive and oversized images before creating a PC thread', async () => {
    const controller = await connectedController();
    for (const images of [
      ['file:///phone/photo.jpg'],
      Array(9).fill('data:image/jpeg;base64,aW1hZ2U='),
      ['data:image/jpeg;base64,' + 'a'.repeat(6 * 1024 * 1024)],
    ]) {
      expect(await controller.send({ text: '', images, access: 'workspace-write' })).toBe(false);
      expect(controller.snapshot().error).not.toBe('');
    }
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('creates an active chat when starting from archived search results', async () => {
    const controller = await connectedController();
    mocks.request.mockResolvedValueOnce({ data: [], nextCursor: null }).mockResolvedValue({ thread });
    await controller.list({ archived: true, search: 'old chat' });
    expect(controller.snapshot().archived).toBe(true);
    expect(await controller.send({ text: 'new task', access: 'workspace-write' })).toBe(true);
    expect(controller.snapshot()).toMatchObject({ archived: false, search: '', selected: thread });
    expect(mocks.request.mock.calls.map(([, body]) => body.operation)).toEqual(['list', 'start', 'send', 'syncHistory']);
  });

  it('lets the PC queue decide when to send an existing conversation message', async () => {
    const controller = await connectedController();
    mocks.request.mockResolvedValue({ thread });
    await controller.select(thread);
    expect(await controller.send({ text: 'continue', access: 'workspace-write' })).toBe(true);
    expect(mocks.request).not.toHaveBeenCalledWith('request', expect.objectContaining({ operation: 'resume' }));
    expect(mocks.request).toHaveBeenCalledWith('request', {
      operation: 'queueEnqueue', threadId: 'chat', text: 'continue', access: 'workspace-write', images: [],
      model: 'astra', effort: 'xhigh',
    });
  });

  it('starts in the chosen project and clears it before a later general chat', async () => {
    const controller = await connectedController();
    mocks.request.mockImplementation(async (_method, body) => body?.operation === 'list'
      ? { data: [thread], nextCursor: null } : { thread });
    await controller.select(thread);
    const project = { cwd: '/other-project', label: '另一个项目' };
    controller.back(project);
    expect(controller.snapshot()).toMatchObject({ selected: null, draftProject: project });
    expect(await controller.send({ text: 'project task', access: 'workspace-write' })).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('request', expect.objectContaining({
      operation: 'start', cwd: project.cwd,
    }));
    expect(controller.snapshot().draftProject).toBeNull();
    expect(thread.cwd).toBe('/project');
    controller.back(project);
    controller.back();
    mocks.request.mockClear();
    expect(await controller.send({ text: 'general task', access: 'workspace-write' })).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('request', expect.objectContaining({
      operation: 'start', cwd: undefined,
    }));
    controller.stop();
  });

  it('keeps an existing chat in its own project after leaving a project draft', async () => {
    const controller = await connectedController();
    mocks.request.mockImplementation(async (_method, body) => body?.operation === 'list'
      ? { data: [thread], nextCursor: null } : { thread });
    controller.back({ cwd: '/other-project', label: '另一个项目' });
    await controller.select(thread);
    expect(controller.snapshot().draftProject).toBeNull();
    expect(await controller.send({ text: 'continue here', access: 'workspace-write' })).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('request', {
      operation: 'queueEnqueue', threadId: thread.id, text: 'continue here', images: [], access: 'workspace-write',
      model: 'astra', effort: 'xhigh',
    });
    expect(mocks.request.mock.calls.some(([, body]) => body.operation === 'start')).toBe(false);
    controller.stop();
  });

  it('queues a supplement on the PC and stops the original turn', async () => {
    const controller = await connectedController();
    const running = { ...thread, turns: [{ id: 'turn', status: 'inProgress', items: [] }] };
    mocks.request.mockResolvedValue({ thread: running });
    await controller.select(running);
    await controller.send({ text: 'add detail', access: 'workspace-write' });
    expect(mocks.request).toHaveBeenCalledWith('request', {
      operation: 'queueEnqueue', threadId: 'chat', text: 'add detail', images: [], access: 'workspace-write',
      model: 'astra', effort: 'xhigh',
    });
    await controller.interrupt();
    expect(mocks.request).toHaveBeenCalledWith('request', { operation: 'interrupt', threadId: 'chat', turnId: 'turn' });
  });

  it('keeps the newer selection when an older history request finishes later', async () => {
    const controller = await connectedController();
    let completeFirst: (result: { thread: Thread }) => void = () => undefined;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { completeFirst = resolve; }));
    const first = controller.select(thread);
    const second = { ...thread, id: 'second', name: 'Second task' };
    mocks.request.mockResolvedValue({ thread: second });
    await controller.select(second);
    completeFirst({ thread });
    await first;
    expect(controller.snapshot().selected?.id).toBe('second');
  });

  it('does not overlap history polls or duplicate sends while a request is pending', async () => {
    const controller = await connectedController();
    let completeRead: (result: { thread: Thread }) => void = () => undefined;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { completeRead = resolve; }));
    const read = controller.select(thread);
    await controller.refreshSelected();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    completeRead({ thread });
    await read;
    mocks.request.mockRejectedValue(new Error('offline'));
    const send = controller.send({ text: 'test', access: 'read-only' });
    expect(await controller.send({ text: 'duplicate', access: 'read-only' })).toBe(false);
    const sent = await send;
    expect(sent).toBe(false);
    expect(controller.snapshot().sending).toBe(false);
    expect(controller.snapshot().error).toBe('offline');
  });

  it('blocks sending until PC initialization finishes and retries a failed initialization', async () => {
    vi.useFakeTimers();
    mocks.request.mockRejectedValueOnce(new Error('电脑暂未就绪'))
      .mockImplementation(async (method) => method === 'connect' ? [] : { data: [], nextCursor: null });
    const controller = new ChatController(session, 'computer');
    controller.start();
    expect(await controller.send({ text: 'test', access: 'read-only' })).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(controller.snapshot()).toMatchObject({ ready: true, error: '' });
    expect(mocks.request.mock.calls.filter(([method]) => method === 'connect')).toHaveLength(2);
    expect(mocks.request.mock.calls.some(([, body]) => body?.operation === 'send')).toBe(false);
    controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not continue a partially prepared send after the connection changes', async () => {
    const controller = await connectedController();
    let finish: (result: { thread: Thread }) => void = () => undefined;
    mocks.request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const sent = controller.send({ text: 'test', access: 'read-only' });
    mocks.events!.mode('offline');
    finish({ thread });
    expect(await sent).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().ready).toBe(false);
  });

  it('recovers a stopped PC process through the existing connection', async () => {
    const controller = await connectedController();
    vi.useFakeTimers();
    mocks.request.mockImplementation(async (method) => method === 'connect' ? [] : { data: [], nextCursor: null });
    mocks.events!.event({ method: 'connection/closed', params: {} });
    expect(controller.snapshot().ready).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(controller.snapshot().ready).toBe(true);
    controller.stop();
  });

  it('synchronizes PC settings and keeps a newer change ahead of an older acknowledgement', async () => {
    const controller = await connectedController();
    const current: ComposerSnapshot = { models, revision: 2,
      settings: { model: 'astra', effort: 'xhigh', access: 'danger-full-access' } };
    mocks.events!.event({ method: COMPOSER_EVENT, params: current });
    expect(controller.snapshot().settings).toEqual(current.settings);
    mocks.request.mockImplementationOnce(async () => {
      mocks.events!.event({ method: COMPOSER_EVENT, params: { ...current, revision: 4,
        settings: { ...current.settings, effort: 'ultra' } } });
      return { ...current, revision: 3 };
    });
    await controller.setSettings({ access: 'danger-full-access' });
    expect(controller.snapshot().settings.effort).toBe('ultra');
    await vi.waitFor(() => expect(controller.snapshot().settingsBusy).toBe(false));
    mocks.request.mockResolvedValue({ thread });
    await controller.send({ text: 'test', ...controller.snapshot().settings });
    expect(mocks.request).toHaveBeenCalledWith('request', expect.objectContaining({ operation: 'send',
      model: 'astra', effort: 'ultra', access: 'danger-full-access' }));
  });
});
