import { afterEach, expect, it, vi } from 'vitest';
import { DesktopPointer } from '../../../../shared/remote-desktop/input';
import { cursorPosition, desktopPoint, desktopViewport, mousePanelPosition, MOUSE_PANEL_SIZE, MOUSE_ICON_SIZE,
  type Point, panDesktopViewport } from '../../../../shared/remote-desktop/geometry';

const fitted = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
const right = 800 - 8 - 24 - MOUSE_PANEL_SIZE.width;
const bottom = 450 - 8 - MOUSE_PANEL_SIZE.height;
const pointers: DesktopPointer[] = [];
afterEach(() => { pointers.splice(0).forEach(pointer => pointer.dispose()); });

function setup(position: Point) {
  const send = vi.fn();
  const pointer = new DesktopPointer(send); pointers.push(pointer);
  pointer.absolute(position.x / 799, position.y / 449);
  let pan = panDesktopViewport(fitted, pointer.getSnapshot(), MOUSE_PANEL_SIZE);
  const snapshot = () => {
    const cursor = cursorPosition(pointer.getSnapshot(), pan.viewport);
    return { cursor, panel: mousePanelPosition(cursor), video: pan.viewport.content };
  };
  const move = (delta: Point) => {
    pointer.moveInViewport(delta.x, delta.y, pan.viewport);
    pan = panDesktopViewport(fitted, pointer.getSnapshot(), MOUSE_PANEL_SIZE, pan);
    return snapshot();
  };
  return { pointer, send, move, snapshot, current: () => pan };
}

it('keeps normal pointer and panel speed away from the right and bottom edges', () => {
  const test = setup({ x: 300, y: 200 });
  const before = test.snapshot();
  const after = test.move({ x: 20, y: 15 });
  expect(after.video).toEqual(before.video);
  expect(after.cursor.x - before.cursor.x).toBeCloseTo(20);
  expect(after.cursor.y - before.cursor.y).toBeCloseTo(15);
  expect(after.panel.x - after.cursor.x).toBe(24); expect(after.panel.y).toBe(after.cursor.y);
});

it.each([
  { axis: 'x' as const, position: { x: right, y: 200 }, delta: { x: 10, y: 0 }, speed: 1 },
  { axis: 'y' as const, position: { x: 300, y: bottom }, delta: { x: 0, y: 10 }, speed: 2 },
])('moves the attached panel forward at the exposed margin speed on $axis', ({ axis, position, delta, speed }) => {
  const test = setup(position);
  const before = test.snapshot();
  const after = test.move(delta);
  const travel = after.panel[axis] - before.panel[axis];
  expect(travel).toBeCloseTo(delta[axis] * speed);
  expect(travel).toBeCloseTo(before.video[axis] - after.video[axis]);
  expect(after.panel.x - after.cursor.x).toBe(24); expect(after.panel.y).toBe(after.cursor.y);
  const returned = test.move({ x: -delta.x, y: -delta.y });
  expect(returned.video.x).toBeCloseTo(before.video.x); expect(returned.video.y).toBeCloseTo(before.video.y);
  expect(returned.panel.x).toBeCloseTo(before.panel.x); expect(returned.panel.y).toBeCloseTo(before.panel.y);
});

it('applies assistance only after crossing an edge, independent of gesture event size', () => {
  const single = setup({ x: right - 5, y: bottom - 5 });
  const small = setup({ x: right - 5, y: bottom - 5 });
  const before = single.snapshot();
  const after = single.move({ x: 10, y: 10 });
  for (let step = 0; step < 10; step++) small.move({ x: 1, y: 1 });
  expect(after.panel.x - before.panel.x).toBeCloseTo(10);
  expect(after.panel.y - before.panel.y).toBeCloseTo(15);
  expect(before.video.x - after.video.x).toBeCloseTo(5);
  expect(before.video.y - after.video.y).toBeCloseTo(10);
  expect(small.snapshot().panel.x).toBeCloseTo(after.panel.x);
  expect(small.snapshot().panel.y).toBeCloseTo(after.panel.y);
});

it('handles both edges together without changing the click target or clamping the panel separately', () => {
  const test = setup({ x: right, y: bottom });
  const before = test.snapshot();
  const after = test.move({ x: 10, y: 10 });
  expect(after.panel.x - before.panel.x).toBeCloseTo(10);
  expect(after.panel.y - before.panel.y).toBeCloseTo(20);
  test.pointer.click();
  const mapped = desktopPoint(after.cursor, test.current().viewport)!;
  expect(mapped.x).toBeCloseTo(test.pointer.getSnapshot().x);
  expect(mapped.y).toBeCloseTo(test.pointer.getSnapshot().y);
  expect(test.send.mock.calls.at(-3)![0]).toEqual({ kind: 'move', ...test.pointer.getSnapshot() });
  const capped = test.move({ x: 1000, y: 1000 });
  expect(capped.panel.x + MOUSE_PANEL_SIZE.width).toBeGreaterThan(fitted.stage.width);
  expect(capped.panel.y + MOUSE_PANEL_SIZE.height).toBeGreaterThan(fitted.stage.height);
  expect(capped.panel.x - capped.cursor.x).toBe(24); expect(capped.panel.y).toBe(capped.cursor.y);
  expect(test.move({ x: 20, y: 20 })).toEqual(capped);
  const idle = panDesktopViewport(fitted, test.pointer.getSnapshot(), MOUSE_ICON_SIZE, test.current());
  expect(idle.viewport.content).toEqual(capped.video);
});

it('does not apply edge acceleration to a manually zoomed or direct-touch viewport', () => {
  const pointer = new DesktopPointer(vi.fn()); pointers.push(pointer);
  const viewport = { stage: fitted.stage, content: { x: -500, y: -300, width: 2400, height: 1350 } };
  const before = cursorPosition(pointer.getSnapshot(), viewport);
  pointer.moveInViewport(10, 20, viewport);
  const after = cursorPosition(pointer.getSnapshot(), viewport);
  expect(after.x - before.x).toBeCloseTo(10); expect(after.y - before.y).toBeCloseTo(20);
});
