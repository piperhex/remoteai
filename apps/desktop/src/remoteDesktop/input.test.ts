import { afterEach, expect, it, vi } from 'vitest';
import { DesktopPointer, MAX_BUFFERED_INPUT, sendDesktopInput } from '../../../../shared/remote-desktop/input';
import { DesktopControls } from './controls';
import type { DesktopCapture } from './capture';

afterEach(() => vi.useRealTimers());
it('coalesces pointer moves and flushes them before mouse presses', () => {
  vi.useFakeTimers();
  const send = vi.fn(); const pointer = new DesktopPointer(send);
  pointer.move(10, -10, 100, 100); pointer.move(10, 0, 100, 100);
  expect(send).not.toHaveBeenCalled();
  pointer.button('left', true);
  expect(send.mock.calls.map(call => call[0])).toEqual([
    { kind: 'move', x: 0.7, y: 0.4 }, { kind: 'button', button: 'left', down: true },
  ]);
  pointer.dispose(); vi.runAllTimers(); expect(send).toHaveBeenCalledTimes(2);
});
it('closes congested control channels so button releases cannot be silently lost', () => {
  const channel = { readyState: 'open', bufferedAmount: MAX_BUFFERED_INPUT + 1, close: vi.fn(), send: vi.fn() };
  sendDesktopInput(channel as unknown as RTCDataChannel, { kind: 'button', button: 'left', down: false });
  expect(channel.close).toHaveBeenCalled(); expect(channel.send).not.toHaveBeenCalled();
});
it('closes a failed channel without throwing during held input cleanup', () => {
  const channel = { readyState: 'open', bufferedAmount: 0, close: vi.fn(),
    send: vi.fn(() => { throw new Error('The peer went away'); }) };
  const pointer = new DesktopPointer(input => sendDesktopInput(channel as unknown as RTCDataChannel, input));
  expect(() => pointer.button('left', true)).not.toThrow();
  expect(() => pointer.release()).not.toThrow();
  expect(pointer.isHeld('left')).toBe(false);
  expect(channel.close).toHaveBeenCalled();
  pointer.dispose();
});
it('serializes native input, drops stale motion and preserves button ordering', async () => {
  let complete!: () => void;
  const input = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }))
    .mockResolvedValue(undefined);
  const controls = new DesktopControls({ input } as unknown as DesktopCapture, vi.fn());
  controls.receive('{"kind":"move","x":0,"y":0}');
  controls.receive('{"kind":"move","x":0.1,"y":0.1}');
  controls.receive('{"kind":"move","x":0.2,"y":0.2}');
  controls.receive('{"kind":"button","button":"left","down":true}');
  expect(input).toHaveBeenCalledTimes(1);
  complete();
  await vi.waitFor(() => expect(input).toHaveBeenCalledTimes(3));
  expect(input.mock.calls[1][0]).toEqual({ kind: 'move', x: 0.2, y: 0.2 });
  expect(input.mock.calls[2][0]).toEqual({ kind: 'button', button: 'left', down: true });
  controls.close();
});

it('updates the local pointer immediately, before the transport flush, and unsubscribes cleanly', () => {
  vi.useFakeTimers();
  const send = vi.fn(); const pointer = new DesktopPointer(send); const changed = vi.fn();
  const unsubscribe = pointer.subscribe(changed);
  const before = pointer.getSnapshot();
  pointer.move(30, 20, 100, 100);
  expect(pointer.getSnapshot()).toEqual({ x: 0.8, y: 0.7 });
  expect(before).toEqual({ x: 0.5, y: 0.5 });
  expect(changed).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();
  unsubscribe(); pointer.move(1000, -1000, 100, 100);
  expect(pointer.getSnapshot()).toEqual({ x: 1, y: 0 });
  expect(changed).toHaveBeenCalledOnce();
  pointer.dispose(); vi.runAllTimers(); expect(send).not.toHaveBeenCalled();
});
it('places the host pointer at the visible local target before even the first click', () => {
  const send = vi.fn(); const pointer = new DesktopPointer(send);
  pointer.click();
  expect(send.mock.calls.map(call => call[0])).toEqual([
    { kind: 'move', x: 0.5, y: 0.5 },
    { kind: 'button', button: 'left', down: true }, { kind: 'button', button: 'left', down: false },
  ]);
  send.mockClear(); pointer.click('right');
  expect(send.mock.calls[0][0]).toEqual({ kind: 'move', x: 0.5, y: 0.5 });
  pointer.dispose();
});
it('rejects non-finite movement without poisoning later pointer input', () => {
  const pointer = new DesktopPointer(vi.fn());
  pointer.absolute(NaN, Infinity); pointer.move(Infinity, 0, 100, 100);
  expect(pointer.getSnapshot()).toEqual({ x: 0.5, y: 0.5 });
  pointer.dispose();
});
