import { useEffect, useRef, type PointerEvent } from 'react';
import { desktopPoint } from '../../../../../shared/remote-desktop/geometry';
import { TRACKPAD_TAP_DISTANCE, type TrackpadOptions } from '../../../../../shared/remote-desktop/trackpad';
import { usePinchZoom } from './usePinchZoom';

export function useTrackpad({ pointer, viewport, direct, click = true, panel, id, cancel, zoom, onTap }: TrackpadOptions) {
  const pinch = usePinchZoom({ pointer, viewport, zoom });
  const gesture = useRef<{ id: number; x: number; y: number; distance: number; accepted: boolean }>();
  useEffect(() => () => {
    pinch.reset();
    if (!gesture.current) return;
    gesture.current = undefined; pointer.release(); panel.hold(id, false);
  }, [pointer, direct, panel.hold, id]);
  const point = (event: PointerEvent<HTMLElement>, outside = false) => {
    const bounds = event.currentTarget.closest('.rd-stage')!.getBoundingClientRect();
    return desktopPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, viewport, outside);
  };
  const end = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const { pinched, pending } = pinch.end(event);
    if (pinched) {
      if (!pending) { pointer.flush(); gesture.current = undefined; panel.hold(id, false); }
      return;
    }
    if (gesture.current?.id !== event.pointerId) return;
    const tapped = !cancelled && !direct && gesture.current.distance < TRACKPAD_TAP_DISTANCE;
    if (cancelled) { pointer.release(); cancel?.(); }
    else if (direct) { if (gesture.current.accepted) pointer.button('left', false); }
    else if (tapped && click && !onTap) pointer.click();
    pointer.flush(); gesture.current = undefined; panel.hold(id, false);
    if (tapped) onTap?.();
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (pinch.start(event)) { event.preventDefault(); return; }
      if (gesture.current) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      const target = direct ? point(event) : undefined;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, accepted: !!target };
      panel.hold(id, true);
      if (target) { pointer.absolute(target.x, target.y); pointer.button('left', true); }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (pinch.move(event)) return;
      const previous = gesture.current;
      if (!previous || previous.id !== event.pointerId) return;
      const dx = event.clientX - previous.x; const dy = event.clientY - previous.y;
      if (direct) {
        const target = previous.accepted && point(event, true);
        if (target) pointer.absolute(target.x, target.y);
      } else pointer.moveInViewport(dx, dy, viewport);
      gesture.current = { ...previous, x: event.clientX, y: event.clientY,
        distance: previous.distance + Math.abs(dx) + Math.abs(dy) };
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => end(event),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => end(event, true),
  };
}
