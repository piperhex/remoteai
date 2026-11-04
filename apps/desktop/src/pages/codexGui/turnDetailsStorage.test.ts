// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { conversation } from "../../../../../shared/conversation/events";
import { rememberTurnDetails } from "../../../../../shared/conversation/turnDetailsStorage";

afterEach(() => sessionStorage.clear());
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
  sessionStorage.setItem("codex-switch:gui-turn-details:v1", 'not json');
  const thread = { id: "thread", preview: "", cwd: "", updatedAt: 1, turns: [] };
  expect(conversation(thread).turns).toEqual([]);
  const value = conversation({ ...thread, turns: [{ id: "big", status: "completed", items: [], diff: "x".repeat(600_000) }] });
  rememberTurnDetails(value, "big");
  expect(sessionStorage.getItem("codex-switch:gui-turn-details:v1")).toBe("[]");
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
