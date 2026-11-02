import { historyKey, historyPosition, messageBytes, RECENT_BYTE_LIMIT,
  type HistoryPage, type HistoryQuery } from './archive';
import type { LoungeMessage } from './types';

export const HISTORY_WINDOW_LIMIT = 150;
export const HISTORY_LOAD_SIZE = 40;
export type HistoryDirection = 'initial' | 'older' | 'newer';
export interface HistoryTimelineState {
  messages: LoungeMessage[]; hasOlder: boolean; hasNewer: boolean;
  loading?: HistoryDirection; error?: HistoryDirection;
  newerArrived?: boolean;
}
type HistoryLoader = (query: HistoryQuery) => Promise<HistoryPage>;

/** Keeps a bounded, newest-first window. Evicted records can be loaded in either direction by cursor. */
export class HistoryTimeline {
  private state: HistoryTimelineState = { messages: [], hasOlder: false, hasNewer: false, loading: 'initial' };
  private listeners = new Set<() => void>();
  private generation = 0;
  private pending = false;
  private refreshQueued = false;
  constructor(private readonly options: { load: HistoryLoader; query: string; conversation: string }) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  start = () => {
    this.generation++; this.pending = false; this.refreshQueued = false;
    this.update({ messages: [], hasOlder: false, hasNewer: false, loading: 'initial' });
    void this.load('initial');
  };
  dispose = () => { this.generation++; this.pending = false; this.refreshQueued = false; };
  refresh = () => {
    if (this.pending) { this.refreshQueued = true; return; }
    void this.load('initial');
  };
  retry = () => { if (this.state.error) void this.load(this.state.error); };
  older = () => { if (this.state.hasOlder && !this.state.error) void this.load('older'); };
  newer = () => { if (this.state.hasNewer && !this.state.error) void this.load('newer'); };
  invalidateNewer = () => {
    if (!this.state.messages.length) { this.refresh(); return; }
    if (!this.state.hasNewer) this.update({ ...this.state, hasNewer: true, newerArrived: true });
  };
  private update(state: HistoryTimelineState) { this.state = state; this.listeners.forEach(listener => listener()); }
  private async load(direction: HistoryDirection) {
    if (this.pending) return;
    this.pending = true;
    const generation = this.generation;
    this.update({ ...this.state, loading: direction, error: undefined });
    const { query, conversation } = this.options;
    const boundary = direction === 'older' ? this.state.messages.at(-1) : this.state.messages[0];
    const cursor = boundary ? historyPosition(boundary) : undefined;
    try {
      const page = await this.options.load({ query, conversation, limit: HISTORY_LOAD_SIZE,
        before: direction === 'older' ? cursor : undefined, after: direction === 'newer' ? cursor : undefined });
      if (generation === this.generation) this.accept(page, direction);
    } catch {
      if (generation === this.generation) this.update({ ...this.state, loading: undefined, error: direction });
    } finally {
      if (generation === this.generation) {
        this.pending = false;
        if (this.refreshQueued) { this.refreshQueued = false; void this.load('initial'); }
      }
    }
  }
  private accept(page: HistoryPage, direction: HistoryDirection) {
    const previous = direction === 'initial' ? [] : this.state.messages;
    const unique = new Map([...previous, ...page.messages].map(message => [historyKey(message), message]));
    const ordered = [...unique.values()].sort(compareHistoryMessages);
    const messages = boundHistoryWindow(ordered, direction);
    const trimmed = messages.length < ordered.length;
    this.update({ messages, hasOlder: direction === 'newer' ? this.state.hasOlder || trimmed : !!page.next,
      hasNewer: direction === 'older' ? this.state.hasNewer || trimmed : direction === 'newer' && !!page.next });
  }
}

function compareHistoryMessages(first: LoungeMessage, second: LoungeMessage) {
  const a = historyPosition(first), b = historyPosition(second);
  return b.time - a.time || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
}

function boundHistoryWindow(ordered: LoungeMessage[], direction: HistoryDirection) {
  const candidates = direction === 'older' ? [...ordered].reverse() : ordered;
  const messages: LoungeMessage[] = [];
  let bytes = 0;
  for (const message of candidates) {
    const size = messageBytes(message);
    if (messages.length && (messages.length >= HISTORY_WINDOW_LIMIT || bytes + size > RECENT_BYTE_LIMIT)) break;
    messages.push(message); bytes += size;
  }
  return direction === 'older' ? messages.reverse() : messages;
}
