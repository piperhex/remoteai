// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TurnMessage } from "./TurnMessage";
import type { Item, Turn } from "../../../../../shared/conversation/types";

let root: Root;
let container: HTMLDivElement;
const comment: Item = { id: "progress", type: "agentMessage", phase: "commentary", text: "正在核对两次结果" };
const command: Item = { id: "cmd", type: "commandExecution", status: "completed", command: "echo DISPLAY",
  aggregatedOutput: "DISPLAY" };
const final: Item = { id: "reply", type: "agentMessage", phase: "final_answer", text: "两次结果均正确" };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function render(items: Item[], running: boolean) {
  const turn: Turn = { id: "turn", status: running ? "inProgress" : "completed", startedAt: Date.now() / 1000,
    durationMs: running ? undefined : 32_000, items };
  await act(async () => root.render(<TurnMessage turn={turn} running={running} active />));
}
async function toggle(details: HTMLDetailsElement, open: boolean) {
  await act(async () => { details.open = open; details.dispatchEvent(new Event("toggle")); });
}

it("does not show a process entry for empty reasoning and counts only displayable activities", async () => {
  const empty: Item = { id: "reason", type: "reasoning", summary: [" ", "\n"], content: [] };
  await render([empty, final], true);
  expect(container.querySelector("details")).toBeNull();
  await render([empty, command, final], false);
  expect(container.querySelector("summary")?.getAttribute("aria-label")).toBe("处理过程，1 项活动");
  expect(container.textContent).toContain("两次结果均正确");
});

it("uses one timing disclosure and folds automatically opened progress after completion", async () => {
  await render([comment, command], true);
  expect(container.textContent).toContain("正在核对两次结果");
  expect(container.querySelector('[aria-label="复制消息"]')).toBeNull();
  const process = container.querySelector("details")!;
  expect(process.open).toBe(true);
  await render([comment, command, final], false);
  expect(container.querySelector("details")).toBe(process);
  expect(process.open).toBe(false);
  expect(process.querySelector("summary")?.textContent).toBe("用时 32秒");
  expect(container.textContent).not.toContain("正在核对两次结果");
  expect(container.textContent?.match(/用时/g)).toHaveLength(1);
  expect(container.textContent).toContain("两次结果均正确");
  await toggle(process, true);
  expect(container.textContent).toContain("正在核对两次结果");
  expect(container.querySelectorAll('[aria-label="复制消息"]')).toHaveLength(1);
});

it("keeps a manually inspected command open when the final reply arrives", async () => {
  await render([comment, command], true);
  const process = container.querySelector("details")!;
  const details = container.querySelector<HTMLDetailsElement>('[data-message-id="cmd"] details')!;
  await toggle(details, true);
  await render([comment, command, final], false);
  expect(process.open).toBe(true);
  expect(details.open).toBe(true);
  expect(container.textContent).toContain("DISPLAY");
});

it("keeps steering and final replies outside folded process blocks in chronological order", async () => {
  const steer: Item = { id: "steer", type: "userMessage", content: [{ type: "text", text: "只检查输出" }] };
  await render([comment, steer, command, final], false);
  expect(container.querySelectorAll("summary")).toHaveLength(2);
  const visible = [...container.querySelectorAll("article")];
  expect(visible).toHaveLength(2);
  expect(visible[0].textContent).toContain("只检查输出");
  expect(visible[1].textContent).toBe("两次结果均正确");
  expect(visible.every((node) => !node.closest("details"))).toBe(true);
});

it.each(["interrupted", "failed"])("preserves partial progress when a turn is %s", async (status) => {
  await render([comment, command], true);
  const process = container.querySelector("details")!;
  const turn: Turn = { id: "turn", status, durationMs: 23_000, items: [comment, command] };
  await act(async () => root.render(<TurnMessage turn={turn} running={false} active />));
  expect(container.querySelector("details")).toBe(process);
  expect(process.open).toBe(true);
  expect(container.textContent).toContain("正在核对两次结果");
  if (status === "interrupted") {
    expect(process.querySelector("summary")?.textContent).toBe("已停止生成 · 用时 23秒");
    expect(container.textContent?.match(/已停止生成/g)).toHaveLength(1);
  }
});

it("labels an interrupted command as stopped and preserves its partial output", async () => {
  const stoppedCommand: Item = { ...command, status: "interrupted", aggregatedOutput: "部分输出" };
  const turn: Turn = { id: "turn", status: "interrupted", durationMs: 23_000, items: [comment, stoppedCommand] };
  await act(async () => root.render(<TurnMessage turn={turn} running={false} active />));
  const details = container.querySelector<HTMLDetailsElement>('[data-message-id="cmd"] details')!;
  expect(details.querySelector("summary")?.textContent).toBe("已停止 echo DISPLAY");
  await toggle(details, true);
  expect(details.textContent).toContain("部分输出");
});

it("keeps interrupted text visible and places its single stop notice before the partial reply", async () => {
  const partial: Item = { ...final, status: "interrupted", text: "第一段完成，第二段写到这里" };
  const turn: Turn = { id: "turn", status: "interrupted", items: [partial] };
  await act(async () => root.render(<TurnMessage turn={turn} running={false} active />));
  expect(container.querySelector("details")).toBeNull();
  expect(container.textContent?.match(/已停止生成/g)).toHaveLength(1);
  expect(container.textContent?.indexOf("已停止生成")).toBeLessThan(container.textContent!.indexOf(partial.text!));
  expect(container.querySelector('[aria-label="复制消息"]')).not.toBeNull();
});
