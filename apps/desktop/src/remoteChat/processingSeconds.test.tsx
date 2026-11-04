// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useProcessingSeconds } from '../../../../shared/remote-chat/client/useProcessingSeconds';
import type { Turn } from '../../../../shared/conversation/types';
import { ChatProcessing } from '../../../../shared/remote-chat/views/ChatProcessing';
import { restoreProcessing } from '../../../../shared/conversation/processing';
import { setLanguage, type Language } from "../../../../shared/localization/browserLanguage";

function Clock({ turn, active }: { turn: Turn; active: boolean }) {
  return <span>{useProcessingSeconds(turn, active).totalSeconds}</span>;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setLanguage('zh'); });

it('renders desktop phase labels and resets elapsed time when the latest activity changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const container = document.createElement('div');
  const root = createRoot(container);
  const turn: Turn = { id: 'running', status: 'inProgress', startedAt: 50, items: [
    { id: 'command', type: 'commandExecution', status: 'inProgress' },
  ] };
  const processing = restoreProcessing(turn);
  await act(async () => root.render(<ChatProcessing turn={turn} processing={processing} active />));
  expect(container.textContent).toBe('正在执行命令 · 0秒 (共计50秒)');
  await act(async () => vi.advanceTimersByTimeAsync(65_000));
  expect(container.textContent).toBe('正在执行命令 · 1分5秒 (共计1分55秒)');
  await act(async () => root.render(<ChatProcessing turn={turn} active
    processing={{ ...processing, id: 'answer', phase: 'response', startedAtMs: Date.now() }} />));
  expect(container.textContent).toBe('正在生成回复 · 0秒 (共计1分55秒)');
  await act(async () => vi.advanceTimersByTimeAsync(3_551_000));
  expect(container.textContent).toBe('正在生成回复 · 59分11秒 (共计1时1分6秒)');
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

it('counts from the PC start time, survives streamed renders, and clears timers when inactive or complete', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const container = document.createElement('div');
  const root = createRoot(container);
  const turn = { id: 'running', status: 'inProgress', startedAt: 95, items: [] };
  await act(async () => root.render(<Clock turn={turn} active />));
  expect(container.textContent).toBe('5');
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => root.render(<Clock turn={{ ...turn, items: [{ id: 'item', type: 'agentMessage' }] }} active />));
  expect(container.textContent).toBe('7');
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => root.render(<Clock turn={turn} active={false} />));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  await act(async () => root.render(<Clock turn={turn} active />));
  expect(container.textContent).toBe('10');
  await act(async () => root.render(<Clock turn={{ ...turn, status: 'completed' }} active />));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => root.unmount());
});

it('keeps fallback total timing across phase changes and starts fresh for the next turn', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const container = document.createElement('div');
  const root = createRoot(container);
  const turn: Turn = { id: 'fallback', status: 'inProgress', items: [] };
  await act(async () => root.render(<ChatProcessing turn={turn} active />));
  await act(async () => vi.advanceTimersByTimeAsync(12_000));
  const processing = { ...restoreProcessing(turn), phase: 'command' as const, startedAtMs: Date.now() };
  await act(async () => root.render(<ChatProcessing turn={{ ...turn }} processing={processing} active />));
  expect(container.textContent).toBe('正在执行命令 · 0秒 (共计12秒)');
  await act(async () => root.render(<ChatProcessing turn={{ ...turn, id: 'next' }} processing={processing} active />));
  expect(container.textContent).toBe('等待响应 · 0秒 (共计0秒)');
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

it.each<[Language, number, string]>([
  ['en', 66, 'Waiting for response · 5s (total 1m 6s)'],
  ['en', 3666, 'Waiting for response · 5s (total 1h 1m 6s)'],
  ['ru', 66, 'Ожидание ответа · 5 с (всего 1 мин 6 с)'],
  ['ru', 3666, 'Ожидание ответа · 5 с (всего 1 ч 1 мин 6 с)'],
])('localizes both timers in %s after %i seconds', async (language, seconds, expected) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(4_000_000);
  setLanguage(language);
  const container = document.createElement('div');
  const root = createRoot(container);
  const turn: Turn = { id: 'localized', status: 'inProgress', startedAt: 4000 - seconds, items: [] };
  const processing = { ...restoreProcessing(turn), startedAtMs: Date.now() - 5000 };
  await act(async () => root.render(<ChatProcessing turn={turn} processing={processing} active />));
  expect(container.textContent).toBe(expected);
  await act(async () => root.unmount());
});
