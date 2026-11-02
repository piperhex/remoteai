import { expect, it, vi } from 'vitest';
import { HistoryTimeline, HISTORY_WINDOW_LIMIT } from '../../../../shared/lounge/historyTimeline';
import { historyKey, historyPage, historyPosition,
  type HistoryPage, type HistoryQuery } from '../../../../shared/lounge/archive';
import { historyTimelineRows } from '../../../../shared/lounge/historyTimelineRows';
import type { LoungeMessage } from '../../../../shared/lounge/types';

const message = (index: number): LoungeMessage => ({ type: 'message', id: String(index).padStart(4, '0'),
  sender: { id: 'bob', account: 'bob' }, text: `record ${index}`, images: [],
  sentAt: new Date(Date.UTC(2026, 10, 1) + Math.floor(index / 3) * 1000).toISOString() });
const settle = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
function loader(messages: LoungeMessage[]) {
  return vi.fn(async (query: HistoryQuery) => {
    const matches = messages.filter(value => {
      const at = historyPosition(value), cursor = query.after ?? query.before;
      if (!cursor) return true;
      const order = at.time - cursor.time || at.key.localeCompare(cursor.key);
      return query.after ? order > 0 : order < 0;
    }).sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || historyKey(a).localeCompare(historyKey(b)));
    return historyPage(query.after ? matches : matches.reverse(), query);
  });
}

it('loads both directions without gaps at equal timestamps and bounds the retained history', async () => {
  const rows = Array.from({ length: 430 }, (_, index) => message(index));
  const load = loader(rows);
  const timeline = new HistoryTimeline({ load, query: '', conversation: 'bob' });
  timeline.start(); await settle();
  expect(timeline.snapshot().messages[0].id).toBe('0429');
  while (timeline.snapshot().hasOlder) {
    timeline.older(); await settle();
    expect(timeline.snapshot().messages.length).toBeLessThanOrEqual(HISTORY_WINDOW_LIMIT);
  }
  expect(timeline.snapshot().messages.at(-1)?.id).toBe('0000');
  expect(timeline.snapshot().hasNewer).toBe(true);
  while (timeline.snapshot().hasNewer) { timeline.newer(); await settle(); }
  const current = timeline.snapshot().messages.map(value => Number(value.id));
  expect(current).toEqual(Array.from({ length: HISTORY_WINDOW_LIMIT }, (_, index) => 429 - index));
  expect(load.mock.calls.every(([query]) => query.conversation === 'bob')).toBe(true);
});

it('keeps requests single-flight, preserves records after failure and retries the failed direction', async () => {
  const load = loader(Array.from({ length: 100 }, (_, index) => message(index)));
  const timeline = new HistoryTimeline({ load, query: 'record', conversation: '' });
  timeline.start(); timeline.older(); timeline.newer(); await settle();
  expect(load).toHaveBeenCalledTimes(1);
  const before = timeline.snapshot().messages;
  load.mockRejectedValueOnce(new Error('unavailable'));
  timeline.older(); timeline.older(); await settle();
  expect(load).toHaveBeenCalledTimes(2);
  expect(timeline.snapshot().messages).toBe(before);
  expect(timeline.snapshot().error).toBe('older');
  timeline.older(); expect(load).toHaveBeenCalledTimes(2);
  timeline.retry(); await settle();
  expect(timeline.snapshot().error).toBeUndefined();
  expect(timeline.snapshot().messages).toHaveLength(80);
});

it('ignores late responses after a search or account is disposed', async () => {
  let finish: (page: HistoryPage) => void = () => {};
  const timeline = new HistoryTimeline({ query: 'old', conversation: 'old-user',
    load: () => new Promise(resolve => { finish = resolve; }) });
  timeline.start(); timeline.dispose();
  finish({ messages: [message(1)] }); await settle();
  expect(timeline.snapshot().messages).toEqual([]);
});

it('limits image-heavy windows and can load records evicted from the opposite edge', async () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ ...message(index),
    images: Array.from({ length: 3 }, () => 'data:image/png;base64,' + 'A'.repeat(1024 * 1024)) }));
  const timeline = new HistoryTimeline({ load: loader(rows), query: '', conversation: '' });
  timeline.start(); await settle();
  expect(timeline.snapshot().messages.length).toBeLessThan(4);
  timeline.older(); await settle();
  expect(timeline.snapshot().hasNewer).toBe(true);
  timeline.newer(); await settle();
  expect(timeline.snapshot().messages[0].id).toBe('0007');
});

it('places one date marker at the oldest message of each day without changing message order', () => {
  const newest = { ...message(3), sentAt: '2026-11-02T15:00:00Z' };
  const older = { ...message(2), sentAt: '2026-11-01T06:00:00Z' };
  const oldest = { ...message(1), sentAt: '2026-11-01T05:00:00Z' };
  const rows = historyTimelineRows([newest, older, oldest], 'zh-CN');
  expect(rows.map(row => row.message.id)).toEqual(['0003', '0002', '0001']);
  expect(rows.map(row => !!row.date)).toEqual([true, false, true]);
});

it('coalesces background refreshes during a pending read and keeps the refreshed first page', async () => {
  let finish: (page: HistoryPage) => void = () => {};
  const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ messages: [message(2)] });
  const timeline = new HistoryTimeline({ load, query: '', conversation: '' });
  timeline.start(); timeline.refresh(); timeline.refresh();
  expect(load).toHaveBeenCalledTimes(1);
  finish({ messages: [message(1)] }); await settle();
  expect(load).toHaveBeenCalledTimes(2);
  expect(timeline.snapshot().messages.map(value => value.id)).toEqual(['0002']);
});

it('refreshes an initially empty history when new messages arrive and cancels queued work on disposal', async () => {
  const load = vi.fn().mockResolvedValueOnce({ messages: [] }).mockResolvedValue({ messages: [message(1)] });
  const timeline = new HistoryTimeline({ load, query: '', conversation: '' });
  timeline.start(); await settle(); timeline.invalidateNewer(); await settle();
  expect(timeline.snapshot().messages).toHaveLength(1);
  timeline.refresh(); timeline.refresh(); timeline.dispose(); await settle();
  expect(load).toHaveBeenCalledTimes(3);
});
