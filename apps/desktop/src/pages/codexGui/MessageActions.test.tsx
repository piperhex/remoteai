// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TurnMessage } from "./TurnMessage";
import type { Turn } from "../../../../../shared/conversation/types";

let root: Root;
let container: HTMLDivElement;
const turn: Turn = { id: "turn", status: "completed", startedAt: 1724467200, completedAt: 1724467980,
  items: [{ id: "answer", type: "agentMessage", text: "测试1收到。" }] };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("renders a branch button without hover, forwards its action, and uses the completion time", async () => {
  const onFork = vi.fn();
  await act(async () => root.render(<TurnMessage turn={turn} running={false} active onFork={onFork} />));
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="分支到新聊天"]')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(onFork).toHaveBeenCalledOnce();
  expect(container.querySelector("time")?.dateTime).toBe(new Date(turn.completedAt! * 1000).toISOString());
  expect(container.querySelector("time")?.closest("[data-quote-exclude]")).not.toBeNull();
});

it("keeps the unavailable button visible without inventing missing history timestamps", async () => {
  await act(async () => root.render(<TurnMessage turn={{ ...turn, completedAt: undefined }}
    running={false} active forkDisabled onFork={vi.fn()} />));
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="分支到新聊天"]')?.disabled).toBe(true);
  expect(container.querySelector("time")).toBeNull();
});

it("does not expose final-answer actions while text is streaming", async () => {
  await act(async () => root.render(<TurnMessage turn={{ ...turn, status: "inProgress" }}
    running active onFork={vi.fn()} />));
  expect(container.querySelector('button[aria-label="分支到新聊天"]')).toBeNull();
});
