import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { LoungeController } from './controller';
import { HistoryTimeline } from './historyTimeline';
import { historyKey } from './archive';

const SEARCH_DELAY_MS = 250;

export function useHistoryTimeline(controller: LoungeController, preload = false) {
  const { conversation, historyRevision, messages: liveMessages } = useSyncExternalStore(controller.subscribe,
    controller.snapshot);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const timeline = useMemo(() => new HistoryTimeline({ query: search, conversation,
    load: options => controller.searchHistory(options) }), [controller, conversation, search]);
  useEffect(() => { timeline.start(); return timeline.dispose; }, [timeline]);
  const observed = useRef<HistoryTimeline>();
  useEffect(() => {
    if (observed.current !== timeline) { observed.current = timeline; return; }
    if (!preload) { timeline.invalidateNewer(); return; }
    // Refresh the hidden first page after bursts of archive writes, ready for the next opening.
    const timer = setTimeout(timeline.refresh, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [timeline, historyRevision, preload]);
  const state = useSyncExternalStore(timeline.subscribe, timeline.snapshot);
  const messages = useMemo(() => {
    const live = new Map(liveMessages.map(message => [historyKey(message), message]));
    return state.messages.map(message => live.get(historyKey(message)) ?? message);
  }, [state.messages, liveMessages]);
  const searching = search !== query;
  return { ...state, messages: searching ? [] : messages,
    loading: searching ? 'initial' as const : state.loading, query, setQuery,
    key: JSON.stringify([conversation, search]), retry: timeline.retry, older: timeline.older, newer: timeline.newer };
}

export type HistoryTimelineModel = ReturnType<typeof useHistoryTimeline>;
