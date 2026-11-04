// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageItem } from "./MessageItem";
import { conversation, reduceConversation } from "../../../../../shared/conversation/events";
import type { Item } from "../../../../../shared/conversation/types";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

async function renderItem(item: Item) {
  await act(async () => root.render(<MessageItem item={item} streaming={false} />));
}

async function openDetails() {
  const details = container.querySelector("details")!;
  await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
}

it.each([
  ["started", "已启动协作任务"], ["interacted", "协作消息"],
  ["interrupted", "已停止协作任务"], ["completed", "协作任务已完成"],
])("shows the task and %s event in live updates and restored history", async (kind, label) => {
  const item: Item = { id: "activity", type: "subAgentActivity", kind,
    agentThreadId: "agent-id", agentPath: "/root/singapore_weather" };
  const thread = { id: "thread", cwd: "D:/project", preview: "天气预报", updatedAt: 1 };
  const live = reduceConversation(conversation(thread), { method: "item/completed",
    params: { threadId: thread.id, turnId: "turn", item } });
  for (const value of [live, conversation({ ...thread, turns: live.turns })]) {
    await renderItem(value.turns[0].items[0]);
    expect(container.querySelector("summary")?.textContent).toBe(`${label} · singapore_weather`);
    await openDetails();
    expect(container.textContent).not.toContain('"agentThreadId"');
    expect(container.textContent).not.toContain("/root/");
  }
});

it("distinguishes a finished wait from running and completed child tasks", async () => {
  const item: Item = { id: "wait", type: "collabAgentToolCall", tool: "wait", status: "inProgress",
    receiverThreadIds: ["singapore", "hongkong"] };
  await renderItem(item);
  expect(container.querySelector("summary")?.textContent).toBe("等待协作进展 · 2 个任务 · 进行中");
  await openDetails();
  await renderItem({ ...item, status: "completed", agentsStates: {
    singapore: { status: "running" }, hongkong: { status: "completed", message: "香港周末有雨。" },
  } });
  expect(container.querySelector("summary")?.textContent).toBe("等待协作进展 · 2 个任务 · 本次等待结束");
  expect(container.textContent).toContain("协作任务 1 · 进行中");
  expect(container.textContent).toContain("协作任务 2 · 已完成");
  expect(container.textContent).toContain("香港周末有雨。");
  expect(container.querySelector("details")?.open).toBe(true);
});

it("keeps a wait without agent states readable without claiming child completion", async () => {
  await renderItem({ id: "wait", type: "collabAgentToolCall", tool: "wait", status: "completed" });
  await openDetails();
  expect(container.querySelector("summary")?.textContent).toBe("等待协作进展 · 本次等待结束");
  expect(container.textContent).not.toContain("已完成");
});

it.each([
  ["spawnAgent", "启动协作任务"], ["sendInput", "发送任务说明"], ["resumeAgent", "继续协作任务"],
  ["closeAgent", "关闭协作任务"], ["sendMessage", "发送协作消息"], ["followupTask", "追加协作任务"],
  ["interruptAgent", "停止协作任务"], ["listAgents", "查看协作任务"],
])("labels %s operations in readable language", async (tool, label) => {
  await renderItem({ id: "tool", type: "collabAgentToolCall", tool, status: "completed" });
  expect(container.querySelector("summary")?.textContent).toBe(`${label} · 已完成`);
});

it("renders legacy task status and the full task description", async () => {
  await renderItem({ id: "legacy", type: "collabToolCall", tool: "spawnAgent", prompt: "查询新加坡天气。",
    agentStatus: { status: "errored", message: "天气查询暂时不可用。" } });
  await openDetails();
  expect(container.textContent).toContain("查询新加坡天气。");
  expect(container.textContent).toContain("协作任务 1 · 失败");
  expect(container.textContent).toContain("天气查询暂时不可用。");
});

it("gives future activity kinds a readable fallback with the task identity", async () => {
  await renderItem({ id: "future", type: "subAgentActivity", kind: "newKind", agentPath: "/root/hongkong_weather" });
  expect(container.querySelector("summary")?.textContent).toBe("协作进度更新 · hongkong_weather");
});
