// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveHistory } from './liveHistory';
import { mergeHistory } from '../../../../shared/remote-chat/client/history';
import { summarizeProcesses } from '../../../../shared/conversation/processDetails';
import { summarizeTools } from '../../../../shared/conversation/toolDetails';
import { sliceHistory } from '../../../../shared/remote-chat/historyPage';
import { summarizeCommands } from '../../../../shared/remote-chat/commandMetrics';
import { DeferredProcessDetails, ProcessDetailsContext } from '../../../../shared/chat/DeferredProcessDetails';
import type { Item, Thread } from '../../../../shared/conversation/types';
import { processMergeSource as source } from '../../e2e/process-merge-fixture';

function cache(thread: Thread) {
  const history = new LiveHistory();
  history.receive({ method: 'turn/completed', params: { threadId: thread.id, turn: thread.turns![0] } });
  return history;
}

const wire = (thread: Thread) => sliceHistory(summarizeTools(thread), { deferProcesses: true }).thread;
const expectedCounts = { successfulCommandCount: 2, completedCommandCount: 2 };
afterEach(() => vi.unstubAllGlobals());

it.each(['reasoning', 'commentary', 'commandExecution'])(
  'replaces cached completed %s ranges with one summary across repeated syncs and expansion', async first => {
    const raw = source(first);
    const history = cache(raw);
    const snapshot = summarizeProcesses(raw);
    for (let sync = 0; sync < 2; sync++) {
      const result = wire(await history.read(raw.id, async () => ({ thread: snapshot })));
      expect(summarizeCommands(result.turns!)).toEqual(expectedCounts);
      expect(result.turns![0].items.map(item => item.type)).toEqual(['userMessage', 'processSummary', 'agentMessage']);
      expect(result.turns![0].items[1]).toEqual(snapshot.turns![0].items[1]);
      const load = vi.fn().mockResolvedValue({ items: raw.turns![0].items.slice(1, -1) });
      const container = document.createElement('div');
      const root = createRoot(container);
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      try {
        await act(async () => root.render(<ProcessDetailsContext.Provider value={{ load, active: true }}>
          <DeferredProcessDetails items={result.turns![0].items.slice(1, -1)}>
            {items => <>{items.map(item => <div key={item.id} data-id={item.id} />)}</>}
          </DeferredProcessDetails>
        </ProcessDetailsContext.Provider>));
        expect(load).toHaveBeenCalledTimes(1);
        expect([...container.querySelectorAll('[data-id]')].map(row => row.getAttribute('data-id')))
          .toEqual(raw.turns![0].items.slice(1, -1).map(item => item.id));
      } finally { await act(async () => root.unmount()); }
    }
  });

it('keeps new activities and a new active turn received while a folded snapshot is read', async () => {
  const raw = source('reasoning');
  const history = cache(raw);
  const result = wire(await history.read(raw.id, async () => {
    history.receive({ method: 'item/completed', params: { threadId: raw.id, turnId: 'turn',
      item: { id: 'late', type: 'commandExecution', status: 'completed', exitCode: 0 } } });
    history.receive({ method: 'item/started', params: { threadId: raw.id, turnId: 'next',
      item: { id: 'running', type: 'commandExecution', status: 'inProgress' } } });
    return { thread: summarizeProcesses(raw) };
  }));
  expect(summarizeCommands(result.turns!)).toEqual({ successfulCommandCount: 3, completedCommandCount: 3 });
  expect(result.turns!.at(-1)).toMatchObject({ id: 'next', status: 'inProgress', items: [{ id: 'running' }] });
  expect(result.turns![0].items.filter(item => item.processRef)).toHaveLength(2);
});

it('keeps an activity updated inside the covered range during the read without retaining stale summary metrics', () => {
  const before = source('reasoning');
  const live = { ...before, turns: [{ ...before.turns![0], items: before.turns![0].items.map(item =>
    item.id === 'one' ? { ...item, exitCode: 1 } : item) }] };
  const result = wire(mergeHistory(summarizeProcesses(before), live, before));
  expect(summarizeCommands(result.turns!)).toEqual({ successfulCommandCount: 1, completedCommandCount: 2 });
  expect(result.turns![0].items[1].type).toBe('processSummary');
  expect(result.turns![0].items[1].processRef).toEqual(summarizeProcesses(before).turns![0].items[1].processRef);
});

it('keeps a new activity inserted between summary endpoints during a read', () => {
  const before = source('reasoning');
  const items = [...before.turns![0].items];
  items.splice(3, 0, { id: 'inserted', type: 'commandExecution', status: 'completed', exitCode: 0 });
  const live = { ...before, turns: [{ ...before.turns![0], items }] };
  const result = mergeHistory(summarizeProcesses(before), live, before);
  expect(result.turns![0].items.map(item => item.id)).toEqual(items.map(item => item.id));
  expect(result.turns![0].items.some(item => item.processRef)).toBe(false);
  expect(summarizeCommands(wire(result).turns!)).toEqual({ successfulCommandCount: 3, completedCommandCount: 3 });
});

it('preserves completed cached turns when the disk snapshot still lags their notifications', async () => {
  const raw = source('reasoning');
  const result = await cache(raw).read(raw.id, async () => ({ thread: { ...raw, turns: [] } }));
  expect(result.turns).toEqual(raw.turns);
});

it('keeps error-separated ranges and page order while merging a newly completed turn', () => {
  const raw = source('commentary');
  raw.turns![0].requestErrors = [{ id: 'retry', afterItemId: 'one', itemCount: 3, willRetry: true }];
  const before = { ...raw, turns: [{ ...raw.turns![0], status: 'inProgress' }] };
  const result = wire(mergeHistory(summarizeProcesses(raw), raw, before));
  expect(summarizeCommands(result.turns!)).toEqual(expectedCounts);
  expect(result.turns![0].items.map(item => item.id)).toEqual(['question', 'head', 'two', 'answer']);
  expect(result.turns![0].requestErrors?.[0].afterItemId).toBe('head');
});

it('retains an error boundary received inside a folded range during the read', () => {
  const before = source('reasoning');
  const live = { ...before, turns: [{ ...before.turns![0], requestErrors: [
    { id: 'retry', afterItemId: 'one', itemCount: 3, willRetry: true },
  ] }] };
  const result = wire(mergeHistory(summarizeProcesses(before), live, before));
  expect(result.turns![0].items.map(item => item.id)).toEqual(['question', 'head', 'two', 'answer']);
  expect(result.turns![0].requestErrors?.[0].afterItemId).toBe('head');
  expect(summarizeCommands(result.turns!)).toEqual(expectedCounts);
});
