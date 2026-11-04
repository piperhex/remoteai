import { describe, expect, it } from "vitest";
import { conversation, reduceConversation, reduceEvent } from "../../../../../shared/conversation/events";
import { initialState } from "./preferences";
import type { GuiEvent, Item, Thread } from "../../../../../shared/conversation/types";

const thread: Thread = { id: "one", cwd: "D:/project", preview: "hello", updatedAt: 1, turns: [] };
const event = (method: string, params: GuiEvent["params"]): GuiEvent => ({
  method, params: { threadId: "one", turnId: "turn", ...params },
});

describe("Codex GUI event projection", () => {
  it("tracks assistant setup separately from chat connection errors", () => {
    const initial = { ...initialState(), connection: "connecting" as const, error: "existing error" };
    const installing = reduceEvent(initial, { method: "computerUse/setup",
      params: { computerUseSetup: "installing" } });
    expect(installing.computerUseSetup).toBe("installing");
    const failed = reduceEvent(installing, { method: "computerUse/setup",
      params: { computerUseSetup: "failed" } });
    expect(failed.computerUseSetup).toBe("failed");
    expect(failed.connection).toBe("connecting");
    expect(failed.error).toBe("existing error");
    expect(failed.approvals).toEqual([]);
    expect(reduceEvent(failed, { method: "computerUse/setup", params: { computerUseSetup: "ready" } })
      .computerUseSetup).toBe("ready");
  });

  it("keeps current context separate from cumulative tokens and retains it when reopening a conversation", () => {
    const usage = { total: { totalTokens: 11_670_000 }, last: { totalTokens: 121_260 }, modelContextWindow: 258_000 };
    const value = reduceConversation(conversation(thread), event("thread/tokenUsage/updated", { tokenUsage: usage }));
    expect(value.tokens).toBe(11_670_000);
    expect(value.tokenUsage).toEqual(usage);
    expect(conversation(thread, value).tokenUsage).toEqual(usage);
    expect(conversation(thread, value).tokens).toBe(value.tokens);
    expect(conversation({ ...thread, id: "two" }).tokenUsage).toBeUndefined();
    expect(reduceConversation(value, event("thread/tokenUsage/updated", {})).tokenUsage).toEqual(usage);
    const compacted = { ...usage, last: { totalTokens: 20_000 } };
    expect(reduceConversation(value, event("thread/tokenUsage/updated", { tokenUsage: compacted })).tokenUsage)
      .toEqual(compacted);
  });

  it("restores persisted context estimates without overwriting a live update", () => {
    const tokenUsage = { total: { totalTokens: 8744228 }, last: { totalTokens: 206357 },
      contextTokens: 247017, modelContextWindow: 258400 };
    const restored = conversation({ ...thread, tokenUsage });
    expect(restored.tokenUsage?.contextTokens).toBe(247017);
    expect(restored.tokens).toBe(8744228);
    const newer = reduceConversation(restored, event("thread/tokenUsage/updated", {
      tokenUsage: { ...tokenUsage, contextTokens: 16273 },
    }));
    expect(conversation({ ...thread, tokenUsage }, newer).tokenUsage?.contextTokens).toBe(16273);
  });

  it("attaches plan and net diff to their turn and retains both when reopening history", () => {
    let value = conversation(thread);
    const first = { id: "turn", status: "inProgress", items: [] };
    value = reduceConversation(value, event("turn/started", { turn: first }));
    value = reduceConversation(value, event("turn/diff/updated", { diff: "first diff" }));
    value = reduceConversation(value, event("turn/plan/updated", {
      plan: [{ step: "测试", status: "inProgress" }], explanation: "检查修改" }));
    value = reduceConversation(value, event("turn/completed", { turn: { ...first, status: "completed" } }));
    value = reduceConversation(value, event("turn/started", { turn: { ...first, id: "next" } }));
    value = reduceConversation(value, event("turn/diff/updated", { turnId: "next", diff: "second diff" }));
    const restored = conversation({ ...thread, turns: value.turns.map(({ diff, plan, planExplanation, ...turn }) => turn) },
      value);
    expect(restored.turns[0]).toMatchObject({ diff: "first diff", planExplanation: "检查修改",
      plan: [{ step: "测试", status: "inProgress" }] });
    expect(restored.turns[1].diff).toBe("second diff");
    expect(restored.turns[1].plan).toBeUndefined();
  });

  it("never treats tool output or unknown deltas as an assistant reply", () => {
    let value = conversation(thread);
    value = reduceConversation(value, event("item/fileChange/outputDelta", { itemId: "patch", delta: "applied" }));
    value = reduceConversation(value, event("item/plan/delta", { itemId: "plan", delta: "Check tests" }));
    value = reduceConversation(value, event("item/unknown/delta", { itemId: "unknown", delta: "internal" }));
    expect(value.turns[0].items.map((item) => item.type)).toEqual(["fileChange", "plan"]);
    expect(value.turns[0].items[0].aggregatedOutput).toBe("applied");
    value = reduceConversation(value, event("item/completed", { item: { id: "patch", type: "fileChange",
      status: "completed", changes: [] } }));
    expect(value.turns[0].items[0].aggregatedOutput).toBe("applied");
  });

  it("keeps the question and execution history when completion contains only the final answer", () => {
    const items: Item[] = [
      { id: "question", type: "userMessage", content: [{ type: "text", text: "Check the project" },
        { type: "image", url: "data:image/png;base64,fixture" }] },
      { id: "reason", type: "reasoning", summary: ["Inspect the project first"] },
      { id: "command", type: "commandExecution", command: "npm test", aggregatedOutput: "PASS",
        status: "completed", exitCode: 0 },
      { id: "answer", type: "agentMessage", text: "Tests" },
    ];
    let value = conversation(thread);
    for (const item of items) value = reduceConversation(value, event("item/completed", { item }));
    const completion = event("turn/completed", { turn: { id: "turn", status: "completed",
      items: [{ ...items[3], text: "Tests passed" }] } });
    value = reduceConversation(value, completion);
    value = reduceConversation(value, completion);
    expect(value.turns[0].items).toEqual([...items.slice(0, 3), { ...items[3], text: "Tests passed" }]);
    expect(value.turns[0].status).toBe("completed");
    expect(value.activeTurn).toBeNull();
  });

  it("includes items delivered with turn start and appends a new final answer on completion", () => {
    const question: Item = { id: "question", type: "userMessage", content: [{ type: "text", text: "Hello" }] };
    let value = reduceConversation(conversation(thread), event("turn/started", {
      turn: { id: "turn", status: "inProgress", items: [question] } }));
    expect(value.turns[0].items).toEqual([question]);
    const answer: Item = { id: "answer", type: "agentMessage", text: "Hello!" };
    value = reduceConversation(value, event("turn/completed", {
      turn: { id: "turn", status: "completed", items: [answer] } }));
    expect(value.turns[0].items).toEqual([question, answer]);
  });

  it("reconciles streamed deltas with authoritative completed items without duplicates", () => {
    let value = conversation(thread);
    value = reduceConversation(value, event("turn/started", { turn: { id: "turn", status: "inProgress", items: [] } }));
    value = reduceConversation(value, event("item/agentMessage/delta", { itemId: "answer", delta: "hel" }));
    value = reduceConversation(value, event("item/agentMessage/delta", { itemId: "answer", delta: "lo" }));
    expect(value.turns[0].items[0].text).toBe("hello");
    value = reduceConversation(value, event("item/completed", {
      item: { id: "answer", type: "agentMessage", text: "hello!" } }));
    value = reduceConversation(value, event("turn/completed", {
      turn: { id: "turn", status: "completed", items: [] } }));
    expect(value.turns[0].items).toHaveLength(1);
    expect(value.turns[0].items[0].text).toBe("hello!");
    expect(value.activeTurn).toBeNull();
  });

  it("keeps command output and indexed reasoning parts separate from assistant text", () => {
    let value = conversation(thread);
    value = reduceConversation(value, event("item/commandExecution/outputDelta", { itemId: "cmd", delta: "PASS\n" }));
    value = reduceConversation(value, event("item/reasoning/summaryTextDelta", {
      itemId: "reason", delta: "step 2", summaryIndex: 1 }));
    expect(value.turns[0].items[0].aggregatedOutput).toBe("PASS\n");
    expect(value.turns[0].items[1].summary?.[1]).toBe("step 2");
  });

  it("preserves simultaneous background conversations and resolves approvals", () => {
    const state = { ...initialState(), selected: "two", conversations: { one: conversation(thread) } };
    const pending: GuiEvent = { ...event("item/fileChange/requestApproval", {}), id: 0 };
    let value = reduceEvent(state, pending);
    expect(value.approvals).toHaveLength(1);
    value = reduceEvent(value, event("item/agentMessage/delta", { itemId: "answer", delta: "background" }));
    expect(value.selected).toBe("two");
    expect(value.conversations.one.turns[0].items[0].text).toBe("background");
    value = reduceEvent(value, event("serverRequest/resolved", { requestId: 0 }));
    expect(value.approvals).toHaveLength(0);
  });

  it("clears stale running indicators and approvals on connection loss", () => {
    const value = conversation({ ...thread, turns: [{ id: "turn", status: "inProgress", items: [] }] });
    const state = { ...initialState(), conversations: { one: value }, sending: true };
    const next = reduceEvent(state, event("connection/closed", {}));
    expect(next.conversations.one.activeTurn).toBeNull();
    expect(next.connection).toBe("offline");
    expect(next.sending).toBe(false);
  });
});
