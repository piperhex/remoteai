import { useLayoutEffect, useState, type RefObject } from 'react';
import { observeMobileHistory } from './mobileHistoryObserver';
import type { VirtualScrollAnchor } from '../../../../shared/chat/virtualScroll';

export interface HistorySlot {
  height: number;
  anchor: VirtualScrollAnchor | null;
  openDetails: boolean[];
}

function hasActiveInteraction(element: HTMLElement) {
  const selection = window.getSelection();
  return element.contains(document.activeElement)
    || Boolean(selection && !selection.isCollapsed
      && (element.contains(selection.anchorNode) || element.contains(selection.focusNode)))
    // Keep the owning image/disclosure dialog, without pinning every historical row behind it.
    || Boolean(element.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]'));
}

export function useMobileHistoryVisibility(node: RefObject<HTMLDivElement>, slot: HistorySlot) {
  const supported = typeof IntersectionObserver !== 'undefined';
  const [visible, setVisible] = useState(!supported);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element || !supported) return;
    let intersecting = false;
    let mounted = false;
    let retained: MutationObserver | undefined;
    const update = (next: boolean, anchor: VirtualScrollAnchor | null) => {
      intersecting = next;
      if (next) { retained?.disconnect(); retained = undefined; }
      if (next === mounted) return;
      if (!next && hasActiveInteraction(element)) {
        if (!retained) {
          retained = new MutationObserver(() => update(false, null));
          retained.observe(element, { childList: true, subtree: true });
        }
        return;
      }
      retained?.disconnect(); retained = undefined;
      if (!next && element.childElementCount) {
        slot.openDetails = [...element.querySelectorAll('details')].map(detail => detail.open);
      }
      slot.anchor = anchor;
      mounted = next;
      setVisible(next);
    };
    const unsubscribe = observeMobileHistory(element, update);
    const release = () => { if (!intersecting) update(false, null); };
    document.addEventListener('selectionchange', release);
    element.addEventListener('focusout', release);
    return () => {
      unsubscribe(); document.removeEventListener('selectionchange', release);
      element.removeEventListener('focusout', release);
      retained?.disconnect();
    };
  }, [node, slot, supported]);
  return visible;
}
