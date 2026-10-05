import { expect, it } from 'vitest';
import { cursorPosition, desktopPoint, desktopViewport, mousePanelPosition,
  MOUSE_PANEL_SIZE, MOUSE_ICON_SIZE, panDesktopViewport, type DesktopPanState }
  from '../../../../shared/remote-desktop/geometry';

it('maps touches and the virtual hotspot through portrait letterboxing', () => {
  const viewport = desktopViewport({ width: 400, height: 800 }, { width: 1600, height: 900 });
  expect(viewport.content).toEqual({ x: 0, y: 287.5, width: 400, height: 225 });
  expect(desktopPoint({ x: 100, y: 100 }, viewport)).toBeUndefined();
  for (const point of [{ x: 0, y: 0 }, { x: 0.25, y: 0.75 }, { x: 1, y: 1 }]) {
    expect(desktopPoint(cursorPosition(point, viewport), viewport)).toEqual(point);
  }
  expect(desktopPoint({ x: 600, y: 1000 }, viewport, true)).toEqual({ x: 1, y: 1 });
});
it('keeps a following panel in black letterboxing instead of clamping to the video', () => {
  const viewport = desktopViewport({ width: 844, height: 600 }, { width: 1920, height: 1080 });
  const cursor = cursorPosition({ x: 0.5, y: 0.95 }, viewport);
  const panel = mousePanelPosition(cursor);
  expect(panel).toEqual({ x: cursor.x + 24, y: cursor.y });
  expect(panel.y + MOUSE_PANEL_SIZE.height).toBeGreaterThan(viewport.content.y + viewport.content.height);
});
it('keeps the panel attached even when zoom moves the cursor outside the stage', () => {
  expect(mousePanelPosition({ x: -1000, y: -500 })).toEqual({ x: -976, y: -500 });
  expect(mousePanelPosition({ x: 2000, y: 1500 })).toEqual({ x: 2024, y: 1500 });
});
it('keeps the same pointer-to-panel offset independent of viewport edges', () => {
  for (const stage of [{ width: 390, height: 750 }, { width: 774, height: 390 }, { width: 1352, height: 900 }]) {
    const viewport = desktopViewport(stage, { width: 1600, height: 900 });
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
      const cursor = cursorPosition(point, viewport);
      const panel = mousePanelPosition(cursor);
      expect(panel).toEqual({ x: cursor.x + 24, y: cursor.y });
    }
    const cursor = cursorPosition({ x: 1, y: 1 }, viewport);
    const panel = mousePanelPosition(cursor);
    expect(panel.x + MOUSE_PANEL_SIZE.width).toBeGreaterThan(stage.width);
  }
});

it('keeps the hotspot on the desktop and its panel attached while panning at the edges', () => {
  for (const stage of [{ width: 390, height: 750 }, { width: 774, height: 390 }, { width: 1352, height: 900 }]) {
    const fitted = desktopViewport(stage, { width: 1600, height: 900 });
    let previous: DesktopPanState | undefined;
    for (const point of [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }]) {
      const result = panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE, previous);
      const cursor = cursorPosition(point, result.viewport);
      const panel = mousePanelPosition(cursor);
      expect(cursor.x).toBeGreaterThanOrEqual(8); expect(cursor.y).toBeGreaterThanOrEqual(8);
      expect(panel.x - cursor.x).toBeCloseTo(24); expect(panel.y).toBe(cursor.y);
      expect(panel.x + MOUSE_PANEL_SIZE.width).toBeLessThanOrEqual(stage.width - 8);
      expect(panel.y + MOUSE_PANEL_SIZE.height).toBeLessThanOrEqual(stage.height - 8);
      expect(result.viewport.content.width).toBe(fitted.content.width);
      expect(result.viewport.content.height).toBe(fitted.content.height);
      const mapped = desktopPoint(cursor, result.viewport)!;
      expect(mapped.x).toBeCloseTo(point.x); expect(mapped.y).toBeCloseTo(point.y);
      previous = result;
    }
  }
});

it('does not recenter on idle collapse or expansion', () => {
  const fitted = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
  const zero = { x: 0, y: 0 };
  expect(panDesktopViewport(fitted, { x: 0.5, y: 0.5 }, MOUSE_PANEL_SIZE).offset).toEqual(zero);
  const edge = panDesktopViewport(fitted, { x: 1, y: 1 }, MOUSE_PANEL_SIZE);
  expect(edge.offset.x).toBeLessThan(0); expect(edge.offset.y).toBeLessThan(0);
  const collapsed = panDesktopViewport(fitted, edge.point, MOUSE_ICON_SIZE, edge);
  expect(collapsed.offset).toEqual(edge.offset);
  expect(panDesktopViewport(fitted, edge.point, MOUSE_PANEL_SIZE, collapsed).offset).toEqual(edge.offset);
});

