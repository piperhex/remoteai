import { expect, it } from "vitest";
import { messageWindow } from "./messageWindow";
import type { Turn } from "../../../../../shared/conversation/types";
import { CONTINUE_MESSAGE } from "../../../../../shared/conversation/continuation";

function history(): Turn[] {
  return Array.from({ length: 7 }, (_, turn) => ({ id: `turn-${turn}`, status: "completed",
    items: Array.from({ length: 5 }, (_, item) => ({ id: `item-${turn * 5 + item}`,
      type: "agentMessage", phase: "final_answer" })),
  }));
}
const ids = (range: ReturnType<typeof messageWindow>) => range.entries
  .flatMap((entry) => entry.items.map((item) => item.id));

it("limits the initial window to ten message groups, then includes ten older groups at a time", () => {
  const turns = history();
  let range = messageWindow(turns);
  expect(ids(range)).toHaveLength(10);
  expect(ids(range)[0]).toBe("item-25");
  for (const [count, more] of [[20, true], [30, true], [30, false]] as const) {
    range = messageWindow(turns, { start: range.start, older: true });
    expect(ids(range)).toHaveLength(count);
    expect(range.hasMore).toBe(more);
  }
  expect(range.entries[0].turn).toBe(turns[0]);
  expect(range.hasNewer).toBe(true);
  range = messageWindow(turns, { start: range.start, newer: true });
  expect(ids(range)).toContain('item-34');
  expect(range.hasNewer).toBe(false);
});

it("limits a single large turn without discarding its full data or prior interruption context", () => {
  const turns = history();
  turns[0].status = "interrupted";
  turns[1].items = turns.flatMap((turn) => turn.items);
  const range = messageWindow(turns.slice(0, 2));
  expect(range.entries).toHaveLength(1);
  expect(range.entries[0].items).toHaveLength(10);
  expect(range.entries[0].turn.items).toHaveLength(35);
  expect(range.entries[0].followsInterruption).toBe(true);
});

it("keeps the earliest loaded item when streaming appends new content and resets a removed cursor", () => {
  const turns = history();
  const first = messageWindow(turns);
  turns[6].items.push({ id: "new", type: "agentMessage", phase: "final_answer" });
  expect(ids(messageWindow(turns, { start: first.start }))).toHaveLength(11);
  expect(ids(messageWindow(turns, { start: first.start, older: true }))).toHaveLength(21);
  turns[5].items = [];
  expect(ids(messageWindow(turns, { start: first.start }))).toHaveLength(10);
  expect(messageWindow([])).toEqual({ entries: [], hasMore: false, hasNewer: false, start: undefined });
});

it("retains the empty active turn so processing remains visible before the first item", () => {
  const turns = history();
  turns.push({ id: "active", status: "inProgress", items: [] });
  const range = messageWindow(turns);
  expect(ids(range)).toHaveLength(10);
  expect(range.entries.at(-1)?.turn.id).toBe("active");
});

it("does not offer another page when only empty turns precede the first message", () => {
  const turns: Turn[] = [{ id: "empty", status: "interrupted", items: [] },
    { id: "last", status: "completed", items: [{ id: "only", type: "agentMessage" }] }];
  const first = messageWindow(turns);
  expect(first.hasMore).toBe(false);
  expect(messageWindow(turns, { start: first.start }).hasMore).toBe(false);
});

it("includes a whole large process group alongside its question and answer on entry", () => {
  const turn: Turn = { id: "long", status: "completed", items: [
    { id: "question", type: "userMessage" },
    ...Array.from({ length: 2_000 }, (_, index) => ({ id: `tool-${index}`, type: "commandExecution" })),
    { id: "answer", type: "agentMessage" },
  ] };
  const range = messageWindow([turn]);
  expect(range.entries[0].items).toEqual(turn.items);
  expect(range.hasMore).toBe(false);
  expect(range.start?.itemId).toBe("question");
});

it("reaches earlier messages in one page across many complete process groups", () => {
  const turns: Turn[] = Array.from({ length: 7 }, (_, index) => ({ id: `turn-${index}`, status: "completed", items: [
    { id: `question-${index}`, type: "userMessage" },
    ...Array.from({ length: 100 }, (_, activity) => ({ id: `tool-${index}-${activity}`, type: "commandExecution" })),
    { id: `answer-${index}`, type: "agentMessage" },
  ] }));
  const first = messageWindow(turns);
  expect(first.start?.itemId).toBe("answer-3");
  const older = messageWindow(turns, { start: first.start, older: true });
  expect(older.start?.itemId).toBe("tool-0-0");
  expect(older.entries[0].items).toHaveLength(101);
  expect(ids(older)).toContain("question-1");
  expect(older.hasMore).toBe(true);
  const last = messageWindow(turns, { start: older.start, older: true });
  expect(last.start?.itemId).toBe("question-0");
  expect(last.hasMore).toBe(false);
});

it("realigns the cursor when a newly appended unphased answer extends an earlier process group", () => {
  const turn: Turn = { id: "turn", status: "inProgress", items: [
    { id: "question", type: "userMessage" },
    { id: "tool", type: "commandExecution" },
    { id: "previous-answer", type: "agentMessage" },
    ...Array.from({ length: 9 }, (_, index) => ({ id: `later-tool-${index}`, type: "commandExecution" })),
  ] };
  const start = { turnId: turn.id, itemId: "previous-answer" };
  expect(messageWindow([turn], { start }).start).toEqual(start);
  turn.items.push({ id: "latest-answer", type: "agentMessage" });
  const next = messageWindow([turn], { start });
  expect(next.start?.itemId).toBe("tool");
  expect(next.entries[0].items).toHaveLength(12);
  expect(messageWindow([turn], { start: next.start, older: true }).start?.itemId).toBe("question");
});

it("does not count hidden continuation instructions as earlier messages", () => {
  const turns: Turn[] = [{ id: "stopped", status: "interrupted", items: [] },
    { id: "continue", status: "interrupted", items: [{ id: "instruction", type: "userMessage",
      content: [{ type: "text", text: CONTINUE_MESSAGE }] }] },
    { id: "reply", status: "completed", items: [{ id: "answer", type: "agentMessage" }] }];
  const range = messageWindow(turns);
  expect(range.start?.itemId).toBe("answer");
  expect(range.hasMore).toBe(false);
});
