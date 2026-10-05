import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Point, DesktopViewport } from './geometry';
import type { DesktopPointer } from './input';
import type { MousePanelActivity } from './useMousePanel';
import { SCROLL_PAD_SIZE, ScrollPadController, scrollPadLayout, type DesktopWheel } from './scrollPad';

interface Options {
  pointer: DesktopPointer; viewport: DesktopViewport; panel: MousePanelActivity;
  wheel: DesktopWheel; horizontal: boolean; enabled: boolean; panelPosition?: Point;
}
export interface ScrollPadProps {
  layout: ReturnType<typeof scrollPadLayout>; position: Point; horizontal: boolean; cancel: () => void;
}
export function useScrollPad({ wheel, horizontal, panel, pointer, viewport, enabled, panelPosition }: Options) {
  const callbacks = useRef({ wheel, panel }); callbacks.current = { wheel, panel };
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const layout = scrollPadLayout(viewport, pointer.getSnapshot(), panelPosition);
  const controller = useMemo(() => new ScrollPadController({ horizontal, change: setPosition,
    wheel: (delta, axis) => callbacks.current.wheel(delta, axis),
    close: () => { setActive(false); callbacks.current.panel.hold('scroll', false); } }), [horizontal]);
  const end = useCallback(() => controller.end(), [controller]);
  // Keep the mouse button mounted to own the touch while the cross replaces its appearance.
  useEffect(() => end, [end, enabled, pointer, viewport.stage.width, viewport.stage.height]);
  const start = () => {
    if (!enabled) return;
    pointer.release(); panel.hold('scroll', true); controller.start({ x: 0, y: 0 }); setActive(true);
  };
  const move = (point: Point) => controller.move({
    x: point.x * SCROLL_PAD_SIZE / layout.size, y: point.y * SCROLL_PAD_SIZE / layout.size,
  });
  return { active, position, layout, start, move, end };
}

export type ScrollPadGesture = ReturnType<typeof useScrollPad>;
