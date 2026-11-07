// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TurnMessage } from "./TurnMessage";
import { conversation, reduceConversation } from "../../../../../shared/conversation/events";
import type { Conversation, Item } from "../../../../../shared/conversation/types";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

const before: Item = { id: "before", type: "agentMessage", phase: "commentary", text: "中断前的进度" };
const after: Item = { id: "after", type: "agentMessage", phase: "commentary", text: "恢复后的进度" };
const final: Item = { id: "final", type: "agentMessage", phase: "final_answer", text: "最终回复" };

async function render(value: Conversation) {
  const turn = value.turns[0];
  await act(async () => root.render(<TurnMessage turn={turn} running={turn.status === "inProgress"} active />));
}

function occursBefore(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

it("removes an expanded retry notice after streaming resumes and through history refresh", async () => {
  let value = conversation({ id: "thread", cwd: "", preview: "", updatedAt: 1,
    turns: [{ id: "turn", status: "inProgress", items: [before] }] });
  value = reduceConversation(value, { method: "error", params: { turnId: "turn", willRetry: true,
    error: { message: "HTTP 502" } } });
  await render(value);
  const notice = container.querySelector('[role="status"]')!.closest("details")!;
  occursBefore(container.querySelector('[data-message-id="before"]')!, notice);
  await act(async () => { notice.open = true; notice.dispatchEvent(new Event("toggle")); });
  value = reduceConversation(value, { method: "item/completed", params: { turnId: "turn", item: after } });
  await render(value);
  expect(container.querySelector("[data-request-error]")).toBeNull();
  expect(container.textContent).not.toContain("现已恢复");
  value = reduceConversation(value, { method: "turn/completed", params: {
    turn: { id: "turn", status: "completed", items: [final], error: null } } });
  value = conversation({ ...value.thread, turns: [{ id: "turn", status: "completed", items: [before, after, final] }] },
    value);
  await render(value);
  expect(container.querySelector("[data-request-error]")).toBeNull();
  expect(container.textContent).not.toContain("HTTP 502");
  expect(value.turns[0].requestErrors).toHaveLength(1);
  const processes = container.querySelectorAll<HTMLDetailsElement>('details:has(> summary[data-history-anchor])');
  expect(processes).toHaveLength(1);
  occursBefore(processes[0], container.querySelector('[data-message-id="final"]')!);
});

it("places a history-only failure after its content and before the plan summary", async () => {
  const value = conversation({ id: "thread", cwd: "", preview: "", updatedAt: 1, turns: [{
    id: "turn", status: "failed", items: [final], error: { message: "HTTP 503" },
    plan: [{ step: "待完成步骤", status: "pending" }],
  }] });
  await render(value);
  const notice = container.querySelector('[role="status"]')!.closest("details")!;
  occursBefore(container.querySelector('[data-message-id="final"]')!, notice);
  const plan = [...container.querySelectorAll("summary")].find((node) => node.textContent?.includes("任务计划"));
  expect(plan).toBeDefined();
  occursBefore(notice, plan!);
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
});
