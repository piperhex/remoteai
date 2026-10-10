// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatRetryProvider } from '../../../../shared/remote-chat/ChatRetryProvider';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { QUEUE_EVENT } from '../../../../shared/remote-chat/queue';
import { ChatRetryButton } from '../../../web/src/chat/ChatRetryButton';
import { GuiController } from '../pages/codexGui/controller';
import { guiApi } from '../pages/codexGui/api';
import { testModels } from '../pages/codexGui/testModels';
import type { Request, Thread } from '../pages/codexGui/types';
import { RemoteQueue } from './queue';

vi.mock('../pages/codexGui/api', () => ({ guiApi: {
  connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(),
} }));
const thread: Thread = { id: 'thread', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'failed', status: 'failed', items: [], error: { message: 'HTTP 502' } }] };
let host: GuiController;
let client: ChatController;
let queue: RemoteQueue;
let root: Root;
let container: HTMLDivElement;
let unsubscribe: () => void;
let failResume: ((error: Error) => void) | undefined;
let resumeFailure = false;
let sendFailure = false;
const transport = vi.fn();

function RemoteRetry() {
  const state = useSyncExternalStore(client.subscribe, client.snapshot);
  return <ChatRetryProvider controller={client} state={state}><ChatRetryButton turnId="failed" /></ChatRetryProvider>;
}
const button = () => container.querySelector('button')!;
const clickTwice = () => act(async () => { button().click(); button().click(); });
const enqueueRequests = () => transport.mock.calls.filter(([body]) => body.operation === 'queueEnqueue');
const sends = () => vi.mocked(guiApi.request).mock.calls.filter(([body]) => body.operation === 'sendBatch');

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks(); localStorage.clear();
  resumeFailure = false; sendFailure = false; failResume = undefined;
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'list') return { data: [], nextCursor: null };
    if (request.operation === 'models') return { data: testModels, nextCursor: null };
    if (request.operation === 'resume' && resumeFailure) {
      return new Promise((_resolve, reject) => { failResume = reject; });
    }
    if (request.operation === 'sendBatch') {
      if (sendFailure) throw new Error('The send result was not acknowledged');
      return { turn: { id: 'continued', status: 'inProgress', items: [] } };
    }
    return { thread: structuredClone(thread) };
  });
  host = new GuiController(); queue = new RemoteQueue(() => host);
  await host.connect();
  transport.mockImplementation((body: Record<string, unknown>) => String(body.operation).startsWith('queue')
    ? queue.request(body) : guiApi.request(body as unknown as Request));
  let events!: ConnectionEvents;
  client = new ChatController(callbacks => {
    events = callbacks;
    return { start: () => { events.mode('relay'); events.ready(); }, stop: () => {},
      request: async <T,>(method: 'connect' | 'request' | 'respond', body?: unknown): Promise<T> =>
        (method === 'connect' ? [] : await transport(body)) as T };
  });
  unsubscribe = queue.subscribe(snapshot => events.event({ method: QUEUE_EVENT, params: snapshot }));
  client.start();
  await vi.waitFor(() => expect(client.snapshot().ready).toBe(true));
  await client.select(thread);
  container = document.createElement('div'); root = createRoot(container);
  await act(async () => root.render(<RemoteRetry />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  unsubscribe(); client.stop(); host.dispose(); vi.unstubAllGlobals();
});

it('retries once after enqueue, resume failure and deletion, then protects an acknowledged send', async () => {
  resumeFailure = true;
  await clickTwice();
  expect(enqueueRequests()).toHaveLength(1);
  expect(button().disabled).toBe(true);
  await vi.waitFor(() => expect(failResume).toBeDefined());
  await act(async () => failResume!(new Error('Could not resume the session')));
  const failed = client.snapshot().queue.threads.thread[0];
  expect(failed).toMatchObject({ error: expect.any(String), busy: false });
  expect(sends()).toHaveLength(0);
  await act(async () => client.queueAction('queueRemove', failed.id));
  expect(button().disabled).toBe(false);
  resumeFailure = false;
  await clickTwice();
  await act(async () => { await vi.waitFor(() => expect(sends()).toHaveLength(1)); });
  expect(enqueueRequests()).toHaveLength(2);
  expect(client.snapshot().queue.threads.thread).toBeUndefined();
  expect(client.snapshot().selected?.turns?.at(-1)?.id).toBe('failed');
  expect(button().disabled).toBe(true);
  await clickTwice();
  expect(enqueueRequests()).toHaveLength(2);
});

it('keeps an unconfirmed send locked after its queue item is deleted', async () => {
  sendFailure = true;
  await clickTwice();
  await act(async () => {
    await vi.waitFor(() => expect(client.snapshot().queue.threads.thread?.[0].busy).toBe(false));
  });
  const unconfirmed = client.snapshot().queue.threads.thread[0];
  expect(unconfirmed).toMatchObject({ error: expect.any(String) });
  await act(async () => client.queueAction('queueRemove', unconfirmed.id));
  expect(client.snapshot().queue.threads.thread).toBeUndefined();
  expect(button().disabled).toBe(true);
  await clickTwice();
  expect(enqueueRequests()).toHaveLength(1);
  expect(sends()).toHaveLength(1);
});

it('releases the exact retry item when a waiting submission is explicitly cancelled', async () => {
  host.getSnapshot().sending = true;
  await clickTwice();
  const waiting = client.snapshot().queue.threads.thread[0];
  expect(waiting.busy).toBe(false);
  expect(button().disabled).toBe(true);
  await act(async () => client.queueAction('queueRemove', waiting.id));
  expect(button().disabled).toBe(false);
  await clickTwice();
  expect(enqueueRequests()).toHaveLength(2);
  expect(client.snapshot().queue.threads.thread).toHaveLength(1);
  expect(sends()).toHaveLength(0);
});

it('keeps protection when a failed resume is retried in the queue and its send becomes unconfirmed', async () => {
  resumeFailure = true;
  await clickTwice();
  await vi.waitFor(() => expect(failResume).toBeDefined());
  await act(async () => failResume!(new Error('Could not resume the session')));
  const id = client.snapshot().queue.threads.thread[0].id;
  expect(sends()).toHaveLength(0);
  resumeFailure = false; sendFailure = true;
  await act(async () => client.queueAction('queueSendNow', id));
  expect(sends()).toHaveLength(1);
  await act(async () => client.queueAction('queueRemove', id));
  expect(client.snapshot().queue.threads.thread).toBeUndefined();
  expect(button().disabled).toBe(true);
  await clickTwice();
  expect(enqueueRequests()).toHaveLength(1);
  expect(sends()).toHaveLength(1);
});
