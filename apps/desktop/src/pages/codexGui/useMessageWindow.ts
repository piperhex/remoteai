import { useLayoutEffect, useMemo, useRef, useState, type RefObject, type WheelEvent } from "react";
import type { ScrollMovement } from "../../../../../shared/chat/useScrollMovement";
import { messageWindow, type MessageCursor } from "./messageWindow";
import type { Turn } from "../../../../../shared/conversation/types";

const LOAD_DISTANCE = 100;
const EMPTY_TURNS: Turn[] = [];
interface Options {
  turns?: Turn[];
  selected: string | null;
  active: boolean;
  viewport: RefObject<HTMLDivElement>;
  movement: ScrollMovement;
  pauseFollowing: () => void;
  away: boolean;
}

function hasNestedScroller(target: EventTarget, viewport: Element): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== viewport) {
    // Keep scrolling inside code, tool output, and the composer independent from history loading.
    if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return true;
    node = node.parentElement;
  }
  return false;
}

export function useMessageWindow({ turns = EMPTY_TURNS, selected, active, viewport, movement,
  pauseFollowing, away }: Options) {
  const [window, setWindow] = useState<{ selected: string | null; start?: MessageCursor }>({ selected });
  const [loading, setLoading] = useState(false);
  const frame = useRef<number>();
  const anchor = useRef<{ node: Element; top: number }>();
  const current = window.selected === selected;
  const start = current && away ? window.start : undefined;
  const range = useMemo(() => messageWindow(turns, { start }), [turns, start]);
  const latest = useRef({ turns, range, selected, active });
  latest.current = { turns, range, selected, active };

  useLayoutEffect(() => {
    const changed = window.start?.turnId !== range.start?.turnId || window.start?.itemId !== range.start?.itemId;
    if (!current || (active && changed)) {
      setWindow({ selected, start: range.start });
    }
  }, [selected, active, current, window.start, range.start]);

  useLayoutEffect(() => {
    anchor.current = undefined;
    movement.remember(viewport.current);
    setLoading(false);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [selected, active, viewport, movement]);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (node && anchor.current?.node.isConnected) {
      node.scrollTop += anchor.current.node.getBoundingClientRect().top - anchor.current.top;
    }
    // Anchor restoration and window eviction emit scroll events without reader input.
    movement.remember(node);
    if (!loading) anchor.current = undefined;
  }, [range, loading, viewport, movement]);

  const load = (update: () => void): boolean => {
    const node = viewport.current;
    if (!node || !active || frame.current !== undefined) return false;
    const top = node.getBoundingClientRect().top;
    const visible = [...node.querySelectorAll("[data-message-id], [data-history-anchor]")]
      .find((entry) => entry.getClientRects().length > 0 && entry.getBoundingClientRect().bottom > top);
    if (visible) anchor.current = { node: visible, top: visible.getBoundingClientRect().top };
    pauseFollowing();
    setLoading(true);
    // Allow the loading indicator to paint before mounting another batch of rich message components.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        const next = latest.current;
        if (next.selected !== selected || !next.active) return;
        update();
        setLoading(false);
      });
    });
    return true;
  };
  const loadPage = (direction: 'older' | 'newer') => {
    if (!(direction === 'older' ? range.hasMore : range.hasNewer)) return false;
    return load(() => {
      const next = latest.current;
      setWindow({ selected,
        start: messageWindow(next.turns, { start: next.range.start, [direction]: true }).start });
    });
  };
  const loadOlder = () => loadPage('older');
  const loadNewer = () => loadPage('newer');
  const onScroll = () => {
    const node = viewport.current;
    if (!node) return 0;
    const offsetChange = movement.read(node);
    if (frame.current !== undefined || offsetChange === 0) return 0;
    if (offsetChange < 0 && node.scrollTop < LOAD_DISTANCE && loadOlder()) return 0;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < LOAD_DISTANCE;
    if (offsetChange > 0 && nearBottom && loadNewer()) return 0;
    return offsetChange;
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.deltaY === 0
      || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const node = viewport.current;
    if (!node) return;
    if (hasNestedScroller(event.target, node)) return;
    if (frame.current !== undefined) return;
    // Collapsed activity can leave the viewport too short to emit a scroll event.
    if (event.deltaY < 0 && node.scrollTop <= 0) loadOlder();
    if (event.deltaY > 0 && node.scrollHeight - node.scrollTop - node.clientHeight < LOAD_DISTANCE) loadNewer();
  };
  return { ...range, loading, onScroll, onWheel, loadOlder, loadNewer };
}
