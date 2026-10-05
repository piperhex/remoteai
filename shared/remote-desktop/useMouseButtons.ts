import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopPointer } from './input';
import type { DesktopViewport } from './geometry';
import { TRACKPAD_TAP_DISTANCE } from './trackpad';

const DRAG_DELAY = 500;

/** Sliding the held left button drags immediately; a stationary long press latches it for the trackpad. */
export function useMouseButtons(pointer: DesktopPointer) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const locked = useRef(false);
  const press = useRef({ active: false, distance: 0 });
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const unsubscribe = pointer.subscribe(() => {
      if (!pointer.isHeld('left')) {
        clearTimeout(timer.current); locked.current = false; press.current.active = false; setDragging(false);
      }
    });
    return () => { unsubscribe(); clearTimeout(timer.current); pointer.release(); };
  }, [pointer]);
  const down = (button: 'left' | 'right') => {
    if (button === 'left' && locked.current) {
      locked.current = false; setDragging(false); pointer.button('left', false); return;
    }
    pointer.button(button, true);
    if (button === 'left') {
      press.current = { active: true, distance: 0 };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { locked.current = true; setDragging(true); }, DRAG_DELAY);
    }
  };
  const move = (dx: number, dy: number, viewport: DesktopViewport) => {
    if (!press.current.active || !pointer.isHeld('left') || (!dx && !dy)) return;
    press.current.distance += Math.abs(dx) + Math.abs(dy);
    if (press.current.distance >= TRACKPAD_TAP_DISTANCE) {
      clearTimeout(timer.current); locked.current = false; setDragging(true);
    }
    pointer.moveInViewport(dx, dy, viewport);
  };
  const up = (button: 'left' | 'right') => {
    if (button === 'left') { clearTimeout(timer.current); press.current.active = false; }
    if (button !== 'left' || !locked.current) pointer.button(button, false);
  };
  const cancel = useCallback(() => {
    clearTimeout(timer.current); locked.current = false; setDragging(false);
    press.current.active = false;
    pointer.button('left', false); pointer.button('right', false);
  }, [pointer]);
  return { down, move, up, cancel, dragging };
}

export type MouseButtonControls = ReturnType<typeof useMouseButtons>;
