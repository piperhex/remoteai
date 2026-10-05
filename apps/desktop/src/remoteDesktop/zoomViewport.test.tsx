// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopPointer } from '../../../../shared/remote-desktop/input';
import { desktopViewport, MOUSE_PANEL_SIZE, type DesktopViewport } from '../../../../shared/remote-desktop/geometry';
import { useDesktopZoom } from '../../../../shared/remote-desktop/useDesktopZoom';
import { useMouseViewport } from '../../../../shared/remote-desktop/useMouseViewport';

let root: Root;
let pointer: DesktopPointer;
let zoom: ReturnType<typeof useDesktopZoom>;
let viewport: DesktopViewport;
const landscape = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
const portrait = desktopViewport({ width: 400, height: 800 }, { width: 1600, height: 900 });
function Harness({ base = landscape, active = true }) {
  zoom = useDesktopZoom(base, active);
  viewport = useMouseViewport(pointer, zoom.viewport, MOUSE_PANEL_SIZE, zoom.modified);
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  pointer = new DesktopPointer(vi.fn()); root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); pointer.dispose(); vi.unstubAllGlobals(); });
function enlarge() {
  act(() => zoom.gestures.start([{ x: 200, y: 150 }, { x: 300, y: 150 }], viewport));
  act(() => zoom.gestures.move([{ x: 100, y: 150 }, { x: 400, y: 150 }]));
  act(() => zoom.gestures.end());
}

it('holds an off-center zoom steady through mouse motion, repeated gestures and rerenders', () => {
  enlarge();
  expect(viewport.content).toEqual({ x: -500, y: -300, width: 2400, height: 1350 });
  const manual = viewport;
  act(() => root.render(<Harness />)); expect(viewport).toEqual(manual);
  act(() => pointer.move(0, 0, viewport.content.width - 1, viewport.content.height - 1));
  expect(viewport).toEqual(manual);
  act(() => pointer.move(1, 1, viewport.content.width - 1, viewport.content.height - 1));
  expect(viewport).toEqual(manual);
  act(() => pointer.absolute(1, 1)); expect(viewport).toEqual(manual);
  act(() => zoom.gestures.start([{ x: 200, y: 150 }, { x: 300, y: 150 }], viewport));
  expect(viewport).toEqual(manual);
  act(() => zoom.gestures.move([{ x: 200, y: 150 }, { x: 300, y: 150 }]));
  act(() => zoom.gestures.end()); expect(viewport).toEqual(manual);
  act(() => root.render(<Harness />)); expect(viewport).toEqual(manual);
});

it('restores mouse edge assistance after shrinking to the fitted size', () => {
  enlarge();
  act(() => zoom.gestures.start([{ x: 100, y: 150 }, { x: 400, y: 150 }], viewport));
  act(() => zoom.gestures.move([{ x: 240, y: 150 }, { x: 260, y: 150 }]));
  act(() => zoom.gestures.end());
  expect(viewport).toMatchObject(landscape);
  act(() => pointer.absolute(1, 1));
  expect(viewport.content.x).toBeLessThan(0); expect(viewport.content.y).toBeLessThan(0);
});

it('resets zoom on rotation and closing, including a rotation back to the old dimensions', () => {
  enlarge();
  act(() => root.render(<Harness base={portrait} />)); expect(viewport).toMatchObject(portrait);
  act(() => root.render(<Harness />)); expect(viewport).toMatchObject(landscape);
  enlarge();
  act(() => root.render(<Harness active={false} />));
  act(() => root.render(<Harness />)); expect(viewport).toMatchObject(landscape);
});
