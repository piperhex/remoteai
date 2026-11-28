// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoungeController } from '../../../../shared/lounge/controller';
import { useLoungeNavigation } from '../../../../shared/lounge/useLoungeNavigation';
import { quoteMessage } from '../../../../shared/lounge/reply';
import { historyKey } from '../../../../shared/lounge/archive';
import type { LoungeMessage, LoungeSnapshot } from '../../../../shared/lounge/types';

const original: LoungeMessage = { type: 'message', id: 'original', sender: { id: 'bob', account: 'bob' },
  text: 'original', images: [], sentAt: '2026-10-29T00:00:00Z' };
let controller: LoungeController;
let state: LoungeSnapshot;
let model: ReturnType<typeof useLoungeNavigation>;
let root: ReturnType<typeof createRoot>;
function Harness() { model = useLoungeNavigation(controller, state); return null; }
const render = () => act(() => root.render(<Harness />));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  controller = new LoungeController(undefined); state = { ...controller.snapshot(), messages: [original] };
  vi.spyOn(controller, 'snapshot').mockImplementation(() => state);
  root = createRoot(document.createElement('div'));
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('pins located context as new messages arrive, then restores live history on latest', async () => {
  vi.spyOn(controller, 'lookupMessage').mockResolvedValue(original); render();
  await act(async () => { expect(await model.locate(quoteMessage(original))).toBe(true); });
  expect(model.highlight).toBe(historyKey(original));
  state = { ...state, messages: [{ ...original, id: 'incoming', text: 'new arrival' }] }; render();
  expect(model.messages).toEqual([original]);
  act(() => vi.advanceTimersByTime(3000)); expect(model.highlight).toBeUndefined();
  act(() => model.clear()); expect(model.messages).toEqual(state.messages);
});

it('highlights the newest tray message while keeping the conversation live', async () => {
  vi.spyOn(controller, 'lookupMessage').mockResolvedValue(original); render();
  await act(async () => { expect(await model.locateTrayMessage(quoteMessage(original))).toBe('latest'); });
  expect(model.focus).toBeUndefined();
  expect(model.highlight).toBe(historyKey(original));
  state = { ...state, messages: [original, { ...original, id: 'incoming' }] }; render();
  expect(model.messages).toEqual(state.messages);
});

it('opens an older tray message in its historical context', async () => {
  vi.spyOn(controller, 'lookupMessage').mockResolvedValue(original);
  state = { ...state, messages: [original, { ...original, id: 'newer' }] }; render();
  await act(async () => { expect(await model.locateTrayMessage(quoteMessage(original))).toBe('history'); });
  expect(model.focus?.key).toBe(historyKey(original));
});

it('cancels late navigation after leaving a conversation or pressing latest', async () => {
  let finish: (message: LoungeMessage) => void = () => {};
  vi.spyOn(controller, 'lookupMessage').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render();
  let pending: Promise<boolean>;
  act(() => { pending = model.locate(quoteMessage(original)); });
  state = { ...state, conversation: 'carol', messages: [] }; render();
  await act(async () => { finish(original); expect(await pending).toBe(false); });
  expect(model.focus).toBeUndefined(); expect(model.messages).toEqual([]);
  act(() => { pending = model.locate(quoteMessage(original)); model.clear(); });
  await act(async () => { finish(original); expect(await pending).toBe(false); });
  expect(model.focus).toBeUndefined();
});

it('loads an older context and leaves the current thread intact on missing or failed lookups', async () => {
  state = { ...state, messages: [] };
  const lookup = vi.spyOn(controller, 'lookupMessage').mockResolvedValue(original);
  const history = vi.spyOn(controller, 'searchHistory').mockResolvedValue({ messages: [] }); render();
  await act(async () => { await model.locate(quoteMessage(original)); });
  expect(history).toHaveBeenCalledWith(expect.objectContaining({ conversation: '', limit: 40 }),
    { committedOnly: true });
  expect(model.messages).toEqual([original]);
  lookup.mockResolvedValue(undefined);
  await act(async () => { expect(await model.locate(quoteMessage(original))).toBe(false); });
  expect(model.error).toBe('client.lounge.originalMissing'); expect(model.messages).toEqual([original]);
  lookup.mockRejectedValue(new Error('storage unavailable'));
  await act(async () => { await model.locate(quoteMessage(original)); });
  expect(model.error).toBe('client.lounge.originalLoadFailed');
});
