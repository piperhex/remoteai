import { describe, expect, it } from "vitest";
import { conversation, reduceConversation, reduceEvent } from "../../../../../shared/conversation/events";
import { initialState } from "./preferences";
import type { GuiEvent, Thread } from "../../../../../shared/conversation/types";
import { requestErrorDetails } from "../../../../../shared/conversation/requestError";
import { turnMessageGroups } from "./turnMessageGroups";
import { requestErrorPosition } from "../../../../../shared/conversation/turnRequestErrors";

const thread: Thread = { id: "one", cwd: "", preview: "", updatedAt: 1,
  turns: [{ id: "first", status: "inProgress", items: [] }] };
const retry = (turnId = "first"): GuiEvent => ({ method: "error", params: { threadId: "one", turnId,
  willRetry: true, error: { message: "HTTP 502 Bad Gateway", additionalDetails: "upstream timed out" } } });

describe("request errors belong to their turn", () => {
  it("keeps upstream reasons while hiding echoed credentials", () => {
    const text = requestErrorDetails({ message: "HTTP 502: Bearer test-secret",
      additionalDetails: 'upstream timeout: https://user:pass@example.com?token=query-secret, "api_key":"key-secret"' });
    expect(text).toContain("HTTP 502");
    expect(text).toContain("upstream timeout");
    for (const secret of ["test-secret", "user:pass", "query-secret", "key-secret"]) expect(text).not.toContain(secret);
    expect(requestErrorDetails({ message: " same ", additionalDetails: "same" })).toBe("same");
  });

  it("retains retry details after completion, history refresh, and a new reply", () => {
    let value = reduceConversation(conversation(thread), retry());
    const records = value.turns[0].requestErrors;
    expect(value.error).toBe("");
    expect(value.turns[0].retryError).toEqual(retry().params.error);
    value = reduceConversation(value, { method: "turn/completed", params: {
      turn: { id: "first", status: "completed", items: [], error: null } } });
    value = conversation({ ...thread, turns: [{ id: "first", status: "completed", items: [] }] }, value);
    value = reduceConversation(value, { method: "turn/started", params: {
      turn: { id: "second", status: "inProgress", items: [] } } });
    expect(value.turns[0].retryError).toEqual(retry().params.error);
    expect(value.turns[0].requestErrors).toEqual(records);
    expect(value.turns[1].retryError).toBeUndefined();
    expect(value.turns[1].error).toBeUndefined();
    expect(value.turns[1].requestErrors).toBeUndefined();
  });

  it("coalesces retries at one position and preserves later failures separately", () => {
    let value = reduceConversation(conversation(thread), retry());
    const firstId = value.turns[0].requestErrors![0].id;
    value = reduceConversation(value, retry());
    expect(value.turns[0].requestErrors).toHaveLength(1);
    expect(value.turns[0].requestErrors![0].id).toBe(firstId);
    value = reduceConversation(value, { method: "item/completed", params: { turnId: "first",
      item: { id: "command", type: "commandExecution", command: "npm test", status: "completed" } } });
    value = reduceConversation(value, { method: "error", params: { turnId: "first", willRetry: false,
      error: { message: "HTTP 429" } } });
    const turn = value.turns[0];
    expect(turn.requestErrors?.map((record) => record.afterItemId)).toEqual([null, "command"]);
    expect(turn.requestErrors?.map((record) => record.willRetry)).toEqual([true, false]);
    expect(turnMessageGroups(turn, { visibleItems: turn.items, followsInterruption: false })
      .map((group) => group.type)).toEqual(["error", "work", "error"]);
  });

  it("anchors final errors delivered only by completion and avoids duplicate lifecycle errors", () => {
    let value = reduceConversation(conversation(thread), retry());
    const completed: GuiEvent = { method: "turn/completed", params: { turn: {
      id: "first", status: "failed", error: { message: "HTTP 429" },
      items: [{ id: "partial", type: "agentMessage", text: "部分回复" }],
    } } };
    value = reduceConversation(value, completed);
    value = reduceConversation(value, completed);
    value = conversation({ ...thread, turns: [completed.params.turn!] }, value);
    expect(value.turns[0].requestErrors).toHaveLength(2);
    expect(value.turns[0].requestErrors?.at(-1)?.afterItemId).toBe("partial");
    expect(value.turns[0].requestErrors?.at(-1)?.willRetry).toBe(false);
  });

  it("keeps errors at hidden reasoning and replaced local echoes without moving them to the end", () => {
    const items = [{ id: "echo", type: "userMessage", localEcho: true },
      { id: "empty", type: "reasoning", summary: [] }];
    let value = reduceConversation(conversation({ ...thread,
      turns: [{ ...thread.turns![0], items: [items[0]] }] }), retry());
    value = reduceConversation(value, { method: "item/completed", params: { turnId: "first",
      item: { id: "server", type: "userMessage" } } });
    value = reduceConversation(value, { method: "item/started", params: { turnId: "first", item: items[1] } });
    value = reduceConversation(value, retry());
    value = reduceConversation(value, { method: "item/completed", params: { turnId: "first",
      item: { id: "answer", type: "agentMessage", text: "完成" } } });
    const turn = value.turns[0];
    expect(turn.requestErrors?.map((record) => requestErrorPosition(turn, record))).toEqual([1, 2]);
    const options = { visibleItems: turn.items, followsInterruption: false };
    expect(turnMessageGroups(turn, options).map((group) => group.type))
      .toEqual(["message", "error", "error", "message"]);
    expect(turnMessageGroups(turn, { ...options, visibleItems: turn.items.slice(2) })
      .filter((group) => group.type === "error")).toHaveLength(1);
  });

  it("replaces retry details with the latest error and retains the final failure", () => {
    let value = reduceConversation(conversation(thread), retry());
    value = reduceConversation(value, { method: "error", params: { turnId: "first", willRetry: false,
      error: { message: "HTTP 429 Too Many Requests", additionalDetails: "quota exceeded" } } });
    value = reduceConversation(value, { method: "turn/completed", params: {
      turn: { id: "first", status: "failed", items: [] } } });
    expect(value.error).toBe("");
    expect(value.turns[0].error?.additionalDetails).toBe("quota exceeded");
  });

  it('keeps errors beyond the newer edge of a bounded window unmounted', () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ id: `item-${index}`, type: 'agentMessage' }));
    const turn = { id: 'long', status: 'completed', items, requestErrors: items.map((item, index) => ({
      id: `error-${index}`, afterItemId: item.id, itemCount: index + 1, willRetry: true,
      error: { message: 'Retry' },
    })) };
    const groups = turnMessageGroups(turn, { visibleItems: items.slice(0, 10), followsInterruption: false });
    expect(groups.filter(group => group.type === 'error')).toHaveLength(10);
  });

  it("uses the active turn for older events and never assigns background errors to the selected conversation", () => {
    const value = conversation(thread);
    const notification = retry();
    delete notification.params.turnId;
    const state = { ...initialState(), selected: "two", conversations: {
      one: value, two: conversation({ ...thread, id: "two" }),
    } };
    const next = reduceEvent(state, notification);
    expect(next.conversations.one.turns[0].retryError).toBeDefined();
    expect(next.conversations.two.turns[0].retryError).toBeUndefined();
    const noActive = { ...value, activeTurn: null };
    expect(reduceConversation(noActive, notification).turns).toBe(noActive.turns);
  });
});
