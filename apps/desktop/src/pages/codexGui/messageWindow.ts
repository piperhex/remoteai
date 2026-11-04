import type { Item, Turn } from "../../../../../shared/conversation/types";
import { groupTurnItems } from "../../../../../shared/chat/turnGroups";
import { followsStoppedTurn, visibleContinuationItems } from "../../../../../shared/conversation/continuation";

export const MESSAGE_PAGE_SIZE = 10;
export const MESSAGE_WINDOW_SIZE = MESSAGE_PAGE_SIZE * 3;
export interface MessageCursor { turnId: string; itemId: string }
interface Position { turn: number; item: number }
export interface VisibleTurn { turn: Turn; items: Item[]; followsInterruption: boolean }

function groupStarts(turns: Turn[], index: number): number[] {
  const items = turns[index].items;
  const visible = followsStoppedTurn(turns[index - 1]) ? visibleContinuationItems(items) : items;
  const starts = new Set(groupTurnItems(visible).map((group) => group.items[0].id));
  return items.flatMap((item, position) => starts.has(item.id) ? [position] : []);
}

function locate(turns: Turn[], cursor?: MessageCursor): Position | undefined {
  if (!cursor) return;
  for (let turn = turns.length - 1; turn >= 0; turn--) {
    if (turns[turn].id !== cursor.turnId) continue;
    for (let item = turns[turn].items.length - 1; item >= 0; item--) {
      if (turns[turn].items[item].id !== cursor.itemId) continue;
      // Streaming can merge the previously final message into a longer process group.
      const start = groupStarts(turns, turn).filter((position) => position <= item).at(-1);
      return start === undefined ? undefined : { turn, item: start };
    }
    return;
  }
}

function preceding(turns: Turn[], end: Position): Position | undefined {
  let remaining = MESSAGE_PAGE_SIZE;
  let first: Position | undefined;
  for (let turn = end.turn; turn >= 0; turn--) {
    const starts = groupStarts(turns, turn).filter((item) => turn !== end.turn || item < end.item);
    if (starts.length >= remaining) return { turn, item: starts[starts.length - remaining] };
    if (starts.length) first = { turn, item: starts[0] };
    remaining -= starts.length;
  }
  return first;
}

function hasEarlierItems(turns: Turn[], first: Position): boolean {
  if (groupStarts(turns, first.turn).some((item) => item < first.item)) return true;
  for (let index = 0; index < first.turn; index++) {
    if (groupStarts(turns, index).length > 0) return true;
  }
  return false;
}

function following(turns: Turn[], first: Position, count: number): Position | undefined {
  for (let turn = first.turn; turn < turns.length; turn++) {
    const starts = groupStarts(turns, turn).filter(item => turn !== first.turn || item >= first.item);
    if (starts.length > count) return { turn, item: starts[count] };
    count -= starts.length;
  }
}

function entriesBetween(turns: Turn[], first: Position, end?: Position): VisibleTurn[] {
  const last = end ? end.turn + Number(end.item > 0) : turns.length;
  return turns.slice(first.turn, last).map((turn, index) => ({ turn,
    items: turn.items.slice(index === 0 ? first.item : 0, end?.turn === first.turn + index ? end.item : undefined),
    followsInterruption: followsStoppedTurn(turns[first.turn + index - 1]),
  }));
}

/** Page visible messages and whole process groups; collapsed activities must not consume separate pages. */
export function messageWindow(turns: Turn[], options: {
  start?: MessageCursor; older?: boolean; newer?: boolean;
} = {}) {
  if (!turns.length) return { entries: [] as VisibleTurn[], start: undefined, hasMore: false, hasNewer: false };
  const previous = locate(turns, options.start);
  const end = { turn: turns.length - 1, item: turns[turns.length - 1].items.length };
  let first = previous && !options.older ? previous : preceding(turns, previous ?? end) ?? previous
    ?? { turn: 0, item: 0 };
  if (options.newer) first = following(turns, first, MESSAGE_PAGE_SIZE) ?? first;
  const limit = following(turns, first, MESSAGE_WINDOW_SIZE);
  const entries = entriesBetween(turns, first, limit);
  const firstItem = entries.find((entry) => entry.items.length > 0);
  return { entries, hasMore: hasEarlierItems(turns, first), hasNewer: Boolean(limit),
    start: firstItem ? { turnId: firstItem.turn.id, itemId: firstItem.items[0].id } : undefined };
}
