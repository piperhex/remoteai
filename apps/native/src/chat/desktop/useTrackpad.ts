import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder } from 'react-native';
import { desktopPoint } from '../../../../../shared/remote-desktop/geometry';
import { TRACKPAD_TAP_DISTANCE, type TrackpadOptions } from '../../../../../shared/remote-desktop/trackpad';
import { usePinchZoom } from './usePinchZoom';

export function useTrackpad(options: TrackpadOptions) {
  const latest = useRef(options); latest.current = options;
  const pinch = usePinchZoom(options);
  const [pressed, setPressed] = useState(false);
  const previous = useRef({ dx: 0, dy: 0, x: 0, y: 0, distance: 0, accepted: false });
  useEffect(() => () => {
    const { pointer, panel, id } = latest.current;
    pinch.end(); pointer.release(); panel.hold(id, false);
  }, [options.pointer, options.direct]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Keep a mouse drag in this modal instead of giving it to the chat drawer.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: event => {
      const { pointer, viewport, direct, panel, id } = latest.current;
      const { locationX: x, locationY: y } = event.nativeEvent;
      const target = direct ? desktopPoint({ x, y }, viewport) : undefined;
      previous.current = { dx: 0, dy: 0, x, y, distance: 0, accepted: !!target };
      setPressed(true); panel.hold(id, true);
      if (pinch.start(event)) return;
      if (target) { pointer.absolute(target.x, target.y); pointer.button('left', true); }
    },
    onPanResponderStart: event => { pinch.update(event); },
    onPanResponderEnd: event => { pinch.update(event); },
    onPanResponderMove: (event, gesture) => {
      if (pinch.update(event)) return;
      const { pointer, viewport, direct } = latest.current;
      const before = previous.current;
      const dx = gesture.dx - before.dx; const dy = gesture.dy - before.dy;
      if (direct) {
        const target = before.accepted && desktopPoint({ x: before.x + gesture.dx, y: before.y + gesture.dy }, viewport, true);
        if (target) pointer.absolute(target.x, target.y);
      } else pointer.moveInViewport(dx, dy, viewport);
      previous.current = { ...before, dx: gesture.dx, dy: gesture.dy,
        distance: before.distance + Math.abs(dx) + Math.abs(dy) };
    },
    onPanResponderRelease: () => {
      const { pointer, direct, click = true, panel, id, onTap } = latest.current;
      const pinched = pinch.end();
      const tapped = !direct && !pinched && previous.current.distance < TRACKPAD_TAP_DISTANCE;
      if (direct) { if (previous.current.accepted) pointer.button('left', false); }
      else if (tapped && click && !onTap) pointer.click();
      pointer.flush(); setPressed(false); panel.hold(id, false);
      if (tapped) onTap?.();
    },
    onPanResponderTerminate: () => {
      const { pointer, panel, id, cancel } = latest.current;
      pinch.end(); pointer.release(); cancel?.(); setPressed(false); panel.hold(id, false);
    },
  }), []);
  return { ...responder, pressed };
}
