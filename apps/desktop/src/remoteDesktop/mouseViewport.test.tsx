// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopPointer } from '../../../../shared/remote-desktop/input';
import { cursorPosition, desktopPoint, desktopViewport, MOUSE_PANEL_SIZE, type DesktopViewport, type Point }
  from '../../../../shared/remote-desktop/geometry';
import { useMouseViewport } from '../../../../shared/remote-desktop/useMouseViewport';

const base = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
let pointer: DesktopPointer;
let root: Root;
let viewport: DesktopViewport;
let cursor: Point;
let viewerRenders: number;
let cursorRenders: number;

function Cursor({ viewport }: { viewport: DesktopViewport }) {
  cursorRenders++;
  cursor = cursorPosition(useSyncExternalStore(pointer.subscribe, pointer.getSnapshot), viewport);
  return null;
}
function Viewer() {
  viewerRenders++;
  viewport = useMouseViewport(pointer, base, MOUSE_PANEL_SIZE);
  return <Cursor viewport={viewport} />;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  pointer = new DesktopPointer(vi.fn()); root = createRoot(document.createElement('div'));
  viewerRenders = 0; cursorRenders = 0;
  act(() => root.render(<Viewer />));
});
afterEach(() => { act(() => root.unmount()); pointer.dispose(); vi.unstubAllGlobals(); });

it('moves the local cursor 1:1 without redrawing the entire viewer on each input event', () => {
  const before = { cursor, viewerRenders, cursorRenders };
  for (let step = 0; step < 20; step++) act(() => pointer.moveInViewport(1, -1, viewport));
  expect(cursor.x - before.cursor.x).toBeCloseTo(20);
  expect(cursor.y - before.cursor.y).toBeCloseTo(-20);
  expect(viewerRenders).toBe(before.viewerRenders);
  expect(cursorRenders - before.cursorRenders).toBe(20);
});

it('returns from both edges 1:1 from the first pixel, even before React renders the next frame', () => {
  act(() => pointer.absolute(1, 1));
  const start = cursor;
  const viewBeforeRender = viewport;
  act(() => {
    pointer.moveInViewport(-1, -1, viewBeforeRender);
    const immediate = cursorPosition(pointer.getSnapshot(), pointer.viewport.getSnapshot()!);
    expect(immediate.x - start.x).toBeCloseTo(-1); expect(immediate.y - start.y).toBeCloseTo(-1);
    pointer.moveInViewport(-9, -9, viewBeforeRender);
    pointer.moveInViewport(4, 4, viewBeforeRender);
    pointer.moveInViewport(-3, -3, viewBeforeRender);
  });
  expect(cursor.x - start.x).toBeCloseTo(-9); expect(cursor.y - start.y).toBeCloseTo(-9);
  const target = desktopPoint(cursor, viewport)!;
  expect(target.x).toBeCloseTo(pointer.getSnapshot().x); expect(target.y).toBeCloseTo(pointer.getSnapshot().y);
  expect(cursor.x + 24 + MOUSE_PANEL_SIZE.width).toBeLessThanOrEqual(base.stage.width - 8);
  expect(cursor.y + MOUSE_PANEL_SIZE.height).toBeLessThanOrEqual(base.stage.height - 8);
});

it('keeps gesture distance consistent across margin closure and different event sizes', () => {
  const trace = (steps: number) => {
    const input = new DesktopPointer(vi.fn());
    input.viewport.configure({ base, panel: MOUSE_PANEL_SIZE, manual: false }); input.absolute(1, 1);
    const stale = input.viewport.getSnapshot()!;
    const start = cursorPosition(input.getSnapshot(), stale);
    for (let step = 0; step < steps; step++) input.moveInViewport(-170 / steps, -170 / steps, stale);
    const final = input.viewport.getSnapshot()!;
    const end = cursorPosition(input.getSnapshot(), final);
    input.dispose();
    expect(end.x - start.x).toBeCloseTo(-170); expect(end.y - start.y).toBeCloseTo(-170);
    expect(final.content).toEqual(base.content);
    return end;
  };
  const single = trace(1); const multiple = trace(17);
  expect(single.x).toBeCloseTo(multiple.x); expect(single.y).toBeCloseTo(multiple.y);
});
