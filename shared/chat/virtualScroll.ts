import { useLayoutEffect, type MutableRefObject, type RefObject } from 'react';
import type { ScrollMovement } from './useScrollMovement';

const VIRTUAL_LAYOUT_RESTORED = 'chat-virtual-layout-restored';
const BOTTOM_TOLERANCE = 2;

export interface VirtualScrollAnchor { root: Element; bottom: boolean; anchor?: Element; top: number; offset: number }

/** Explicit follow state survives height changes that temporarily clamp a paused reader to the bottom. */
export function captureVirtualScroll(root: Element | null, following?: boolean): VirtualScrollAnchor | null {
  if (!root) return null;
  const bottom = following ?? (!root.hasAttribute('data-history-newer')
    && root.scrollHeight - root.scrollTop - root.clientHeight <= BOTTOM_TOLERANCE);
  const top = root.getBoundingClientRect().top;
  const anchor = bottom ? undefined : [...root.querySelectorAll('[data-message-id], [data-viewport-content]')]
    .find(node => node.getBoundingClientRect().bottom > top);
  return { root, bottom, anchor, top: anchor?.getBoundingClientRect().top ?? top, offset: root.scrollTop };
}

export function restoreVirtualScroll(snapshot: VirtualScrollAnchor) {
  const { root, bottom, anchor, top } = snapshot;
  if (bottom) root.scrollTop = root.scrollHeight;
  else if (anchor?.isConnected) {
    const change = anchor.getBoundingClientRect().top - top;
    if (Math.abs(change) > 1) root.scrollTop += change;
  }
  snapshot.offset = root.scrollTop;
  root.dispatchEvent(new CustomEvent(VIRTUAL_LAYOUT_RESTORED, { detail: { bottom } }));
}

/** Virtual layout corrections are not reader scrolls, including when image decoding follows the commit. */
export function useVirtualScroll({ viewport, following, movement }: {
  viewport: RefObject<HTMLDivElement>; following: MutableRefObject<boolean>; movement: ScrollMovement;
}) {
  useLayoutEffect(() => {
    const node = viewport.current;
    const restored = (event: Event) => {
      if ((event as CustomEvent<{ bottom: boolean }>).detail.bottom) following.current = true;
      movement.remember(node);
    };
    node?.addEventListener(VIRTUAL_LAYOUT_RESTORED, restored);
    return () => node?.removeEventListener(VIRTUAL_LAYOUT_RESTORED, restored);
  }, [viewport, following, movement]);
}
