import { groupTurnItems, type TurnItemGroup } from "../../../../../shared/chat/turnGroups";
import { hasVisibleProcessContent } from "../../../../../shared/chat/processContent";
import { visibleContinuationItems } from "../../../../../shared/conversation/continuation";
import { requestErrorPosition, turnRequestErrors, type TurnRequestError } from "../../../../../shared/conversation/turnRequestErrors";
import type { Item, Turn } from "../../../../../shared/conversation/types";

type MessageGroup = { type: "work" | "message"; key: string; items: Item[] };
export type TurnMessageGroup = MessageGroup | {
  type: "error"; key: string; error: TurnRequestError; count?: number;
};
interface GroupOptions {
  visible: Set<string>;
  continuation: Set<string>;
  boundaries: Map<string | null, TurnMessageGroup[]>;
}

function errorBoundaries(turn: Turn, visible: Set<string>): Map<string | null, TurnMessageGroup[]> {
  const firstVisible = turn.items.findIndex((item) => visible.has(item.id));
  let lastVisible = turn.items.length - 1;
  while (lastVisible >= 0 && !visible.has(turn.items[lastVisible].id)) lastVisible--;
  const boundaries = new Map<string | null, TurnMessageGroup[]>();
  for (const error of turnRequestErrors(turn)) {
    const position = requestErrorPosition(turn, error);
    if (position < firstVisible || (lastVisible >= 0 && position > lastVisible + 1)) continue;
    const anchor = turn.items[position - 1]?.id ?? null;
    boundaries.set(anchor, [...(boundaries.get(anchor) ?? []), { type: "error", key: error.id, error }]);
  }
  return boundaries;
}

function splitGroup(group: TurnItemGroup, { visible, continuation, boundaries }: GroupOptions): TurnMessageGroup[] {
  const result: TurnMessageGroup[] = [];
  let segment: MessageGroup | undefined;
  for (const item of group.items) {
    if (visible.has(item.id) && continuation.has(item.id)
      && (group.type !== "work" || hasVisibleProcessContent(item))) {
      if (!segment) {
        segment = { type: group.type, key: item.id, items: [] };
        result.push(segment);
      }
      segment.items.push(item);
    }
    const errors = boundaries.get(item.id);
    if (!errors) continue;
    result.push(...errors);
    segment = undefined;
  }
  return result;
}

/** Split process groups at errors so collapsing or extending activities cannot move a notice. */
export function turnMessageGroups(turn: Turn, options: { visibleItems: Item[]; followsInterruption: boolean }) {
  const visible = new Set(options.visibleItems.map((item) => item.id));
  const continuation = new Set((options.followsInterruption
    ? visibleContinuationItems(turn.items) : turn.items).map((item) => item.id));
  const boundaries = errorBoundaries(turn, visible);
  return [...(boundaries.get(null) ?? []), ...groupTurnItems(turn.items)
    .flatMap((group) => splitGroup(group, { visible, continuation, boundaries }))];
}
