import { useLayoutEffect, useMemo, useRef, useState, type RefObject, type WheelEvent } from "react";
import type { ScrollMovement } from "../../../../../shared/chat/useScrollMovement";
import { canScrollWithin } from "../../../../../shared/chat/canScrollWithin";
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
  hasEarlier?: boolean;
  loadEarlier?: () => Promise<Turn[] | undefined>;
}

export function useMessageWindow({ turns = EMPTY_TURNS, selected, active, viewport, movement,
  pauseFollowing, away, hasEarlier, loadEarlier }: Options) {
  const [window, setWindow] = useState<{ selected: string | null; start?: MessageCursor }>({ selected });
  const [loading, setLoading] = useState(false);
  const frame = useRef<number>();
  const pending = useRef(false);
  const generation = useRef(0);
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
      generation.current++;
      pending.current = false;
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

  const load = (update: () => void | Promise<void>): boolean => {
    const node = viewport.current;
    if (!node || !active || pending.current) return false;
    pending.current = true;
    const version = generation.current;
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
        const finish = () => {
          if (version !== generation.current) return;
          pending.current = false;
          setLoading(false);
        };
        const result = update();
        if (result) void result.finally(finish);
        else finish();
      });
    });
    return true;
  };
  const loadPage = (direction: 'older' | 'newer') => {
    if (!(direction === 'older' ? range.hasMore || (hasEarlier && loadEarlier) : range.hasNewer)) return false;
    return load(() => {
      const version = generation.current;
      const apply = (fetched?: Turn[]) => {
        if (version !== generation.current) return;
        const next = latest.current;
        setWindow({ selected,
          start: messageWindow(fetched ?? next.turns, { start: next.range.start, [direction]: true }).start });
      };
      if (direction === 'older' && !latest.current.range.hasMore && loadEarlier) return loadEarlier().then(apply);
      apply();
    });
  };
  const loadOlder = () => loadPage('older');
  const loadNewer = () => loadPage('newer');
  const onScroll = () => {
    const node = viewport.current;
    if (!node) return 0;
    const offsetChange = movement.read(node);
    if (pending.current || offsetChange === 0) return 0;
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
    if (canScrollWithin(event.target, node, event.deltaY)) return;
    if (pending.current) return;
    // Collapsed activity can leave the viewport too short to emit a scroll event.
    if (event.deltaY < 0 && node.scrollTop <= 0) loadOlder();
    if (event.deltaY > 0 && node.scrollHeight - node.scrollTop - node.clientHeight < LOAD_DISTANCE) loadNewer();
  };
  return { ...range, hasMore: range.hasMore || Boolean(hasEarlier && loadEarlier),
    loading, onScroll, onWheel, loadOlder, loadNewer };
}
