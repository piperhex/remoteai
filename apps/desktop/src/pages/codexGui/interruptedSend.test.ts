// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guiApi } from '../../../../../shared/conversation/api';
import { GuiController } from './controller';
import { testModels } from '../../../../../shared/conversation/testing/models';
import { AcknowledgedMessages } from '../../remoteChat/acknowledgedMessages';
import { ChatOperations } from '../../remoteChat/operations';
import { updateThread } from '../../../../../shared/remote-chat/client/events';
import type { GuiEvent, Item, Thread, Turn } from '../../../../../shared/conversation/types';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock('./session', () => ({ getGuiController: () => controller }));
vi.mock('./composerBridge', () => ({ guiComposer: {
  validateSend: async () => ({ model: 'test-model', effort: 'high', access: 'read-only' }),
} }));
let controller: GuiController;
let receive: (event: GuiEvent) => void;
let history: Thread;
const thread: Thread = { id: 'new-chat', cwd: '', preview: '', updatedAt: 1, turns: [] };
const turn: Turn = { id: 'first-turn', status: 'inProgress', items: [] };
const user: Item = { id: 'server-user', type: 'userMessage', content: [{ type: 'text', text: 'Check this project' }] };
const current = () => controller.getSnapshot().conversations[thread.id];

beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear(); history = structuredClone(thread);
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async callback => { receive = callback; return () => {}; });
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'list') return { data: [], nextCursor: null };
    if (request.operation === 'models') return { data: testModels, nextCursor: null };
    if (request.operation === 'send') return { turn };
    if (request.operation === 'interrupt') {
      receive({ method: 'turn/completed', params: { threadId: thread.id, turn: { ...turn, status: 'interrupted' } } });
      return {};
    }
    return { thread: history };
  });
  controller = new GuiController(); await controller.connect();
});
afterEach(() => controller.dispose());

it.each(['before', 'after'])('keeps the first message when stopped %s the send receipt', async order => {
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  let finish!: (value: { turn: Turn }) => void;
  vi.mocked(guiApi.request).mockImplementation(request => request.operation === 'send'
    ? new Promise(resolve => { finish = resolve; }) : original(request));
  const sending = controller.send('Check this project', []);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  receive({ method: 'turn/started', params: { threadId: thread.id, turn } });
  if (order === 'after') { finish({ turn }); expect(await sending).toBe(true); }
  await controller.interrupt();
  if (order === 'before') { finish({ turn }); expect(await sending).toBe(true); }
  expect(current().activeTurn).toBeNull();
  expect(current().turns[0]).toMatchObject({ status: 'interrupted', items: [{ content: user.content }] });
});

it('retains the stopped message while history lags and replaces it with the real user item once', async () => {
  expect(await controller.send('Check this project', [])).toBe(true);
  await controller.interrupt();
  controller.newConversation(); await controller.select(thread.id);
  expect(current().turns[0]).toMatchObject({ status: 'interrupted', items: [{ content: user.content }] });
  history = { ...thread, turns: [{ ...turn, status: 'interrupted', items: [user] }] };
  await controller.select(thread.id);
  receive({ method: 'item/completed', params: { threadId: thread.id, turnId: turn.id, item: user } });
  expect(current().turns[0].items).toEqual([user]);
});

it('publishes the first confirmed message to remote desktop and Web viewers before history arrives', async () => {
  const acknowledgements = new AcknowledgedMessages(() => controller);
  let remote = { ...thread, turns: [{ ...turn, status: 'interrupted' }] };
  const stop = acknowledgements.subscribe(event => { remote = updateThread(remote, event) as typeof remote; });
  expect(await controller.send('Check this project', [])).toBe(true);
  await controller.interrupt();
  expect(remote.turns[0].items).toMatchObject([{ content: user.content }]);
  expect(acknowledgements.merge(remote).turns![0].items).toHaveLength(1);
  stop();
});

it('does not show a sent message when the send request fails', async () => {
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(request => request.operation === 'send'
    ? Promise.reject(new Error('send failed')) : original(request));
  expect(await controller.send('Check this project', [])).toBe(false);
  expect(current().turns).toEqual([]);
});

it.each(['before', 'after'])('retains a remote first send stopped %s its receipt without changing local selection',
  async order => {
    const original = vi.mocked(guiApi.request).getMockImplementation()!;
    let finish!: (value: { turn: Turn }) => void;
    vi.mocked(guiApi.request).mockImplementation(request => request.operation === 'send'
      ? new Promise(resolve => { finish = resolve; }) : original(request));
    const operations = new ChatOperations();
    const sending = operations.execute({ kind: 'request', id: 'send', method: 'request', body: {
      operation: 'send', threadId: thread.id, text: 'Check this project', images: [], skills: [], access: 'read-only',
    } });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    receive({ method: 'turn/started', params: { threadId: thread.id, turn } });
    if (order === 'after') { finish({ turn }); expect((await sending).error).toBeUndefined(); }
    await operations.execute({ kind: 'request', id: 'stop', method: 'request', body: {
      operation: 'interrupt', threadId: thread.id, turnId: turn.id,
    } });
    if (order === 'before') { finish({ turn }); expect((await sending).error).toBeUndefined(); }
    expect(controller.getSnapshot().selected).toBeNull();
    expect(current().activeTurn).toBeNull();
    expect(current().turns[0]).toMatchObject({ status: 'interrupted', items: [{ content: user.content }] });
  });

it('does not duplicate a user item received before the send receipt', async () => {
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation !== 'send') return original(request);
    receive({ method: 'item/completed', params: { threadId: thread.id, turnId: turn.id, item: user } });
    return { turn };
  });
  expect(await controller.send('Check this project', [])).toBe(true);
  expect(current().turns[0].items).toEqual([user]);
});

it('sends a newly started remote thread before its history is readable', async () => {
  receive({ method: 'thread/started', params: { thread } });
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(request => request.operation === 'read'
    ? Promise.reject(new Error('history not yet saved')) : original(request));
  const result = await new ChatOperations().execute({ kind: 'request', id: 'first', method: 'request', body: {
    operation: 'send', threadId: thread.id, text: 'Check this project', images: [], skills: [], access: 'read-only',
  } });
  expect(result.error).toBeUndefined();
  expect(current().turns[0].items).toMatchObject([{ content: user.content }]);
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'read' }));
});
