// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TurnDuration } from "./TurnDuration";
import { conversation, reduceConversation } from "../../../../../shared/conversation/events";
import { formatTurnDuration, turnElapsedMs } from "../../../../../shared/conversation/turnTiming";
import type { Thread, Turn } from "../../../../../shared/conversation/types";

const thread: Thread = { id: "one", cwd: "", preview: "", updatedAt: 1 };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("ticks locally, pauses the hidden view, catches up, and freezes at completion", async () => {
  const turn: Turn = { id: "live", status: "inProgress", items: [], startedAt: 100 };
  const render = (active: boolean) => act(async () => root.render(
    <TurnDuration turn={turn} running active={active} />));
  await render(true);
  expect(container.textContent).toBe("已处理 0秒");
  await act(async () => { vi.advanceTimersByTime(11_000); });
  expect(container.textContent).toBe("已处理 11秒");
  await render(false);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(9_000);
  await render(true);
  expect(container.textContent).toBe("已处理 20秒");
  await act(async () => root.render(<TurnDuration turn={{ ...turn, status: "completed", durationMs: 20_000 }}
    running={false} active />));
  expect(container.textContent).toBe("用时 20秒");
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60_000);
  expect(container.textContent).toBe("用时 20秒");
});

it("preserves fallback timing across repeated events and history reloads", () => {
  const turn: Turn = { id: "live", status: "inProgress", items: [] };
  let value = reduceConversation(conversation(thread), { method: "turn/started", params: { turn } });
  vi.advanceTimersByTime(20_000);
  value = reduceConversation(value, { method: "turn/started", params: { turn } });
  value = reduceConversation(value, { method: "turn/completed", params: { turn: { ...turn, status: "completed" } } });
  vi.advanceTimersByTime(10_000);
  value = reduceConversation(value, { method: "turn/completed", params: { turn: { ...turn, status: "completed" } } });
  const restored = conversation({ ...thread, turns: [{ ...turn, status: "completed" }] }, value);
  expect(turnElapsedMs(restored.turns[0], Date.now())).toBe(20_000);
});

it("uses authoritative historical timing and leaves unknown history unlabeled", () => {
  const turn: Turn = { id: "old", status: "completed", items: [] };
  expect(turnElapsedMs(turn, Date.now())).toBeNull();
  expect(turnElapsedMs({ ...turn, startedAt: 100, completedAt: 120 }, Date.now())).toBe(20_000);
  expect(turnElapsedMs({ ...turn, durationMs: 11_000 }, Date.now())).toBe(11_000);
  expect(formatTurnDuration(61_000)).toBe("1分1秒");
  expect(formatTurnDuration(3_661_000)).toBe("1小时1分1秒");
});
