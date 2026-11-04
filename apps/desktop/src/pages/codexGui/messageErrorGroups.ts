import type { VisibleTurn } from "./messageWindow";
import { requestErrorDetails } from "../../../../../shared/conversation/requestError";
import { turnMessageGroups, type TurnMessageGroup } from "./turnMessageGroups";

type ErrorGroup = Extract<TurnMessageGroup, { type: "error" }>;

/** Collapse uninterrupted repeats at their last occurrence, including hidden continue turns. */
export function groupVisibleTurns(entries: VisibleTurn[]) {
  const result = entries.map((entry) => ({ ...entry, groups: turnMessageGroups(entry.turn, {
    visibleItems: entry.items, followsInterruption: entry.followsInterruption,
  }) }));
  const hidden = new Set<ErrorGroup>();
  let previous: { group: ErrorGroup; detail: string } | undefined;
  for (const entry of result) {
    for (const group of entry.groups) {
      if (group.type !== "error") { previous = undefined; continue; }
      const detail = group.error.error ? requestErrorDetails(group.error.error) : "";
      if (detail && previous?.detail === detail) {
        hidden.add(previous.group);
        group.count = (previous.group.count ?? 1) + 1;
      }
      previous = { group, detail };
    }
  }
  return result.map((entry) => ({ ...entry,
    groups: entry.groups.filter((group) => group.type !== "error" || !hidden.has(group)),
  }));
}
