import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ListRef } from 'rc-virtual-list';
import type { HistoryTimelineRow } from './historyTimelineRows';
import type { HistoryTimelineModel } from './useHistoryTimeline';

const PREFETCH_ROWS = 6;
interface Anchor { key: string; offset: number }

/** Restore the first visible message after either end of the bounded window changes. */
export function useHistoryVirtualList(history: HistoryTimelineModel, rows: HistoryTimelineRow[]) {
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<ListRef>(null);
  const [height, setHeight] = useState(0);
  const model = useRef(history); model.current = history;
  const currentRows = useRef(rows); currentRows.current = rows;
  const displayed = useRef<HistoryTimelineRow[]>();
  const anchor = useRef<Anchor>();
  const restoring = useRef(true);
  const range = useRef({ first: 0, last: 0 });
  const frame = useRef(0);

  const capture = useCallback(() => {
    const node = list.current?.nativeElement;
    if (!node || restoring.current || displayed.current !== currentRows.current) return;
    const top = node.getBoundingClientRect().top;
    const first = Array.from(node.querySelectorAll<HTMLElement>('[data-history-key]'))
      .find(row => row.getBoundingClientRect().bottom > top + 1);
    const message = first?.querySelector('article');
    if (first?.dataset.historyKey && message) anchor.current = {
      key: first.dataset.historyKey, offset: message.getBoundingClientRect().top - top,
    };
  }, []);
  const prefetch = useCallback(() => {
    const state = model.current;
    if (restoring.current || displayed.current !== currentRows.current || state.loading || state.error) return;
    if (range.current.first < PREFETCH_ROWS && state.hasOlder) state.older();
    else if (range.current.last >= currentRows.current.length - PREFETCH_ROWS && state.hasNewer) state.newer();
  }, []);
  const visible = useCallback((items: HistoryTimelineRow[]) => {
    const all = currentRows.current;
    range.current = { first: all.findIndex(row => row.key === items[0]?.key),
      last: all.findIndex(row => row.key === items.at(-1)?.key) };
    capture(); prefetch();
  }, [capture, prefetch]);
  const restore = useCallback(() => {
    const saved = anchor.current;
    if (saved && currentRows.current.some(row => row.key === saved.key)) {
      const row = Array.from(list.current?.nativeElement.querySelectorAll<HTMLElement>('[data-history-key]') ?? [])
        .find(element => element.dataset.historyKey === saved.key);
      const message = row?.querySelector('article');
      // The date separator may move to a newly fetched row; anchor the message content itself.
      const heading = row && message ? message.getBoundingClientRect().top - row.getBoundingClientRect().top : 0;
      list.current?.scrollTo({ key: saved.key, align: 'top', offset: saved.offset - heading });
    } else list.current?.scrollTo({ index: currentRows.current.length - 1, align: 'bottom' });
  }, []);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => setHeight(node.clientHeight);
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!rows.length || !height) return;
    restoring.current = true; displayed.current = rows; restore();
    frame.current = requestAnimationFrame(() => {
      restore();
      frame.current = requestAnimationFrame(() => { restoring.current = false; capture(); prefetch(); });
    });
    return () => cancelAnimationFrame(frame.current);
  }, [rows, height, restore, capture, prefetch]);
  useLayoutEffect(() => { prefetch(); }, [history.loading, history.hasNewer, prefetch]);
  const scrolled = useCallback(() => {
    if (restoring.current) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { capture(); prefetch(); });
  }, [capture, prefetch]);
  return { viewport, list, height, visible, scrolled, restore };
}
