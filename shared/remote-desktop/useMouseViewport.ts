import { useLayoutEffect, useSyncExternalStore } from 'react';
import type { DesktopPointer } from './input';
import type { DesktopViewport, Size } from './geometry';
import { mouseViewportKey } from './mouseViewport';

/** Share the translated video rectangle with drawing, local cursor placement and input mapping. */
export function useMouseViewport(pointer: DesktopPointer, base: DesktopViewport, panel?: Size,
  manual = false): DesktopViewport {
  const options = { base, panel, manual };
  const key = mouseViewportKey(options);
  useSyncExternalStore(pointer.subscribe, pointer.viewport.getSnapshot);
  useLayoutEffect(() => { pointer.viewport.configure(options); }, [pointer, key]);
  useLayoutEffect(() => () => pointer.viewport.clear(), [pointer]);
  return pointer.viewport.preview(options);
}
