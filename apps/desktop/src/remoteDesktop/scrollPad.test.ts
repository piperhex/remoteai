import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScrollPadController, SCROLL_PAD_INTERVAL, scrollPadLayout }
  from '../../../../shared/remote-desktop/scrollPad';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup(horizontal = true) {
  const options = { horizontal, wheel: vi.fn(), change: vi.fn(), close: vi.fn() };
  return { ...options, control: new ScrollPadController(options) };
}
it('scrolls in all four directions and uses the dominant axis for diagonal drags', () => {
  const { control, wheel } = setup();
  for (const [x, y, delta, horizontal] of [
    [0, -60, 120, false], [0, 60, -120, false], [-60, 0, -120, true], [60, 20, 120, true],
  ] as const) {
    control.start({ x: 0, y: 0 }); control.move({ x, y });
    expect(wheel).toHaveBeenLastCalledWith(delta, horizontal);
    control.end();
  }
  expect(vi.getTimerCount()).toBe(0);
});
it('accelerates with distance, repeats while held and immediately stops when recentered or released', () => {
  const { control, wheel, change, close } = setup();
  control.start({ x: 0, y: 0 }); control.move({ x: 0, y: 20 });
  const slow = Math.abs(wheel.mock.lastCall![0]);
  control.move({ x: 0, y: 200 }); vi.advanceTimersByTime(SCROLL_PAD_INTERVAL * 3);
  expect(wheel).toHaveBeenLastCalledWith(-120, false); expect(slow).toBeLessThan(120);
  expect(change).toHaveBeenLastCalledWith({ x: 0, y: 60 });
  const count = wheel.mock.calls.length;
  control.move({ x: 4, y: -2 }); vi.advanceTimersByTime(1000); expect(wheel).toHaveBeenCalledTimes(count);
  control.move({ x: -60, y: 0 }); control.end();
  expect(change).toHaveBeenLastCalledWith({ x: 0, y: 0 });
  vi.advanceTimersByTime(1000); expect(wheel).toHaveBeenCalledTimes(count + 1); expect(close).toHaveBeenCalledOnce();
});
it('dismisses every completed gesture once and never scrolls after cancellation', () => {
  const { control, wheel, close } = setup();
  control.start({ x: 2, y: 1 }); control.end(); expect(close).toHaveBeenCalledOnce();
  control.start({ x: 0, y: 60 }); control.end(); expect(close).toHaveBeenCalledTimes(2);
  control.start({ x: 60, y: 0 }); control.stop(); control.end();
  control.move({ x: 0, y: -60 }); vi.advanceTimersByTime(1000);
  expect(close).toHaveBeenCalledTimes(2); expect(wheel).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});
it('does not turn horizontal gestures into vertical scrolling on an older host', () => {
  const { control, wheel } = setup(false);
  control.start({ x: 60, y: 20 }); vi.advanceTimersByTime(500); expect(wheel).not.toHaveBeenCalled();
  control.move({ x: 0, y: 60 }); expect(wheel).toHaveBeenLastCalledWith(-120, false); control.stop();
});
it('fits the complete cross inside portrait, landscape and tiny stages even when the cursor is offscreen', () => {
  for (const stage of [{ width: 390, height: 750 }, { width: 774, height: 390 }, { width: 150, height: 100 }]) {
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }]) {
      const result = scrollPadLayout({ stage, content: { x: -400, y: -300, width: 1600, height: 900 } }, point);
      expect(result.x).toBeGreaterThanOrEqual(8); expect(result.y).toBeGreaterThanOrEqual(8);
      expect(result.x + result.size).toBeLessThanOrEqual(stage.width - 8);
      expect(result.y + result.size).toBeLessThanOrEqual(stage.height - 8);
    }
  }
});

it('opens the scroll cross over the panel when bottom panning separates it from the cursor', () => {
  const viewport = { stage: { width: 800, height: 450 },
    content: { x: 0, y: -40, width: 800, height: 450 } };
  const panel = { x: 420, y: 240 };
  const layout = scrollPadLayout(viewport, { x: 0.5, y: 0.9 }, panel);
  expect(layout.x + layout.size / 2).toBe(panel.x + 60);
  expect(layout.y + layout.size / 2).toBe(panel.y + 32);
});
