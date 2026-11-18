// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { conversation } from "../../../../../shared/conversation/events";
import { cachedTurnDetails, rememberTurnDetails } from "../../../../../shared/conversation/turnDetailsStorage";
import type { Conversation, Turn } from "../../../../../shared/conversation/types";

const key = "codex-switch:gui-turn-details:v1";
function update(turn: Pick<Turn, "id" | "diff" | "plan" | "planExplanation"> & { items?: Turn["items"] }) {
  const value: Conversation = { thread: { id: "thread", preview: "", cwd: "", updatedAt: 1 }, activeTurn: null,
    turns: [{ status: "completed", items: [], ...turn }], tokens: 0, error: "" };
  rememberTurnDetails(value, turn.id);
}

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });
it("restores each turn's net diff and plan after a fresh controller loads history", () => {
  const thread = { id: "thread", preview: "", cwd: "", updatedAt: 1, turns: [
    { id: "first", status: "completed", items: [], diff: "net patch", plan: [{ step: "检查", status: "completed" }] },
    { id: "next", status: "completed", items: [], diff: "next patch" },
  ] };
  const value = conversation(thread);
  rememberTurnDetails(value, "first"); rememberTurnDetails(value, "next");
  const history = { ...thread, turns: thread.turns.map(({ diff, plan, ...turn }) => turn) };
  expect(conversation(history).turns[0]).toMatchObject({ diff: "net patch", plan: [{ step: "检查", status: "completed" }] });
  expect(conversation(history).turns[1].diff).toBe("next patch");
  expect(conversation({ ...history, id: "other" }).turns[0].diff).toBeUndefined();
});
it("falls back to server history when optional metadata is malformed or too large", () => {
  sessionStorage.setItem(key, 'not json');
  const thread = { id: "thread", preview: "", cwd: "", updatedAt: 1, turns: [] };
  expect(conversation(thread).turns).toEqual([]);
  const value = conversation({ ...thread, turns: [{ id: "big", status: "completed", items: [], diff: "x".repeat(600_000) }] });
  rememberTurnDetails(value, "big");
  expect(sessionStorage.getItem(key)).toBe("[]");
});

it("restores model changes between the same messages after reopening history", () => {
  const user = { id: "user", type: "userMessage" };
  const marker = { id: "change", type: "modelChange", text: "模型已从 A 更改为 B", success: true,
    summary: ["将从下一次请求起生效。中途切换模型可能使响应变慢。"] };
  const answer = { id: "answer", type: "agentMessage", text: "Done" };
  const thread = { id: "thread", preview: "", cwd: "", updatedAt: 1,
    turns: [{ id: "turn", status: "completed", items: [user, marker, answer] }] };
  rememberTurnDetails(conversation(thread), "turn");
  const history = { ...thread, turns: [{ ...thread.turns[0], items: [user, answer] }] };
  expect(conversation(history).turns[0].items).toEqual([user, marker, answer]);
  expect(conversation(history, conversation(thread)).turns[0].items).toEqual([user, marker, answer]);
  expect(conversation({ ...history, id: "other" }).turns[0].items).toEqual([user, answer]);
});

it("counts escaped characters and serializes only the newest records that can fit", () => {
  const prior = Array.from({ length: 29 }, (_, index) => ({ threadId: "thread", turnId: `old-${index}`,
    diff: "a".repeat(15_000) }));
  sessionStorage.setItem(key, JSON.stringify(prior));
  const diff = "a\n".repeat(130_000);
  const stringify = vi.spyOn(JSON, "stringify");
  update({ id: "new", diff });
  const serialized = stringify.mock.calls.map(([value]) => value);
  stringify.mockRestore();
  expect(serialized.map(value => value.turnId)).toEqual([
    "new", ...prior.slice(-8).reverse().map(record => record.turnId),
  ]);
  expect(sessionStorage.getItem(key)!.length).toBeLessThanOrEqual(500_000);
  expect([...cachedTurnDetails("thread").keys()]).toEqual([...prior.slice(-7).map(record => record.turnId), "new"]);
  expect(cachedTurnDetails("thread").get("new")?.diff).toBe(diff);
});

it.each(["raw", "escaped"])("keeps plans and unrelated records when a %s diff is too large", kind => {
  const original = [{ threadId: "other", turnId: "turn", diff: "unrelated" },
    { threadId: "thread", turnId: "turn", diff: "outdated" }];
  sessionStorage.setItem(key, JSON.stringify(original));
  const diff = kind === "raw" ? "a".repeat(600_000) : '"'.repeat(260_000);
  const plan = [{ step: "Verify cache", status: "completed" }];
  const marker = { id: "marker", type: "modelChange" as const, text: "Model changed", success: true, summary: [] };
  const stringify = vi.spyOn(JSON, "stringify");
  update({ id: "turn", diff, plan, planExplanation: "Plan details", items: [marker] });
  const largeWrites = stringify.mock.calls.filter(([value]) => value.diff === diff).length;
  stringify.mockRestore();
  expect(largeWrites).toBe(kind === "raw" ? 0 : 1);
  expect(cachedTurnDetails("other").get("turn")).toEqual(original[0]);
  expect(cachedTurnDetails("thread").get("turn")).toEqual({ threadId: "thread", turnId: "turn", plan,
    planExplanation: "Plan details", modelChanges: [{ afterItemId: null, item: marker }] });
  update({ id: "turn", diff });
  expect(cachedTurnDetails("thread").has("turn")).toBe(false);
  expect(cachedTurnDetails("other").get("turn")).toEqual(original[0]);
});

it("keeps the thirty newest turns and skips an identical write", () => {
  for (let index = 0; index < 31; index++) update({ id: `turn-${index}`, diff: "patch" });
  const recent = Array.from({ length: 30 }, (_, index) => `turn-${index + 1}`);
  expect([...cachedTurnDetails("thread").keys()]).toEqual(recent);
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  update({ id: "turn-30", diff: "patch" });
  expect(setItem).not.toHaveBeenCalled();
});
