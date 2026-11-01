// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isTextDelta, StreamFrame } from '../../../../shared/chat/streamFrame';
import type { GuiEvent } from '../../../../shared/remote-chat/client/types';

const delta = (text: string, params: Partial<GuiEvent['params']> = {}): GuiEvent => ({
  method: 'item/agentMessage/delta', params: { threadId: 'one', turnId: 'turn', itemId: 'answer',
    delta: text, ...params },
});
let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { frame = undefined; }));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('publishes ordered text once per frame and cancels its fallback', () => {
  const publish = vi.fn(); const stream = new StreamFrame(publish);
  for (let index = 0; index < 100; index++) stream.push(delta(`${index},`));
  expect(publish).not.toHaveBeenCalled();
  frame!(16);
  expect(publish).toHaveBeenCalledExactlyOnceWith([delta(Array.from({ length: 100 }, (_, i) => `${i},`).join(''))]);
  expect(vi.getTimerCount()).toBe(0);
  stream.push(delta('next')); frame!(32);
  expect(publish).toHaveBeenLastCalledWith([delta('next')]);
});

it('preserves interleaving, reasoning indices, methods and original input objects', () => {
  const publish = vi.fn(); const stream = new StreamFrame(publish);
  const inputs = [delta('A'), delta('B', { itemId: 'other' }), delta('C'),
    { ...delta('D', { summaryIndex: 0 }), method: 'item/reasoning/summaryTextDelta' },
    { ...delta('E', { summaryIndex: 1 }), method: 'item/reasoning/summaryTextDelta' }];
  inputs.forEach(event => stream.push(event)); stream.flush();
  expect(publish).toHaveBeenCalledExactlyOnceWith(inputs);
  stream.push(inputs[0]); stream.push(delta('F')); stream.flush();
  expect(inputs[0].params.delta).toBe('A');
  expect(publish).toHaveBeenLastCalledWith([delta('AF')]);
});

it('flushes on hiding and keeps hidden pages current when animation frames stop', () => {
  const publish = vi.fn(); const stream = new StreamFrame(publish);
  stream.push(delta('visible'));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(publish).toHaveBeenCalledExactlyOnceWith([delta('visible')]);
  expect(frame).toBeUndefined();
  stream.push(delta('hidden')); vi.advanceTimersByTime(32);
  expect(publish).toHaveBeenLastCalledWith([delta('hidden')]);
  expect(vi.getTimerCount()).toBe(0);
});

it('falls back when visible animation frames stall and releases listeners on flush', () => {
  const publish = vi.fn(); const stream = new StreamFrame(publish);
  const remove = vi.spyOn(document, 'removeEventListener');
  stream.push(delta('pending')); vi.advanceTimersByTime(32);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  stream.flush(); vi.advanceTimersByTime(1000);
  expect(publish).toHaveBeenCalledTimes(1);
});

it('publishes throttled background text immediately when the page becomes visible', () => {
  const publish = vi.fn(); const stream = new StreamFrame(publish);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  stream.push(delta('background'));
  expect(frame).toBeUndefined();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(publish).toHaveBeenCalledExactlyOnceWith([delta('background')]);
  expect(vi.getTimerCount()).toBe(0);
});

it('only batches known text notifications without request identifiers', () => {
  expect(isTextDelta(delta('text'))).toBe(true);
  expect(isTextDelta({ ...delta('text'), id: 1 })).toBe(false);
  expect(isTextDelta({ ...delta('text'), method: 'unknown/delta' })).toBe(false);
  expect(isTextDelta({ method: 'turn/completed', params: {} })).toBe(false);
});
