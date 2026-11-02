import type { HistoryDirection } from './historyTimeline';

export type HistoryScrollDirection = Exclude<HistoryDirection, 'initial'>;
const PREFETCH_ROWS = 6;

/** Small byte-limited windows require a user gesture, or opposing edges can repeatedly evict each other. */
export function historyPrefetchDirection(options: {
  first: number; last: number; size: number; newestFirst: boolean;
  hasOlder: boolean; hasNewer: boolean; newerArrived?: boolean; intent?: HistoryScrollDirection;
}): HistoryScrollDirection | undefined {
  const top = options.newestFirst ? 'newer' : 'older';
  const bottom = options.newestFirst ? 'older' : 'newer';
  const allowed = (direction: HistoryScrollDirection) => (options.size > PREFETCH_ROWS * 2
    || direction === 'newer' && options.newerArrived && options.intent !== 'older' || options.intent === direction)
    && (direction === 'older' ? options.hasOlder : options.hasNewer);
  if (options.first < PREFETCH_ROWS && allowed(top)) return top;
  if (options.last >= options.size - PREFETCH_ROWS && allowed(bottom)) return bottom;
}
