import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { restoreVirtualScroll } from '../../../../shared/chat/virtualScroll';
import { useMobileHistoryVisibility, type HistorySlot } from './useMobileHistoryVisibility';

// Start near a short message's real height; inflated estimates can move the prefetch edge while reading.
const MESSAGE_ESTIMATE = 80;

/** Mobile rows start as light slots, so loading a page never mounts all of its rich contents. */
export function MobileHistoryContent({ children, estimate = MESSAGE_ESTIMATE }: {
  children: () => ReactNode; estimate?: number;
}) {
  const node = useRef<HTMLDivElement>(null);
  const slot = useRef<HistorySlot>({ height: estimate, anchor: null, openDetails: [] }).current;
  const visible = useMobileHistoryVisibility(node, slot);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    if (visible) {
      element.querySelectorAll('details').forEach((detail, index) => {
        if (slot.openDetails[index]) detail.open = true;
      });
      const measure = () => {
        slot.height = element.getBoundingClientRect().height;
        // Preserve compact continuation spacing when the preceding action bar is recycled.
        element.parentElement?.toggleAttribute('data-history-actions',
          Boolean(element.querySelector('.chat-message-actions')));
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      if (slot.anchor) restoreVirtualScroll(slot.anchor);
      slot.anchor = null;
      return () => observer.disconnect();
    }
    if (slot.anchor) restoreVirtualScroll(slot.anchor);
    slot.anchor = null;
  }, [visible, slot]);
  return <div ref={node} data-mobile-history-content={visible ? 'visible' : 'placeholder'}
    style={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: '100%',
      height: visible ? undefined : slot.height }}>
    {visible && children()}
  </div>;
}
