import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { shouldFollowScroll, shouldShowScrollToBottom } from "../../../../../shared/chat/scrollPosition";
import { useScrollMovement } from "../../../../../shared/chat/useScrollMovement";
import { useVirtualScroll } from '../../../../../shared/chat/virtualScroll';

export function useFollowScroll(selected: string | null, active = true) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const movement = useScrollMovement();
  const follow = useRef(true);
  const lastSelected = useRef<string | null>();
  useVirtualScroll({ viewport, following: follow, movement });
  const [away, setAway] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const updateScrollButton = useCallback(() => {
    const node = viewport.current;
    if (node) setShowJumpToLatest(shouldShowScrollToBottom({
      contentHeight: node.scrollHeight, viewportHeight: node.clientHeight, offset: node.scrollTop,
    }));
  }, []);
  const jumpToLatest = useCallback(() => {
    follow.current = true;
    setAway(false);
    setShowJumpToLatest(false);
    if (viewport.current) {
      viewport.current.scrollTo({ top: viewport.current.scrollHeight });
      movement.remember(viewport.current);
    }
  }, [movement]);
  const pauseFollowing = useCallback(() => {
    follow.current = false;
    setAway(true);
    updateScrollButton();
  }, [updateScrollButton]);
  useLayoutEffect(() => {
    if (!active) return;
    if (lastSelected.current !== selected || follow.current) jumpToLatest();
    lastSelected.current = selected;
  }, [selected, active, jumpToLatest]);
  useEffect(() => {
    if (!active || !content.current) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && viewport.current) {
        viewport.current.scrollTop = viewport.current.scrollHeight;
      }
      movement.remember(viewport.current);
      updateScrollButton();
    });
    observer.observe(content.current, { box: 'border-box' });
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [active, movement, updateScrollButton]);
  const onScroll = (offsetChange: number) => {
    updateScrollButton();
    const node = viewport.current;
    if (!node || offsetChange === 0) return;
    follow.current = shouldFollowScroll({ contentHeight: node.scrollHeight, viewportHeight: node.clientHeight,
      offset: node.scrollTop, movement: offsetChange });
    setAway(!follow.current);
  };
  return { viewport, content, movement, away, showJumpToLatest, onScroll, jumpToLatest, pauseFollowing };
}
