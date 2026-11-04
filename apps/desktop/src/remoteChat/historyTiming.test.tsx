// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mergeHistory } from '../../../../shared/remote-chat/client/history';
import { updateThread } from '../../../../shared/remote-chat/client/events';
import { ChatProcessing } from '../../../../shared/remote-chat/views/ChatProcessing';
import { WorkingStatus } from '../pages/codexGui/WorkingStatus';
import { conversation } from '../../../../shared/conversation/events';
import type { Thread } from '../../../../shared/conversation/types';
import { LiveHistory } from './liveHistory';

function runningThread(id: string, startedAt?: number | null): Thread {
  return { id, cwd: '', preview: '', updatedAt: 1, turns: [
    { id: 'turn', status: 'inProgress', startedAt, items: [
      { id: 'answer', type: 'agentMessage', text: 'Working', status: 'inProgress' },
    ] },
  ] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('uses the PC start time when a history refresh replaces an estimated start', () => {
  const cached = mergeHistory(runningThread('old'), runningThread('old'), runningThread('old'));
  expect(cached.turns![0].startedAt).toBe(1000);
  const snapshot = runningThread('old', 100);
  const refreshed = mergeHistory(snapshot, cached, cached);
  expect(refreshed.turns![0].startedAt).toBe(100);
  expect(mergeHistory(snapshot, refreshed, refreshed).turns![0].startedAt).toBe(100);
});

it('corrects timing without losing output received during a history read', () => {
  const before = runningThread('chat', 1000);
  const live = updateThread(before, { method: 'item/agentMessage/delta', params: {
    threadId: 'chat', turnId: 'turn', itemId: 'answer', delta: ' on the next step',
  } });
  const result = mergeHistory(runningThread('chat', 100), live, before);
  expect(result.turns![0]).toMatchObject({ startedAt: 100,
    items: [{ text: 'Working on the next step' }] });
});

it.each([undefined, null])('retains the known start when older PCs omit timing (%s)', startedAt => {
  const before = runningThread('chat', 100);
  expect(mergeHistory(runningThread('chat', startedAt), before, before).turns![0].startedAt).toBe(100);
});

it('corrects the host live-event cache before transmitting history', async () => {
  const history = new LiveHistory();
  history.receive({ method: 'item/started', params: { threadId: 'chat', turnId: 'turn',
    item: { id: 'answer', type: 'agentMessage', text: 'Working', status: 'inProgress' },
  } });
  const thread = await history.read('chat', async () => ({ thread: runningThread('chat', 100) }));
  expect(thread.turns![0].startedAt).toBe(100);
});

it('shows distinct PC remote totals after refreshing and switching old and new conversations', async () => {
  const cached = new Map(['old', 'new'].map(id => {
    const thread = runningThread(id);
    return [id, mergeHistory(thread, thread, thread)];
  }));
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    for (const [id, startedAt, total] of [['old', 100, '15分0秒'], ['new', 990, '10秒'],
      ['old', 100, '15分0秒']] as const) {
      const snapshot = runningThread(id, startedAt);
      const previous = cached.get(id)!;
      const remote = mergeHistory(snapshot, previous, previous);
      cached.set(id, remote);
      const local = conversation(snapshot);
      await act(async () => root.render(<>
        <section data-client="remote"><ChatProcessing key={id} turn={remote.turns![0]} active /></section>
        <section data-client="local"><WorkingStatus key={id} turn={local.turns[0]} active /></section>
      </>));
      const remoteLabel = container.querySelector('[data-client="remote"]')!.textContent;
      expect(remoteLabel).toContain(`(共计${total})`);
      expect(remoteLabel).toBe(container.querySelector('[data-client="local"]')!.textContent);
    }
  } finally { await act(async () => root.unmount()); }
  expect(vi.getTimerCount()).toBe(0);
});