it('pans the desktop far enough to keep the attached panel inside the viewer', () => {
  const fitted = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
  const zero = { x: 0, y: 0 };
  const bottom = 450 - 8 - MOUSE_PANEL_SIZE.height;
  const edge = { x: 0.5, y: bottom / 449 };
  expect(panDesktopViewport(fitted, edge, MOUSE_PANEL_SIZE).offset).toEqual(zero);
  const point = { ...edge, y: (bottom + 20) / 449 };
  const down = panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE);
  expect(down.offset).toEqual({ x: 0, y: -20 });
  const cursor = cursorPosition(point, down.viewport);
  expect(desktopPoint(cursor, down.viewport)!.y).toBeCloseTo(point.y);
  expect(mousePanelPosition(cursor)).toEqual({ x: cursor.x + 24, y: cursor.y });
  const right = panDesktopViewport(fitted, { x: (800 - 8 - 24 - MOUSE_PANEL_SIZE.width + 20) / 799, y: 0.5 },
    MOUSE_PANEL_SIZE);
  expect(right.offset).toEqual({ x: -20, y: 0 });
  const full = panDesktopViewport(fitted, { ...edge, y: 1 }, MOUSE_PANEL_SIZE, down);
  expect(full.offset.y).toBe(bottom - 449);
  expect(cursorPosition({ ...edge, y: 1 }, full.viewport).y + MOUSE_PANEL_SIZE.height).toBe(450 - 8);
});

it('uses existing bottom letterboxing before opening more canvas, and preserves the assisted offset', () => {
  const fitted = desktopViewport({ width: 800, height: 500 }, { width: 1600, height: 900 });
  const zero = { x: 0, y: 0 };
  const edge = { x: 0.5, y: (500 - 8 - MOUSE_PANEL_SIZE.height - fitted.content.y) / 449 };
  expect(panDesktopViewport(fitted, edge, MOUSE_PANEL_SIZE).offset).toEqual(zero);
  const point = { ...edge, y: edge.y + 15 / 449 };
  const assisted = panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE);
  expect(assisted.offset.y).toBeCloseTo(-15);
  expect(panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE, assisted).offset).toEqual(assisted.offset);
  expect(panDesktopViewport(fitted, point, MOUSE_ICON_SIZE, assisted).offset).toEqual(assisted.offset);
  const portrait = desktopViewport({ width: 390, height: 750 }, { width: 1600, height: 900 });
  expect(panDesktopViewport(portrait, { x: 0.5, y: 1 }, MOUSE_PANEL_SIZE).offset.y).toBe(0);
});

it('restores the bottom canvas with the attached panel and stops at the fitted position', () => {
  const fitted = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
  const bottom = 450 - 8 - MOUSE_PANEL_SIZE.height;
  const down = panDesktopViewport(fitted, { x: 0.5, y: (bottom + 20) / 449 }, MOUSE_PANEL_SIZE);
  const up = panDesktopViewport(fitted, { x: 0.5, y: (bottom + 10) / 449 }, MOUSE_PANEL_SIZE, down);
  expect(up.offset.y - down.offset.y).toBeCloseTo(10);
  expect(panDesktopViewport(fitted, up.point, MOUSE_PANEL_SIZE, up).offset).toEqual(up.offset);
  expect(panDesktopViewport(fitted, up.point, MOUSE_ICON_SIZE, up).offset).toEqual(up.offset);
  const restored = panDesktopViewport(fitted, { x: 0.5, y: 0.5 }, MOUSE_PANEL_SIZE, up);
  expect(restored.offset.y).toBe(0);
  expect(restored.viewport.content).toEqual(fitted.content);
});

it('restores from the bottom cap without changing the target or drifting on repeated renders', () => {
  const fitted = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
  let previous = panDesktopViewport(fitted, { x: 0.5, y: 1 }, MOUSE_PANEL_SIZE);
  for (const y of [0.98, 0.9, 0.8, 0.7, 0.6]) {
    const point = { x: 0.5, y };
    const current = panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE, previous);
    expect(current.offset.y).toBeGreaterThanOrEqual(previous.offset.y);
    expect(current.offset.y).toBeLessThanOrEqual(0);
    const cursor = cursorPosition(point, current.viewport);
    expect(mousePanelPosition(cursor).y).toBe(cursor.y);
    expect(desktopPoint(cursor, current.viewport)!.y).toBeCloseTo(y);
    expect(panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE, current).offset).toEqual(current.offset);
    previous = current;
  }
  expect(previous.offset.y).toBe(0);
});

it('does not jump back to the bottom cap when reversing downward again', () => {
  const fitted = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
  const full = panDesktopViewport(fitted, { x: 0.5, y: 1 }, MOUSE_PANEL_SIZE);
  const up = panDesktopViewport(fitted, { x: 0.5, y: 0.9 }, MOUSE_PANEL_SIZE, full);
  const down = panDesktopViewport(fitted, { x: 0.5, y: 0.9 + 1 / 449 }, MOUSE_PANEL_SIZE, up);
  expect(up.offset.y - down.offset.y).toBeCloseTo(1);
  expect(panDesktopViewport(fitted, down.point, MOUSE_PANEL_SIZE, down).offset).toEqual(down.offset);
});
