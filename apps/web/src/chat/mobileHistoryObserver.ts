import { captureVirtualScroll, type VirtualScrollAnchor } from '../../../../shared/chat/virtualScroll';
import type { MutableRefObject } from 'react';

const OVERSCAN_PX = 400;
type Listener = (visible: boolean, anchor: VirtualScrollAnchor | null) => void;
const groups = new Map<Element, { observer: IntersectionObserver; listeners: Map<Element, Listener> }>();
const followingStates = new WeakMap<Element, MutableRefObject<boolean>>();

export function trackMobileHistoryFollowing(root: Element, following: MutableRefObject<boolean>) {
  followingStates.set(root, following);
  return () => { if (followingStates.get(root) === following) followingStates.delete(root); };
}

export function captureMobileHistory(root: Element) {
  return captureVirtualScroll(root, followingStates.get(root)?.current);
}

/** Overscan the actual history scroller; a document-root observer is clipped by the inner viewport. */
export function observeMobileHistory(element: HTMLElement, listener: Listener) {
  const root = element.closest('.chat-messages') ?? element.parentElement ?? element;
  let group = groups.get(root);
  if (!group) {
    const listeners = new Map<Element, Listener>();
    const observer = new IntersectionObserver(entries => {
      const anchor = captureMobileHistory(root);
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting, anchor);
    }, { root, rootMargin: `${OVERSCAN_PX}px 0px` });
    group = { observer, listeners };
    groups.set(root, group);
  }
  group.listeners.set(element, listener);
  group.observer.observe(element);
  return () => {
    group.listeners.delete(element); group.observer.unobserve(element);
    if (!group.listeners.size) { group.observer.disconnect(); groups.delete(root); }
  };
}
