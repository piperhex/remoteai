import { afterEach, expect, it, vi } from 'vitest';
import { ConversationViews } from './conversationViews';
import { watchConversation, viewedThreadIds } from '../../../../shared/conversation/viewedThreads';
import type { GuiEvent } from '../../../../shared/conversation/types';

vi.mock('../../../../shared/platform/localBackend', () => ({ isDesktopApp: false, invoke: vi.fn() }));
const views = new ConversationViews();
const local = {};
afterEach(async () => { views.release(); await watchConversation(local, null); });
const delta = (threadId: string): GuiEvent => ({ method: 'item/agentMessage/delta',
  params: { threadId, turnId: 'turn', itemId: 'item', delta: 'large body'.repeat(100_000) } });

it('keeps local and independent remote selections subscribed and releases only the disconnected owner', async () => {
  await watchConversation(local, 'local');
  await views.select('phone', 'one');
  await views.select('browser', 'two');
  expect(viewedThreadIds().sort()).toEqual(['local', 'one', 'two']);
  expect(views.event('phone', delta('two'))).toBeUndefined();
  const visible = delta('one');
  expect(views.event('phone', visible)).toBe(visible);
  views.release('phone');
  expect(viewedThreadIds().sort()).toEqual(['local', 'two']);
  expect(views.event('browser', delta('two'))?.params.delta).toHaveLength(1_000_000);
});

it('does not let a delayed history request resubscribe a conversation after selecting another', async () => {
  await views.select('phone', 'one');
  await views.select('phone', 'two');
  await views.select('phone', 'one', false);
  expect(viewedThreadIds()).toEqual(['two']);
  expect(views.event('phone', delta('one'))).toBeUndefined();
  await views.select('phone', null);
  expect(viewedThreadIds()).toEqual([]);
});

it('delivers background approvals and lightweight completion but omits tool output', async () => {
  await views.select('phone', 'one');
  const approval: GuiEvent = { method: 'item/tool/requestUserInput', id: 1, params: { threadId: 'two' } };
  expect(views.event('phone', approval)).toBe(approval);
  const completed = views.event('phone', { method: 'turn/completed', params: { threadId: 'two',
    turn: { id: 'turn', status: 'completed', items: [{ id: 'i', type: 'agentMessage', text: 'large'.repeat(100_000) }] } } });
  expect(completed?.params.turn).toMatchObject({ id: 'turn', status: 'completed', items: [] });
  expect(JSON.stringify(completed).length).toBeLessThan(200);
});

it('supports older clients through implicit history subscriptions', async () => {
  await views.select('old-phone', 'one', false);
  await views.select('old-phone', 'two', false);
  expect(viewedThreadIds()).toEqual(['two']);
});

it('sends summaries to new viewers while preserving full events for legacy viewers and approvals', async () => {
  await views.select('browser', 'one', true, true);
  await views.select('old-phone', 'one');
  const event: GuiEvent = { method: 'item/completed', params: { threadId: 'one', turnId: 'turn',
    item: { id: 'command', type: 'commandExecution', command: 'echo full', aggregatedOutput: 'x'.repeat(1_000_000) } } };
  expect(JSON.stringify(views.event('browser', event)).length).toBeLessThan(1000);
  expect(views.event('browser', event)?.params.item?.detailsRef?.itemId).toBe('command');
  expect(views.event('old-phone', event)).toBe(event);
  expect(views.event('browser', { ...event, id: 0 })).toBeDefined();
  expect(views.event('browser', { ...event, id: 0 })?.params.item?.aggregatedOutput).toHaveLength(1_000_000);
  expect(views.event('browser', { method: 'item/commandExecution/outputDelta',
    params: { threadId: 'one', itemId: 'command', delta: 'large' } })).toBeUndefined();
});
