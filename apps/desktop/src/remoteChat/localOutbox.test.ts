// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import type { Thread } from '../../../../shared/remote-chat/client/types';
import { queueProps } from '../../../../shared/remote-chat/client/queueProps';
import { QUEUE_EVENT } from '../../../../shared/remote-chat/queue';
import { testModels } from '../../../../shared/conversation/testing/models';

const thread: Thread = { id: 'chat', cwd: '/project', preview: '', updatedAt: 1, turns: [] };
let controller: ChatController;
let events: ConnectionEvents;
const request = vi.fn();
const pending = () => queueProps(controller.snapshot(), controller).messages;
const send = (text: string) => controller.enqueueMessage({ text, access: 'workspace-write' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  localStorage.clear(); request.mockReset();
  request.mockImplementation(async (method, body) => {
    if (method === 'connect') return [];
    if (body?.operation === 'models') return { data: testModels };
    if (body?.operation === 'read') return { thread: { ...thread, id: body.threadId } };
    if (body?.operation === 'syncHistory') throw new Error('当前手机端暂不支持此操作。');
    return { data: [], nextCursor: null };
  });
  controller = new ChatController(value => {
    events = value;
    return { start: () => { events.mode('relay'); events.ready(); }, stop: () => {}, request };
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  await controller.select(thread);
});
afterEach(() => { controller.stop(); vi.restoreAllMocks(); });

it('accepts immediately, retains full attachments and serializes consecutive sends', async () => {
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  const enqueue = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const previous = request.getMockImplementation()!;
  request.mockImplementation((method, body) => body.operation === 'queueEnqueue'
    ? enqueue(body) : previous(method, body));
  const attachment = { kind: 'file' as const, name: 'notes.md', path: '', data: 'YWJj' };
  const input = { text: 'first', images: ['data:image/png;base64,YWJj'], attachments: [attachment],
    access: 'workspace-write' as const };
  expect(await controller.enqueueMessage(input)).toBe(true);
  expect(await send('second')).toBe(true);
  expect(pending().map(message => message.text)).toEqual(['first', 'second']);
  expect(controller.snapshot().sending).toBe(false);
  expect(enqueue).toHaveBeenCalledTimes(1);
  attachment.data = 'changed';
  expect(enqueue.mock.calls[0][0].attachments[0].data).toBe('YWJj');
  first.resolve({ revision: 1, threads: {} });
  await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
  second.resolve({ revision: 2, threads: {} });
  await vi.waitFor(() => expect(pending()).toEqual([]));
});

it('reconciles a queue broadcast preceding acknowledgement without comparing identical text', async () => {
  const response = deferred<unknown>();
  request.mockReturnValue(response.promise);
  await send('same'); await send('same');
  const id = pending()[0].id;
  const queue = { revision: 3, threads: { chat: [
    { id: 'older', text: 'same', imageCount: 0, attachmentCount: 0, busy: false },
    { id: 'accepted', clientId: id, text: 'same', imageCount: 0, attachmentCount: 0, busy: false },
  ] } };
  events.event({ method: QUEUE_EVENT, params: queue });
  expect(pending()).toHaveLength(3);
  response.resolve(queue);
  await vi.waitFor(() => expect(pending().some(message => message.id === id)).toBe(false));
});

it('retains failed input, stops later messages and allows editing without resubmitting', async () => {
  const response = deferred<unknown>();
  request.mockReturnValue(response.promise);
  await send('first'); await send('second');
  response.reject(new Error('电脑暂未确认结果，请刷新对话后再试，避免重复发送。'));
  await vi.waitFor(() => expect(pending().every(message => !message.busy)).toBe(true));
  expect(pending()).toHaveLength(2);
  expect(pending()[0].error).toContain('避免重复发送');
  const calls = request.mock.calls.length;
  await controller.queueAction('queueSendNow', pending()[0].id);
  expect(request).toHaveBeenCalledTimes(calls);
  expect(await controller.takeQueuedMessage(pending()[0].id)).toMatchObject({ text: 'first' });
  expect(pending().map(message => message.text)).toEqual(['second']);
});

it('uses a broadcast receipt when the enqueue response is lost instead of offering a duplicate draft', async () => {
  const response = deferred<unknown>();
  request.mockReturnValue(response.promise);
  await send('accepted before timeout');
  const id = pending()[0].id;
  events.event({ method: QUEUE_EVENT, params: { revision: 1, threads: { chat: [
    { id: 'remote', clientId: id, text: 'accepted before timeout', imageCount: 0, attachmentCount: 0, busy: false },
  ] } } });
  response.reject(new Error('timeout'));
  await vi.waitFor(() => expect(pending()).toEqual([
    expect.objectContaining({ id: 'remote', clientId: id, busy: false }),
  ]));
  expect(pending()[0].error).toBeUndefined();
});

it('keeps submissions attached to their original conversation after navigation', async () => {
  const response = deferred<unknown>();
  const previous = request.getMockImplementation()!;
  const enqueue = vi.fn().mockReturnValue(response.promise);
  request.mockImplementation((method, body) => body.operation === 'queueEnqueue'
    ? enqueue(body) : previous(method, body));
  await send('first'); await send('second');
  await controller.select({ ...thread, id: 'other' });
  expect(pending()).toEqual([]);
  response.resolve({ revision: 1, threads: {} });
  await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
  expect(enqueue.mock.calls.every(([body]) => body.threadId === 'chat')).toBe(true);
});

it('queues immediately during creation and reuses one newly created conversation', async () => {
  controller.back({ cwd: '/new', label: 'new' });
  const scope = controller.snapshot().draftScope;
  const creation = deferred<unknown>();
  const previous = request.getMockImplementation()!;
  request.mockImplementation((method, body) => body.operation === 'start' ? creation.promise
    : ['send', 'queueEnqueue'].includes(body.operation) ? Promise.resolve({ revision: 1, threads: {} })
      : previous(method, body));
  await send('first'); await send('second');
  expect(pending()).toHaveLength(2);
  expect(request.mock.calls.filter(([, body]) => body.operation === 'start')).toHaveLength(1);
  creation.resolve({ thread: { ...thread, id: 'created' } });
  await vi.waitFor(() => expect(pending()).toEqual([]));
  expect(controller.snapshot().selected?.id).toBe('created');
  expect(controller.snapshot().draftScope).toBe(scope);
  expect(request).toHaveBeenCalledWith('request', expect.objectContaining({ operation: 'queueEnqueue',
    threadId: 'created', text: 'second' }));
});

it('does not send waiting messages after the connection generation changes', async () => {
  const response = deferred<unknown>();
  request.mockReturnValue(response.promise);
  await send('first'); await send('second');
  const calls = request.mock.calls.length;
  events.mode('offline');
  response.resolve({ revision: 1, threads: {} });
  await vi.waitFor(() => expect(pending()[0]?.error).toContain('连接已中断'));
  expect(request).toHaveBeenCalledTimes(calls);
});

it.each([true, false])('blocks starting a goal until the local outbox is handled (new=%s)', async fresh => {
  if (fresh) controller.back();
  request.mockReturnValue(new Promise(() => {}));
  await send('pending ordinary message');
  expect(await controller.enqueueMessage({ text: 'start a goal', access: 'workspace-write', goalMode: true }))
    .toBe(false);
  expect(controller.snapshot().error).toContain('请先处理待发送消息');
  expect(request.mock.calls.some(([, body]) => body.operation === 'goalSet')).toBe(false);
});
