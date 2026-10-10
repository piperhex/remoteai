import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ChatConnection, ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import type { ChatState } from '../../../../shared/remote-chat/client/types';
import { historyDelta } from '../../../../shared/remote-chat/historySync';

const source = { id: 'source', cwd: 'D:/project', preview: '', updatedAt: 1 };
const fork = { ...source, id: 'fork', turns: [] };
const request = vi.fn<ChatConnection['request']>();
let controller: ChatController;
let events: ConnectionEvents;

beforeEach(() => {
  request.mockReset().mockImplementation(async (_method, body) => {
    const input = body as { operation: string };
    if (input.operation === 'forkLatest') return { thread: fork };
    if (input.operation === 'syncHistory') return historyDelta(fork);
    return { data: [source, fork], nextCursor: null };
  });
  controller = new ChatController(callbacks => {
    events = callbacks;
    return { start() {}, stop() {}, request: <T>(...args: Parameters<ChatConnection['request']>) =>
      request(...args) as Promise<T> };
  });
  Object.assign(controller.snapshot(), { ready: true, threads: [source] });
});
afterEach(() => controller.stop());

it('serializes branch clicks and does not change a newer selection', async () => {
  let finish!: (value: { thread: typeof fork }) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = controller.forkConversation(source);
  expect(await controller.forkConversation(source)).toBe(false);
  controller.back();
  finish({ thread: fork });
  expect(await pending).toBe(true);
  expect(controller.snapshot().selected).toBeNull();
  expect(controller.snapshot().threadActionBusy).toBeUndefined();
  expect(request.mock.calls.filter(([, body]) => (body as { operation: string }).operation === 'forkLatest'))
    .toHaveLength(1);
});

it('preserves the source on failure and permits retry', async () => {
  Object.assign(controller.snapshot(), { selected: source });
  request.mockRejectedValueOnce(new Error('暂时无法创建新聊天'));
  expect(await controller.forkConversation(source)).toBe(false);
  expect(controller.snapshot()).toMatchObject({ selected: source, error: '暂时无法创建新聊天' });
  expect(controller.snapshot().threadActionBusy).toBeUndefined();
  expect(await controller.forkConversation(source)).toBe(true);
  expect(controller.snapshot().selected?.id).toBe('fork');
});

it('ignores a late branch response after disconnecting', async () => {
  let finish!: (value: { thread: typeof fork }) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = controller.forkConversation(source);
  events.mode('offline');
  finish({ thread: fork });
  expect(await pending).toBe(false);
  expect(controller.snapshot().selected).toBeNull();
});

it.each<Partial<ChatState>>([{ ready: false }, { archived: true }, { workspaceBusy: true },
  { threads: [{ ...source, status: { type: 'active' } }] },
  { approvals: [{ method: 'approval', params: { threadId: source.id } }] },
])('rejects an unavailable branch before sending: %j', async patch => {
  Object.assign(controller.snapshot(), patch);
  expect(await controller.forkConversation(source)).toBe(false);
  expect(request).not.toHaveBeenCalled();
});

it('updates shared pins without clearing the selected conversation or its unread state', async () => {
  Object.assign(controller.snapshot(), { selected: source });
  const sidebar = { revision: 1, pins: [source.id], threads: {},
    readState: { source: { turnId: 'last', unread: true } } };
  request.mockResolvedValueOnce(sidebar);
  await controller.threadActions.run(source, 'pin');
  expect(request).toHaveBeenCalledWith('request', { operation: 'threadPin', threadId: source.id, pinned: true });
  expect(controller.snapshot().sidebar).toEqual(sidebar);
  expect(controller.snapshot().selected).toBe(source);
});
