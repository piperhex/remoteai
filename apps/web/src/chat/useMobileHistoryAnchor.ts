import { useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { restoreVirtualScroll, type VirtualScrollAnchor }
  from '../../../../shared/chat/virtualScroll';
import { captureMobileHistory, trackMobileHistoryFollowing } from './mobileHistoryObserver';

/** Keep the visible row stable through decoded images, streamed text, disclosures and keyboard resizing. */
export function useMobileHistoryAnchor({ enabled, viewport, content, readingAnchor, following }: {
  enabled: boolean; viewport: RefObject<HTMLDivElement>; content: RefObject<HTMLDivElement>;
  readingAnchor: RefObject<{ element: Element; top: number } | undefined>;
  following: MutableRefObject<boolean>;
}) {
  const snapshot = useRef<VirtualScrollAnchor | null>(null);
  useLayoutEffect(() => {
    const root = viewport.current;
    const body = content.current;
    if (!root || !body) return;
    if (!enabled && !snapshot.current) return;
    const release = trackMobileHistoryFollowing(root, following);
    // The outer message elements survive mode changes even when their rendering strategy changes.
    if (snapshot.current?.anchor?.isConnected || snapshot.current?.bottom) restoreVirtualScroll(snapshot.current);
    const remember = () => { snapshot.current = captureMobileHistory(root); };
    remember();
    const resize = new ResizeObserver(() => {
      const reading = readingAnchor.current;
      if (reading?.element.isConnected) {
        // A newly prepended row may be visible above this message before its real height is known.
        restoreVirtualScroll({ root, bottom: false, anchor: reading.element, top: reading.top, offset: root.scrollTop });
      } else if (snapshot.current) restoreVirtualScroll(snapshot.current);
      remember();
    });
    if (enabled) { resize.observe(body); resize.observe(root); }
    root.addEventListener('scroll', remember, { passive: true });
    root.addEventListener('chat-virtual-layout-restored', remember);
    return () => {
      resize.disconnect(); release();
      root.removeEventListener('scroll', remember);
      root.removeEventListener('chat-virtual-layout-restored', remember);
    };
  }, [enabled, viewport, content, readingAnchor, following]);
}
