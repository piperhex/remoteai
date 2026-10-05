import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { DesktopPointer } from './input';
import { panDesktopViewport, type DesktopPanState, type DesktopViewport, type Size } from './geometry';

/** Share the translated video rectangle with drawing, local cursor placement and input mapping. */
export function useMouseViewport(pointer: DesktopPointer, base: DesktopViewport, panel?: Size,
  manual = false): DesktopViewport {
  const point = useSyncExternalStore(pointer.subscribe, pointer.getSnapshot);
  const previous = useRef<{ dimensions: string; pan: DesktopPanState } | undefined>(undefined);
  const dimensions = [base.stage.width, base.stage.height, base.content.width, base.content.height,
    base.content.x, base.content.y].join(':');
  const pan = previous.current?.dimensions === dimensions ? previous.current.pan : undefined;
  // A magnified view belongs to the fingers. Even a zero-distance mouse event must not recenter it.
  const result = panel && !manual ? panDesktopViewport(base, point, panel, pan)
    : { viewport: { stage: base.stage, content: base.content }, point, offset: { x: 0, y: 0 }, edge: undefined };
  useLayoutEffect(() => { previous.current = { dimensions, pan: { offset: result.offset, point, edge: result.edge } }; },
    [dimensions, result.offset.x, result.offset.y, result.edge?.x, result.edge?.y, point]);
  return result.viewport;
}
