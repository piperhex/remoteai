import { useRef, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import type { Point } from './imageTransform';

const CLICK_TOLERANCE = 5;
const position = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY });
const moved = (start: Point, end: Point) => Math.hypot(end.x - start.x, end.y - start.y) > CLICK_TOLERANCE;

function containsImagePoint(image: HTMLImageElement | null | undefined, point: Point) {
  if (!image?.naturalWidth || !image.naturalHeight) return false;
  const bounds = image.getBoundingClientRect();
  const inverse = new DOMMatrixReadOnly(getComputedStyle(image).transform).inverse();
  const x = point.x - bounds.x - bounds.width / 2;
  const y = point.y - bounds.y - bounds.height / 2;
  const fit = Math.min(image.clientWidth / image.naturalWidth, image.clientHeight / image.naturalHeight);
  // The <img> fills the stage in chat previews. Only its contained, transformed pixels count as the image.
  return Math.abs(inverse.a * x + inverse.c * y) <= image.naturalWidth * fit / 2
    && Math.abs(inverse.b * x + inverse.d * y) <= image.naturalHeight * fit / 2;
}

/** Dismiss on a background click while keeping captured drags, pinches and image clicks intact. */
export function useImageBackdropDismiss(stage: RefObject<HTMLDivElement>, close: () => void) {
  const pressed = useRef<Point>();
  const released = useRef<Point>();
  const onImage = (point: Point) => containsImagePoint(stage.current?.querySelector('img'), point);
  const cancel = () => { pressed.current = undefined; released.current = undefined; };

  return {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
      cancel();
      if (event.button === 0 && event.isPrimary && !onImage(position(event))) pressed.current = position(event);
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (pressed.current && moved(pressed.current, position(event))) pressed.current = undefined;
    },
    onPointerUpCapture: (event: PointerEvent<HTMLDivElement>) => {
      released.current = pressed.current && !moved(pressed.current, position(event)) ? pressed.current : undefined;
      pressed.current = undefined;
    },
    onPointerCancelCapture: cancel,
    onLostPointerCaptureCapture: () => { pressed.current = undefined; },
    onContextMenuCapture: cancel,
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      const start = released.current;
      cancel();
      if (!start || moved(start, position(event)) || onImage(position(event))) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    },
  };
}
