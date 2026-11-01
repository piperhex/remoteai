import { useCallback, useLayoutEffect, useRef, useState, type TouchEvent, type WheelEvent } from 'react';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import { isNearHistoryStart, shouldFollowScroll, shouldShowScrollToBottom }
  from '../../../../shared/chat/scrollPosition';
import { useScrollMovement } from '../../../../shared/chat/useScrollMovement';
import { restoreVirtualScroll, useVirtualScroll } from '../../../../shared/chat/virtualScroll';
import { useHistoryPull } from '../../../../shared/chat/useHistoryPull';
import { useHistoryContinuation } from '../../../../shared/chat/useHistoryContinuation';
import { useCommittedCallback } from '../../../../shared/chat/useCommittedCallback';

const TOP_TOLERANCE = 1;

function canScrollUp(target: EventTarget, container: HTMLElement) {
  let element = target instanceof Element ? target : null;
  while (element && element !== container) {
    if (element.scrollTop > 0 && /^(auto|scroll)$/.test(getComputedStyle(element).overflowY)) return true;
    element = element.parentElement;
  }
  return false;
}

export function useHistoryScroll(
  { thread, loading, loadingMore, hasMore, loadOlder, historyLoad }: ChatMessagesProps,
  windowed = false,
) {
  const list = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showBottom, setShowBottom] = useState(false);
  const fetching = useRef(false);
  const movement = useScrollMovement();
  useVirtualScroll({ viewport: list, following, movement });
  const anchor = useRef<{ element: Element; top: number }>();
  const scope = useRef(thread?.id);
  useLayoutEffect(() => {
    scope.current = thread?.id;
    following.current = true;
    fetching.current = false;
    anchor.current = undefined;
    movement.remember(list.current);
  }, [thread?.id, movement]);
  const updateScrollButton = useCallback(() => {
    const node = list.current;
    if (node) setShowBottom(shouldShowScrollToBottom({
      contentHeight: node.scrollHeight, viewportHeight: node.clientHeight, offset: node.scrollTop,
    }));
  }, []);
  const rememberReadingAnchor = () => {
    const node = list.current;
    if (!node) return;
    const top = node.getBoundingClientRect().top;
    const element = [...node.querySelectorAll('[data-message-id]')]
      .find(item => item.getBoundingClientRect().bottom > top);
    anchor.current = element ? { element, top: element.getBoundingClientRect().top } : undefined;
  };
  const more = () => {
    if (!hasMore || loading || loadingMore || fetching.current || !loadOlder || !list.current) return;
    continueHistory();
    following.current = false;
    rememberReadingAnchor();
    fetching.current = true;
    const current = scope.current;
    void loadOlder().finally(() => { if (scope.current === current) fetching.current = false; });
  };
  const continueHistory = useHistoryContinuation({
    threadId: thread?.id, result: historyLoad, hasMore, loading: Boolean(loading || loadingMore), loadOlder: more,
    nearTop: () => Boolean(list.current && isNearHistoryStart({
      offset: list.current.scrollTop, viewportHeight: list.current.clientHeight,
    })),
  });
  const pull = useHistoryPull(() => Boolean(list.current && list.current.scrollTop <= TOP_TOLERANCE), more);
  const touchPoint = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    return touch && !event.defaultPrevented && !canScrollUp(event.target, event.currentTarget)
      ? { x: touch.pageX, y: touch.pageY } : undefined;
  };
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => pull.begin(touchPoint(event));
  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => pull.move(touchPoint(event));
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (anchor.current?.element.isConnected) {
      node.scrollTop += anchor.current.element.getBoundingClientRect().top - anchor.current.top;
    } else if (following.current) node.scrollTop = node.scrollHeight;
    movement.remember(node);
    updateScrollButton();
    if (!loadingMore && !windowed) anchor.current = undefined;
  }, [thread, loadingMore, updateScrollButton, movement, windowed]);
  const onScroll = useCommittedCallback(() => {
    const node = list.current;
    if (!node) return;
    const offsetChange = movement.read(node);
    // Layout and resize effects already remember their restored position before the scroll event arrives.
    if (offsetChange === 0) return;
    if (windowed) {
      if (fetching.current) rememberReadingAnchor();
      else anchor.current = undefined;
    }
    following.current = shouldFollowScroll({ contentHeight: node.scrollHeight, viewportHeight: node.clientHeight,
      offset: node.scrollTop, movement: offsetChange });
    updateScrollButton();
    if (offsetChange < 0 && isNearHistoryStart({ offset: node.scrollTop, viewportHeight: node.clientHeight })) more();
  });
  useLayoutEffect(() => {
    const follow = () => {
      // Lazy measurements can arrive before the browser dispatches a pending reader scroll.
      if (windowed) onScroll();
      if (following.current && list.current) {
        list.current.scrollTop = list.current.scrollHeight;
      }
      movement.remember(list.current);
      updateScrollButton();
    };
    const observer = new ResizeObserver(follow);
    if (body.current) observer.observe(body.current, { box: 'border-box' });
    if (list.current) observer.observe(list.current);
    follow();
    return () => observer.disconnect();
  }, [updateScrollButton, movement, windowed, onScroll]);
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY >= 0 || event.ctrlKey || event.defaultPrevented) return;
    if (canScrollUp(event.target, event.currentTarget)) return;
    following.current = false;
    if (event.currentTarget.scrollTop > 0) return;
    // At the top (including short histories), upward wheels do not produce a scroll event.
    more();
  };
  const toBottom = () => {
    if (windowed) anchor.current = undefined;
    following.current = true;
    setShowBottom(false);
    const node = list.current;
    if (!node) return;
    // A windowed list learns heights as it mounts: a smooth scroll's obsolete target can stop halfway.
    if (windowed) restoreVirtualScroll({ root: node, bottom: true, top: 0, offset: node.scrollTop });
    else node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  };
  const pauseFollowing = () => { following.current = false; };
  return { list, content, body, following, readingAnchor: anchor,
    onScroll, onWheel, more, showBottom, toBottom, pauseFollowing,
    onTouchStart, onTouchMove, onTouchEnd: pull.clear, onTouchCancel: pull.clear };
}
