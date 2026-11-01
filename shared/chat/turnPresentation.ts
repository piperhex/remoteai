import type { Item, Turn } from '../remote-chat/client/types';
import { changedFiles, parseDiff } from './diff';
import { followsStoppedTurn, visibleContinuationItems } from '../../apps/desktop/src/pages/codexGui/continuation';
import { turnElapsedMs } from '../../apps/desktop/src/pages/codexGui/turnTiming';
import { groupTurnItems } from './turnGroups';
import { hasVisibleProcessContent } from './processContent';
export { groupTurnItems } from './turnGroups';

export type MessageEntry = { id: string; kind: 'message' | 'process'; turn: Turn; item: Item };
export type WorkEntry = { id: string; kind: 'work'; turn: Turn; items: Item[]; inline: boolean; timed?: boolean };
export type TurnEntry = MessageEntry | WorkEntry | { id: string; kind: 'summary'; turn: Turn }
  | { id: string; kind: 'duration'; turn: Turn };

// History reducers replace changed turns. Reuse unchanged turns without retaining discarded conversations.
const entryCache = new WeakMap<Turn, Map<string, TurnEntry[]>>();

/** Rejected or still-running edits are not completed file changes. A net diff takes precedence. */
export function completedTurnFiles(turn: Turn) {
  const netFiles = parseDiff(turn.diff ?? '');
  if (netFiles.length) return netFiles;
  return changedFiles(turn.items.filter((item) => item.type === 'fileChange'
    && !['declined', 'failed', 'inProgress'].includes(item.status ?? ''))
    .flatMap((item) => item.changes ?? []));
}

function hasSummary(turn: Turn) {
  return Boolean(turn.plan?.length || turn.diff?.trim() || turn.error || turn.retryError
    || turn.status === 'interrupted' || turn.status === 'failed' || completedTurnFiles(turn).length
    || turn.items.some((item) => item.type === 'imageGeneration' && item.status === 'completed' && !item.failure));
}

/** Stable group IDs keep open drawers and measured list cells attached during streamed updates. */
export function conversationEntries(turns: Turn[], inlineTurns: ReadonlyMap<string, boolean> = new Map()): TurnEntry[] {
  return turns.flatMap((turn, index) => {
    const inline = inlineTurns.get(turn.id) ?? ['inProgress', 'interrupted', 'failed'].includes(turn.status);
    const continuation = followsStoppedTurn(turns[index - 1]);
    const key = `${inline}:${continuation}`;
    const cached = entryCache.get(turn)?.get(key);
    if (cached) return cached;
    const entries = turnEntries(turn, { inline, continuation });
    const cache = entryCache.get(turn) ?? new Map<string, TurnEntry[]>();
    cache.set(key, entries);
    entryCache.set(turn, cache);
    return entries;
  });
}

function turnEntries(turn: Turn, { inline, continuation }: { inline: boolean; continuation: boolean }): TurnEntry[] {
  const items = continuation ? visibleContinuationItems(turn.items) : turn.items;
  const entries = groupTurnItems(items).flatMap((group): TurnEntry[] => {
    if (group.type === 'message') return [{ id: `${turn.id}:message:${group.items[0].id}`,
      kind: 'message', turn, item: group.items[0] }];
    const visible = group.items.filter(hasVisibleProcessContent);
    if (!visible.length) return [];
    const work: WorkEntry = { id: `${turn.id}:work:${group.items[0].id}`,
      kind: 'work', turn, items: visible, inline };
    if (!inline) return [work];
    return [work, ...visible.map((item): MessageEntry => ({
      id: `${turn.id}:message:${item.id}`, kind: 'process', turn, item,
    }))];
  });
  if (turn.status !== 'inProgress' && turnElapsedMs(turn, 0) != null) {
    const response = entries.findIndex((entry) => entry.kind !== 'message' || entry.item.type !== 'userMessage');
    const first = entries[response];
    if (first?.kind === 'work') first.timed = true;
    else entries.splice(response < 0 ? entries.length : response, 0,
      { id: `${turn.id}:duration`, kind: 'duration', turn });
  }
  if (hasSummary(turn)) entries.push({ id: `${turn.id}:summary`, kind: 'summary', turn });
  return entries;
}

/** Loading an earlier page can prepend activities to an already-open process group. */
export function findWorkEntry(entries: TurnEntry[], id: string): WorkEntry | undefined {
  return entries.find((entry): entry is WorkEntry => entry.kind === 'work'
    && (entry.id === id || entry.items.some((item) => `${entry.turn.id}:work:${item.id}` === id)));
}
