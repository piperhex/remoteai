import { expect, it } from 'vitest';
import { summarizeProcesses } from '../../../../../shared/conversation/processDetails';
import { sliceHistory } from '../../../../../shared/remote-chat/historyPage';
import type { Thread } from '../../../../../shared/conversation/types';
import { summarizeCommands } from '../../../../../shared/remote-chat/commandMetrics';
import { CommandMetricsStore } from '../../remoteChat/commandMetrics';
import { conversation } from '../../../../../shared/conversation/events';
import { conversationSnapshot } from './conversationSnapshot';
import { conversationEntries } from '../../../../../shared/chat/turnPresentation';
import { activityTimeline } from '../../../../../shared/chat/activityTimeline';

const history = (): Thread => ({ id: 'chat', cwd: '', preview: '', updatedAt: 0,
  turns: Array.from({ length: 7 }, (_, turn) => ({ id: `turn-${turn}`, status: 'completed', items: [
    { id: `question-${turn}`, type: 'userMessage' },
    ...Array.from({ length: 2_000 }, (_, index) => ({ id: `work-${turn}-${index}`, type: 'agentMessage',
      phase: 'commentary' as const, text: 'private details '.repeat(50) })),
    { id: `answer-${turn}`, type: 'agentMessage', phase: 'final_answer', text: 'done' },
  ] })) });

it('paginates whole processes and reaches older questions without downloading the folded activities', () => {
  const source = history();
  const first = sliceHistory(source, { deferProcesses: true });
  expect(first.page.start?.itemId).toBe('answer-3');
  expect(JSON.stringify(first).length).toBeLessThan(4_000);
  expect(JSON.stringify(first)).not.toContain('private details');
  const older = sliceHistory(source, { start: first.page.start, older: true, deferProcesses: true });
  expect(older.page.start?.itemId).toBe('work-0-0');
  expect(older.thread.turns?.[0].items[0].activityCount).toBe(2_000);
  const all = sliceHistory(source, { start: older.page.start, older: true, deferProcesses: true });
  expect(all.page.hasMore).toBe(false);
  expect(all.page.start?.itemId).toBe('question-0');
  expect(source.turns?.[0].items).toHaveLength(2_002);
});

it('preserves active and failed activity streams, and does not fold legacy readers', () => {
  const source = history();
  for (const status of ['inProgress', 'failed', 'interrupted']) {
    source.turns![0].status = status;
    expect(summarizeProcesses(source).turns![0]).toBe(source.turns![0]);
  }
  expect(sliceHistory(source).thread.turns!.at(-1)!.items).toHaveLength(10);
});

it('preserves errors between work segments and keeps public file/image results outside the disclosure', () => {
  const source = history();
  source.turns = [source.turns![0]];
  const turn = source.turns[0];
  turn.requestErrors = [{ id: 'error', afterItemId: 'work-0-49', itemCount: 51, willRetry: true }];
  turn.items.splice(100, 0, { id: 'image', type: 'imageGeneration', status: 'completed', result: 'image-data' });
  const result = summarizeProcesses(source).turns![0];
  expect(result.items).toHaveLength(4);
  expect(result.items[1].activityCount).toBe(50);
  expect(result.requestErrors?.[0].afterItemId).toBe('work-0-0');
  expect(result.items[2].processOutputs?.[0].id).toBe('image');
  expect(summarizeProcesses({ ...source, turns: [result] }).turns![0]).toEqual(result);
  const timeline = activityTimeline(conversationEntries([result], new Map([[result.id, true]])));
  expect(timeline.filter(entry => entry.kind === 'process' && entry.item.processRef)).toHaveLength(2);
});

it('keeps command totals available without sending command bodies', () => {
  const source = history();
  source.turns = [{ ...source.turns![0], items: [
    { id: 'ok', type: 'commandExecution', status: 'completed', exitCode: 0, command: 'private command' },
    { id: 'failed', type: 'commandExecution', status: 'failed' },
    { id: 'running', type: 'commandExecution', status: 'inProgress', exitCode: 0 },
  ] }];
  const summary = summarizeProcesses(source);
  const expected = { successfulCommandCount: 1, completedCommandCount: 2 };
  expect(summarizeCommands(summary.turns!)).toEqual(expected);
  expect(JSON.stringify(summary)).not.toContain('private command');
  const store = new CommandMetricsStore();
  store.seed(summary);
  expect(store.read(source.id)).toEqual(expected);
});

it('does not restore hidden activity bodies when sending resumes a completed conversation', () => {
  const source = history();
  const previous = conversation(source);
  const resumed = conversationSnapshot(summarizeProcesses(source), previous);
  expect(resumed.turns[0].items).toHaveLength(3);
  expect(resumed.turns[0].items[1].activityCount).toBe(2_000);
  expect(JSON.stringify(resumed.turns)).not.toContain('private details');
});
