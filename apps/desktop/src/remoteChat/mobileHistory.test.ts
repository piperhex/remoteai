import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../../../../shared/conversation/api';
import type { GuiEvent, Thread } from '../../../../shared/conversation/types';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ChatConnection, ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { applyHistoryDelta, historyVersion } from '../../../../shared/remote-chat/historySync';
import { sliceHistory, type PagedHistoryDelta } from '../../../../shared/remote-chat/historyPage';
import { EventStream } from './eventStream';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
vi.mock('../api/backend', () => ({ invoke: vi.fn(), hasLocalBackend: false }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

function conversation(count = 35): Thread {
  return { id: 'chat', preview: '', cwd: '', updatedAt: 1, turns: [0, 1, 2].map((group) => ({
    id: `turn-${group}`, status: 'completed', items: Array.from({ length: count }, (_, index) => ({
      id: `item-${index}`, type: 'agentMessage', text: `Message ${index}`,
    })).filter((_, index) => Math.floor(index / 12) === group),
  })) };
}

it('transfers the newest ten items from oversized history and exactly ten older bodies per page', async () => {
  const remote = conversation();
  for (const item of remote.turns![0].items) item.text = 'old'.repeat(250_000);
  expect(JSON.stringify(remote).length).toBeGreaterThan(8 * 1024 * 1024);
  vi.mocked(guiApi.request).mockImplementation(async request => {
    expect(request).toMatchObject({ operation: 'read', threadId: remote.id, window: { pageSize: 10 } });
    if (request.operation !== 'read') throw new Error('Unexpected request');
    return sliceHistory(remote, request.window);
  });
  const operations = new ChatOperations();
  let selected: Thread = { ...remote, turns: [] };
  let page: PagedHistoryDelta['page'];
  for (const [index, expected] of [10, 20, 30, 35].entries()) {
    const response = await operations.execute({ kind: 'request', id: `page-${index}`, method: 'request',
      body: { operation: 'syncHistory', threadId: remote.id, known: historyVersion(selected),
        window: { start: page?.start, older: index > 0 } } });
    expect(response.error).toBeUndefined();
    const delta = response.data as PagedHistoryDelta;
    expect(delta.turns.flatMap((turn) => turn.items)).toHaveLength(index === 3 ? 5 : 10);
    if (index === 0) expect(JSON.stringify(delta).length).toBeLessThan(5000);
    selected = applyHistoryDelta(selected, delta);
    expect(selected.turns!.flatMap((turn) => turn.items)).toHaveLength(expected);
    page = delta.page;
    expect(page?.hasMore).toBe(index < 3);
  }
});

it('keeps page anchors stable when new messages arrive and recovers from a deleted cursor', () => {
  const remote = conversation();
  const first = sliceHistory(remote);
  remote.turns!.at(-1)!.items.push({ id: 'new', type: 'agentMessage', text: 'new reply' });
  const second = sliceHistory(remote, { start: first.page.start, older: true });
  expect(second.thread.turns!.flatMap((turn) => turn.items)).toHaveLength(21);
  expect(second.page.start?.itemId).toBe('item-15');
  const reset = sliceHistory(remote, { start: { turnId: 'missing', itemId: 'deleted' }, older: true });
  expect(reset.thread.turns!.flatMap((turn) => turn.items)).toHaveLength(10);
});

async function connected(remote: Thread) {
  const operations = new ChatOperations();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === 'read'
    ? { thread: structuredClone(remote) } : { data: [], nextCursor: null });
  let handlers: ConnectionEvents;
  let serial = 0;
  const stream = new EventStream((event) => handlers.event(event));
  const controller = new ChatController((events) => {
    handlers = events;
    return { start() { events.mode('relay'); events.ready(); }, stop() {},
      async request(method, body) {
        if ((body as { operation?: string })?.operation === 'models') return { data: [], nextCursor: null };
        const response = await operations.execute({ kind: 'request', id: String(++serial), method, body });
        if (response.error) throw new Error(response.error);
        stream.flush();
        return response.data;
      },
    } as ChatConnection;
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  return { controller, stream, emit: (event: GuiEvent) => stream.receive(operations.prepareEvent(event)) };
}

it('clears stale waiting on both host and client after an interrupted turn is replaced', async () => {
  const remote = conversation(2);
  const { controller, stream, emit } = await connected(remote);
  try {
    await controller.select({ ...remote, turns: [] });
    emit({ method: 'turn/started', params: { threadId: remote.id,
      turn: { id: 'old', status: 'inProgress', items: [] } } });
    emit({ method: 'item/started', params: { threadId: remote.id, turnId: 'old',
      item: { id: 'wait', type: 'sleep', status: 'inProgress', durationMs: 20_000 } } });
    expect(controller.snapshot().processing?.phase).toBe('wait');
    remote.status = { type: 'notLoaded' };
    remote.turns!.push({ id: 'continued', status: 'completed', items: [
      { id: 'answer', type: 'agentMessage', text: '测试成功' },
    ] });
    for (let refresh = 0; refresh < 2; refresh++) {
      await controller.refreshSelected();
      expect(controller.snapshot().selected?.turns?.some(turn => turn.status === 'inProgress')).toBe(false);
      expect(controller.snapshot().processing).toBeUndefined();
      expect(controller.snapshot().selected?.turns?.at(-1)?.items[0].text).toBe('测试成功');
    }
  } finally { controller.stop(); stream.close(); }
});

it('keeps a new live turn when it starts during an idle PC history read', async () => {
  const remote = { ...conversation(2), status: { type: 'idle' } };
  const { controller, stream, emit } = await connected(remote);
  try {
    await controller.select({ ...remote, turns: [] });
    let finish!: (value: { thread: Thread }) => void;
    vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refresh = controller.refreshSelected();
    emit({ method: 'turn/started', params: { threadId: remote.id,
      turn: { id: 'new', status: 'inProgress', items: [] } } });
    emit({ method: 'item/completed', params: { threadId: remote.id, turnId: 'new',
      item: { id: 'answer', type: 'agentMessage', text: 'Still working' } } });
    finish({ thread: remote });
    await refresh;
    expect(controller.snapshot().selected?.turns?.at(-1)).toMatchObject({ id: 'new', status: 'inProgress',
      items: [{ text: 'Still working' }] });
    expect(controller.snapshot().processing?.turnId).toBe('new');
  } finally { controller.stop(); stream.close(); }
});

it('streams before completion even when disk history stays stale, without replaying text on refresh', async () => {
  const remote = conversation(2);
  const { controller, stream, emit } = await connected(remote);
  await controller.select({ ...remote, turns: [] });
  vi.useFakeTimers();
  emit({ method: 'turn/started', params: { threadId: remote.id,
    turn: { id: 'active', status: 'inProgress', items: [] } } });
  emit({ method: 'item/started', params: { threadId: remote.id, turnId: 'active',
    item: { id: 'answer', type: 'agentMessage', text: '' } } });
  for (const delta of ['hello', ' world']) emit({ method: 'item/agentMessage/delta', params: {
    threadId: remote.id, turnId: 'active', itemId: 'answer', delta,
  } });
  await vi.advanceTimersByTimeAsync(40);
  // The host's 40ms transport batch is followed by the client's bounded display frame.
  await vi.advanceTimersByTimeAsync(32);
  expect(controller.snapshot().selected?.turns?.at(-1)).toMatchObject({ status: 'inProgress',
    items: [{ text: 'hello world' }] });
  await controller.refreshSelected();
  expect(controller.snapshot().selected?.turns?.at(-1)?.items[0].text).toBe('hello world');
  emit({ method: 'turn/completed', params: { threadId: remote.id,
    turn: { id: 'active', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'hello world' }] } } });
  await vi.advanceTimersByTimeAsync(100);
  expect(controller.snapshot().selected?.turns?.at(-1)).toMatchObject({ status: 'completed',
    items: [{ text: 'hello world' }] });
  controller.stop();
  stream.close();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([2, 35])('loads earlier items once and ignores results after leaving (%i items)', async (count) => {
  const remote = conversation(count);
  const { controller, stream } = await connected(remote);
  await controller.select({ ...remote, turns: [] });
  let finish!: (value: { thread: Thread }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const requests = vi.mocked(guiApi.request).mock.calls.length;
  const older = controller.loadOlder();
  expect(controller.snapshot()).toMatchObject({ historyLoading: true, historyLoadingMore: true });
  await controller.loadOlder();
  await controller.refreshSelected();
  expect(vi.mocked(guiApi.request).mock.calls.length).toBe(requests + 1);
  controller.back();
  finish({ thread: remote });
  await older;
  expect(controller.snapshot()).toMatchObject({ selected: null, historyLoading: false, historyLoadingMore: false });
  controller.stop();
  stream.close();
});

it('does not move an unfinished answer below subsequent steering when disk history omits it', async () => {
  const initial = { id: 'user', type: 'userMessage', text: 'Check downloads' };
  const remote: Thread = { id: 'chat', preview: '', cwd: '', updatedAt: 1,
    turns: [{ id: 'active', status: 'inProgress', items: [initial] }] };
  const { controller, stream, emit } = await connected(remote);
  try {
    await controller.select({ ...remote, turns: [] });
    const partial = { id: 'partial', type: 'agentMessage', phase: 'final_answer' as const, text: 'Partial answer' };
    const supplement = { id: 'supplement', type: 'userMessage', text: 'Add pipelining' };
    const latest = { id: 'latest', type: 'agentMessage', phase: 'commentary' as const, text: 'Implementing it' };
    for (const item of [partial, supplement, latest]) emit({ method: 'item/started',
      params: { threadId: remote.id, turnId: 'active', item } });
    remote.turns![0].items = [initial, supplement, latest];
    for (let refresh = 0; refresh < 2; refresh++) {
      await controller.refreshSelected();
      expect(controller.snapshot().selected?.turns?.[0].items.map(item => item.id))
        .toEqual(['user', 'partial', 'supplement', 'latest']);
    }
  } finally { controller.stop(); stream.close(); }
});

it('joins a running reply during a delayed read without losing its prefix or replaying buffered tokens', async () => {
  const remote: Thread = { id: 'chat', preview: '', cwd: '', updatedAt: 1, turns: [{ id: 'active',
    status: 'inProgress', startedAt: Date.now() / 1000,
    items: [{ id: 'answer', type: 'agentMessage', text: 'hello' }] }] };
  const { controller, stream, emit } = await connected(remote);
  emit({ method: 'turn/started', params: { threadId: remote.id, turn: remote.turns![0] } });
  let finish!: (value: { thread: Thread }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const reading = controller.select({ ...remote, turns: [] });
  vi.useFakeTimers();
  emit({ method: 'item/agentMessage/delta', params: {
    threadId: remote.id, turnId: 'active', itemId: 'answer', delta: ' world',
  } });
  await vi.advanceTimersByTimeAsync(40);
  emit({ method: 'thread/tokenUsage/updated', params: { threadId: remote.id } });
  emit({ method: 'item/agentMessage/delta', params: {
    threadId: remote.id, turnId: 'active', itemId: 'answer', delta: '!',
  } });
  finish({ thread: remote });
  await reading;
  await vi.advanceTimersByTimeAsync(40);
  expect(controller.snapshot().selected?.turns?.[0].items[0].text).toBe('hello world!');
  controller.stop();
  stream.close();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([2, 35])('queues one older page behind a background refresh (%i items)', async (count) => {
  const remote = conversation(count);
  const { controller, stream } = await connected(remote);
  await controller.select({ ...remote, turns: [] });
  const before = vi.mocked(guiApi.request).mock.calls.length;
  let finish!: (value: { thread: Thread }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const refresh = controller.refreshSelected();
  await controller.loadOlder();
  await controller.loadOlder();
  expect(controller.snapshot().historyLoadingMore).toBe(true);
  expect(vi.mocked(guiApi.request).mock.calls.length).toBe(before + 1);
  finish({ thread: remote });
  await refresh;
  await vi.waitFor(() => expect(controller.snapshot().historyLoading).toBe(false));
  expect(vi.mocked(guiApi.request).mock.calls.length).toBe(before + 2);
  expect(controller.snapshot().selected?.turns?.flatMap((turn) => turn.items)).toHaveLength(Math.min(count, 20));
  controller.stop();
  stream.close();
});

it.each([0, 2])('retries exhausted history and discovers missing messages (%i items)', async (count) => {
  const remote = conversation(count);
  const { controller, stream } = await connected(remote);
  await controller.select({ ...remote, turns: [] });
  expect(controller.snapshot().historyHasMore).toBe(false);
  const before = vi.mocked(guiApi.request).mock.calls.length;
  await controller.loadOlder();
  await controller.loadOlder();
  expect(vi.mocked(guiApi.request).mock.calls.length).toBe(before + 2);
  expect(controller.snapshot().historyHasMore).toBe(false);
  remote.turns![0].items.unshift({ id: 'recovered', type: 'userMessage', text: 'Earlier message' });
  await controller.loadOlder();
  expect(controller.snapshot().selected?.turns?.flatMap((turn) => turn.items).map((item) => item.id))
    .toEqual(['recovered', ...Array.from({ length: count }, (_, index) => `item-${index}`)]);
  controller.stop();
  stream.close();
});

it('allows a failed pull to be retried without clearing the visible history', async () => {
  const remote = conversation(2);
  const { controller, stream } = await connected(remote);
  await controller.select({ ...remote, turns: [] });
  const selected = controller.snapshot().selected;
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error('暂时无法加载，请重试。'));
  await controller.loadOlder();
  expect(controller.snapshot()).toMatchObject({ selected, error: '暂时无法加载，请重试。',
    historyLoading: false, historyLoadingMore: false });
  await controller.loadOlder();
  expect(controller.snapshot()).toMatchObject({ selected, error: '', historyLoadingMore: false });
  controller.stop();
  stream.close();
});
vi.mock('./queue', () => ({ remoteQueue: { request: async () => ({ revision: 0, threads: {} }) } }));
