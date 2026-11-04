import { expect, it } from 'vitest';
import { commandOutcome, formatConversationTsr, summarizeCommands }
  from '../../../../shared/remote-chat/commandMetrics';
import { CommandMetricsStore } from './commandMetrics';
import type { GuiEvent, Item, Thread } from '../../../../shared/conversation/types';

const command = (id: string, exitCode: number | null, status = 'completed'): Item =>
  ({ id, type: 'commandExecution', status, exitCode });
const thread = (items: Item[], id = 'chat'): Thread => ({ id, preview: '', cwd: '', updatedAt: 0,
  turns: [{ id: 'turn', status: 'completed', items }] });
const completed = (item: Item): GuiEvent => ({ method: 'item/completed',
  params: { threadId: 'chat', turnId: 'turn', item } });

it('counts command outcomes across turns, including failed launches but excluding unfinished or unknown results', () => {
  const turns = thread([command('ok', 0), command('bad', 2), command('launch', null, 'failed'),
    command('running', 0, 'inProgress'), command('cancel', null, 'cancelled'), command('deny', 0, 'declined'),
    command('unknown', null), command('nan', NaN), { id: 'tool', type: 'mcpToolCall', status: 'completed' }]).turns!;
  turns.push({ id: 'next', status: 'completed', items: [command('ok', 0)] });
  expect(summarizeCommands(turns)).toEqual({ successfulCommandCount: 2, completedCommandCount: 4 });
  expect(commandOutcome(command('bad-status', 0, 'failed'))).toBe(false);
});

it('formats zero and full success and leaves absent, empty or malformed totals unknown', () => {
  expect(formatConversationTsr({ successfulCommandCount: 2, completedCommandCount: 3 })).toBe('66.7%');
  expect(formatConversationTsr({ successfulCommandCount: 0, completedCommandCount: 1 })).toBe('0.0%');
  expect(formatConversationTsr({ successfulCommandCount: 1, completedCommandCount: 1 })).toBe('100.0%');
  for (const invalid of [undefined, null, {}, { successfulCommandCount: 0, completedCommandCount: 0 },
    { successfulCommandCount: 2, completedCommandCount: 1 }, { successfulCommandCount: -1, completedCommandCount: 1 },
    { successfulCommandCount: 1, completedCommandCount: NaN }, { successfulCommandCount: 0.5, completedCommandCount: 2 }]) {
    expect(formatConversationTsr(invalid)).toBe('—');
  }
});

it('counts repeated item ids once per turn and replaces a corrected outcome', () => {
  const turns = thread([command('same', 1), command('same', 0)]).turns!;
  expect(summarizeCommands(turns)).toEqual({ successfulCommandCount: 1, completedCommandCount: 1 });
});

it('keeps full-history metrics separate by thread and updates live commands without counting retries twice', () => {
  const store = new CommandMetricsStore();
  expect(store.read('chat')).toEqual({});
  store.seed(thread([command('ok', 0), command('bad', 1)]));
  store.seed(thread([command('other', 1)], 'other'));
  store.receive(completed(command('new', 0)));
  store.receive(completed(command('new', 0)));
  store.receive({ method: 'turn/completed', params: { threadId: 'chat',
    turn: { id: 'turn', status: 'completed', items: [command('new', 0)] } } });
  expect(store.read('chat')).toEqual({ successfulCommandCount: 2, completedCommandCount: 3 });
  expect(store.read('other')).toEqual({ successfulCommandCount: 0, completedCommandCount: 1 });
  store.receive(completed(command('bad', 0)));
  expect(store.read('chat')).toEqual({ successfulCommandCount: 3, completedCommandCount: 3 });
});

it('invalidates changed history and disconnects until a full snapshot is available again', () => {
  const store = new CommandMetricsStore();
  store.seed(thread([command('ok', 0)]));
  store.receive({ method: 'thread/historyChanged', params: { threadId: 'chat' } });
  store.receive(completed(command('new', 0)));
  expect(store.read('chat')).toEqual({});
  store.seed(thread([command('bad', 1)]));
  expect(store.read('chat')).toEqual({ successfulCommandCount: 0, completedCommandCount: 1 });
  store.receive({ method: 'connection/closed', params: {} });
  expect(store.read('chat')).toEqual({});
});
