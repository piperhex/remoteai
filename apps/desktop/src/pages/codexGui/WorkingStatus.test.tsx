// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkingStatus } from "./WorkingStatus";
import { restoreProcessing } from "./processing";
import type { Turn } from "./types";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("ticks phase and total time, suspends inactive timers, and catches up when returning", async () => {
  const turn: Turn = { id: "turn", status: "inProgress", startedAt: 60, items: [] };
  const processing = { ...restoreProcessing(turn), phase: "command" as const, startedAtMs: 90_000 };
  const render = (active: boolean) => act(async () => root.render(
    <WorkingStatus turn={turn} processing={processing} active={active} />));
  await render(true);
  expect(host.textContent).toBe("正在执行命令 · 10秒 (共计40秒)");
  await act(async () => { vi.advanceTimersByTime(12_000); });
  expect(host.textContent).toBe("正在执行命令 · 22秒 (共计52秒)");
  expect(vi.getTimerCount()).toBe(1);
  await render(false);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(50_000);
  expect(host.textContent).toBe("正在执行命令 · 22秒 (共计52秒)");
  await render(true);
  expect(host.textContent).toBe("正在执行命令 · 1分12秒 (共计1分42秒)");
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("resets only the phase time when activity changes and keeps time through streaming renders", async () => {
  const turn: Turn = { id: "turn", status: "inProgress", startedAt: 90, items: [] };
  const processing = restoreProcessing(turn);
  await act(async () => root.render(<WorkingStatus turn={turn} processing={processing} active />));
  expect(host.textContent).toBe("等待响应 · 10秒 (共计10秒)");
  await act(async () => { vi.advanceTimersByTime(3_000); });
  const response = { ...processing, phase: "response" as const, startedAtMs: Date.now() };
  await act(async () => root.render(<WorkingStatus turn={turn} processing={response} active />));
  expect(host.textContent).toBe("正在生成回复 · 0秒 (共计13秒)");
  await act(async () => { vi.advanceTimersByTime(2_000); });
  await act(async () => root.render(<WorkingStatus turn={{ ...turn, items: [
    { id: "reply", type: "agentMessage", text: "新增内容" },
  ] }} processing={response} active />));
  expect(host.textContent).toBe("正在生成回复 · 2秒 (共计15秒)");
});

it("times pending requests before the server creates a turn", async () => {
  await act(async () => root.render(<WorkingStatus active
    pendingRequest={{ threadId: "thread", startedAtMs: 95_000 }} />));
  expect(host.textContent).toBe("正在发送请求 · 5秒 (共计5秒)");
  await act(async () => { vi.advanceTimersByTime(3_000); });
  expect(host.textContent).toBe("正在发送请求 · 8秒 (共计8秒)");
});

it("preserves the fallback start across renders and resets it for the next turn", async () => {
  const turn: Turn = { id: "first", status: "inProgress", items: [] };
  await act(async () => root.render(<WorkingStatus turn={turn} active />));
  await act(async () => { vi.advanceTimersByTime(6_000); });
  await act(async () => root.render(<WorkingStatus turn={{ ...turn }} active />));
  expect(host.textContent).toBe("等待响应 · 6秒 (共计6秒)");
  await act(async () => root.render(<WorkingStatus turn={{ ...turn, id: "next" }} active />));
  expect(host.textContent).toBe("等待响应 · 0秒 (共计0秒)");
  await act(async () => root.render(<WorkingStatus turn={{ ...turn, id: "next", status: "completed" }} active />));
  expect(vi.getTimerCount()).toBe(0);
});
