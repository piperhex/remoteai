// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoungeController } from '../../../../shared/lounge/controller';
import { useHistoryTimeline } from '../../../../shared/lounge/useHistoryTimeline';
import type { LoungeMessage } from '../../../../shared/lounge/types';
import type { HistoryPage } from '../../../../shared/lounge/archive';

const message: LoungeMessage = { type: 'message', id: 'one', sender: { id: 'bob', account: 'bob' },
  text: 'ready before opening', images: [], sentAt: '2026-11-02T08:00:00Z' };
let controller: LoungeController;
let root: ReturnType<typeof createRoot>;
let model: ReturnType<typeof useHistoryTimeline>;
let hidden = true;
function Harness() { model = useHistoryTimeline(controller, hidden); return null; }
const render = () => act(async () => { root.render(<Harness />); });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers(); hidden = true;
  controller = new LoungeController(undefined);
  root = createRoot(document.createElement('div'));
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('preloads the first page while hidden and keeps it ready when the history opens', async () => {
  const load = vi.spyOn(controller, 'searchHistory').mockResolvedValue({ messages: [message] });
  await render();
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith(expect.objectContaining({ query: '', conversation: '', limit: 40 }));
  expect(model.messages).toEqual([message]);
  hidden = false; await render();
  expect(model.messages).toEqual([message]);
  expect(model.loading).toBeUndefined();
});

it('replaces a pending background search without showing a late response from the old query', async () => {
  let finish: (page: HistoryPage) => void = () => {};
  vi.spyOn(controller, 'searchHistory').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ messages: [{ ...message, id: 'two', text: 'matched search' }] });
  await render();
  act(() => model.setQuery('matched'));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(model.messages[0]?.text).toBe('matched search');
  await act(async () => { finish({ messages: [message] }); });
  expect(model.messages[0]?.text).toBe('matched search');
});
