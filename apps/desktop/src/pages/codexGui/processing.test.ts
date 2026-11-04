import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { conversation, reduceConversation, reduceEvent } from "../../../../../shared/conversation/events";
import { initialState } from "./preferences";
import type { Conversation, EventParams, GuiEvent, GuiState, Thread } from "../../../../../shared/conversation/types";

const thread: Thread = { id: "one", cwd: "", preview: "", updatedAt: 1 };
const event = (method: string, params: EventParams = {}): GuiEvent => ({ method,
  params: { threadId: thread.id, turnId: "live", ...params } });
const start = () => reduceConversation(conversation(thread), event("turn/started", {
  turn: { id: "live", status: "inProgress", items: [] } }));
const item = (value: Conversation, id: string, type: string, completed = false) =>
  reduceConversation(value, event(completed ? "item/completed" : "item/started", { item: { id, type } }));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { vi.useRealTimers(); });

it("times waiting, reasoning, commands and responses without restarting on streaming chunks", () => {
  let value = start();
  expect(value.processing).toMatchObject({ phase: "request", startedAtMs: 100_000 });
  vi.advanceTimersByTime(3_000);
  value = item(value, "reason", "reasoning");
  expect(value.processing).toMatchObject({ phase: "reasoning", startedAtMs: 103_000 });
  vi.advanceTimersByTime(2_000);
  value = reduceConversation(value, event("item/reasoning/textDelta", { itemId: "reason", delta: "thinking" }));
  expect(value.processing?.startedAtMs).toBe(103_000);
  value = item(value, "reason", "reasoning", true);
  value = item(value, "command", "commandExecution");
  expect(value.processing).toMatchObject({ phase: "command", startedAtMs: 105_000 });
  vi.advanceTimersByTime(10_000);
  value = reduceConversation(value, event("item/commandExecution/outputDelta", { itemId: "command", delta: "PASS" }));
  expect(value.processing?.startedAtMs).toBe(105_000);
  value = item(value, "command", "commandExecution", true);
  expect(value.processing).toMatchObject({ phase: "request", startedAtMs: 115_000 });
  vi.advanceTimersByTime(1_000);
  value = reduceConversation(value, event("item/agentMessage/delta", { itemId: "answer", delta: "Hello" }));
  expect(value.processing).toMatchObject({ phase: "response", startedAtMs: 116_000 });
});

it("handles overlapping activities, repeated completions, late chunks and old turn events", () => {
  let value = item(start(), "first", "commandExecution");
  vi.advanceTimersByTime(2_000);
  value = item(value, "second", "commandExecution");
  vi.advanceTimersByTime(2_000);
  value = item(value, "first", "commandExecution", true);
  expect(value.processing).toMatchObject({ id: "second", phase: "command", startedAtMs: 102_000 });
  value = item(value, "second", "commandExecution", true);
  vi.advanceTimersByTime(1_000);
  value = item(value, "second", "commandExecution", true);
  value = reduceConversation(value, event("item/commandExecution/outputDelta", { itemId: "second", delta: "late" }));
  value = reduceConversation(value, event("item/started", { turnId: "old", item: { id: "old", type: "webSearch" } }));
  expect(value.processing).toMatchObject({ phase: "request", startedAtMs: 104_000 });
});

it("preserves phase timing across reloads and resets it for a new turn", () => {
  const value = item(start(), "tool", "mcpToolCall");
  vi.advanceTimersByTime(15_000);
  const restored = conversation({ ...thread, turns: value.turns }, value);
  expect(restored.processing).toEqual(value.processing);
  const next = reduceConversation(restored, event("turn/started", {
    turn: { id: "next", status: "inProgress", items: [] }, turnId: "next" }));
  expect(next.processing).toMatchObject({ turnId: "next", phase: "request", startedAtMs: 115_000 });
});

it.each(["completed", "interrupted", "failed"])("clears the timer state when a turn is %s", (status) => {
  const value = reduceConversation(item(start(), "tool", "mcpToolCall"), event("turn/completed", {
    turn: { id: "live", status, items: [] } }));
  expect(value.activeTurn).toBeNull();
  expect(value.processing).toBeUndefined();
});

it("times retrying until activity resumes without returning to a stale retry phase", () => {
  let value = item(start(), "reason", "reasoning");
  vi.advanceTimersByTime(3_000);
  value = reduceConversation(value, event("error", { willRetry: true }));
  vi.advanceTimersByTime(2_000);
  value = reduceConversation(value, event("error", { willRetry: true }));
  expect(value.processing).toMatchObject({ phase: "retry", startedAtMs: 103_000 });
  value = item(value, "answer", "agentMessage");
  expect(value.processing).toMatchObject({ phase: "response", startedAtMs: 105_000 });
  value = item(value, "answer", "agentMessage", true);
  expect(value.processing?.phase).toBe("request");
});

it("tracks approval waits independently and resumes processing after the last request is resolved", () => {
  let state: GuiState = { ...initialState(), selected: "another",
    conversations: { one: item(start(), "cmd", "commandExecution") } };
  const approval = { ...event("item/commandExecution/requestApproval"), id: 0 };
  state = reduceEvent(state, approval);
  vi.advanceTimersByTime(4_000);
  state = reduceEvent(state, approval);
  expect(state.conversations.one.processing).toMatchObject({ phase: "approval", startedAtMs: 100_000 });
  state = reduceEvent(state, { ...event("item/tool/requestUserInput"), id: 1 });
  expect(state.conversations.one.processing).toMatchObject({ phase: "input", startedAtMs: 104_000 });
  state = reduceEvent(state, { method: "serverRequest/resolved", params: { requestId: 0 } });
  expect(state.conversations.one.processing?.phase).toBe("input");
  vi.advanceTimersByTime(3_000);
  state = reduceEvent(state, { method: "serverRequest/resolved", params: { requestId: 1 } });
  expect(state.conversations.one.processing).toMatchObject({ phase: "command", startedAtMs: 107_000 });
  expect(state.selected).toBe("another");
  state = reduceEvent(state, { method: "connection/closed", params: {} });
  expect(state.conversations.one.processing).toBeUndefined();
});
