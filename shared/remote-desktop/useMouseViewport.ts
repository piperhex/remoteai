import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { DesktopPointer } from './input';
import { panDesktopViewport, type DesktopPanState, type DesktopViewport, type Point, type Size } from './geometry';

interface MouseViewport { viewport: DesktopViewport; panelPosition?: Point }

/** Keep video and controls in one pan update without changing the cursor's remote input mapping. */
export function useMouseViewport(pointer: DesktopPointer, base: DesktopViewport, panel?: Size,
  manual = false): MouseViewport {
  const point = useSyncExternalStore(pointer.subscribe, pointer.getSnapshot);
  const previous = useRef<{ dimensions: string; pan: DesktopPanState } | undefined>(undefined);
  const dimensions = [base.stage.width, base.stage.height, base.content.width, base.content.height,
    base.content.x, base.content.y].join(':');
  const pan = previous.current?.dimensions === dimensions ? previous.current.pan : undefined;
  // A magnified view belongs to the fingers. Even a zero-distance mouse event must not recenter it.
  const result: DesktopPanState & MouseViewport = panel && !manual ? panDesktopViewport(base, point, panel, pan)
    : { viewport: base, point, offset: { x: 0, y: 0 } };
  useLayoutEffect(() => {
    previous.current = { dimensions, pan: { offset: result.offset, point, panelAnchorY: result.panelAnchorY } };
  }, [dimensions, result.offset.x, result.offset.y, result.panelAnchorY, point]);
  return { viewport: result.viewport, panelPosition: result.panelPosition };
}
