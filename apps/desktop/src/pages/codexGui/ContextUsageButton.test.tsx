// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UsageStatus } from "./UsageStatus";
import { invoke } from "../../api/backend";
import type { ThreadTokenUsage } from "../../../../../shared/conversation/types";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isHostedWebApp: false, canManageCodexConnection: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
const usage: ThreadTokenUsage = {
  total: { totalTokens: 11_670_000 }, last: { totalTokens: 121_260 }, modelContextWindow: 258_000,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockImplementation(() => new Promise(() => {}));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function render(tokenUsage: ThreadTokenUsage | undefined = usage, threadId = "one", active = true) {
  await act(async () => root.render(<UsageStatus active={active} threadId={threadId} tokenUsage={tokenUsage} />));
}
function button() { return container.querySelector<HTMLButtonElement>('[aria-label="查看上下文用量"]')!; }
async function click() { await act(async () => button().click()); }
function content() { return document.getElementById(button().getAttribute("aria-describedby") ?? ""); }

it("shows the compaction estimate while daily usage is pending and accepts a compaction decrease", async () => {
  await render({ ...usage, last: { totalTokens: 206_357 }, contextTokens: 247_017,
    modelContextWindow: 258_400 });
  await click();
  expect(content()?.textContent).toContain("96% 已用（剩余 4%）");
  expect(content()?.textContent).toContain("已用 247K Token，共 258.4K");
  await render({ ...usage, contextTokens: 0 });
  expect(content()?.textContent).toContain("0% 已用（剩余 100%）");
});

it("opens while usage requests are pending, refreshes live and closes with Escape or another click", async () => {
  await render();
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command !== "codex_gui_context_settings")).toHaveLength(0);
  expect(button().nextElementSibling?.textContent).toBe("11.67 M · — USD");
  await click();
  expect(content()?.textContent).toContain("47% 已用（剩余 53%）");
  expect(content()?.textContent).toContain("已用 121.3K Token，共 258K");
  await render({ ...usage, last: { totalTokens: 25_800 } });
  expect(content()?.textContent).toContain("10% 已用（剩余 90%）");
  await act(async () => button().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(button().getAttribute("aria-expanded")).toBe("false");
  await click();
  await click();
  expect(button().getAttribute("aria-expanded")).toBe("false");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command !== "codex_gui_context_settings")).toHaveLength(0);
});

it("closes on conversation changes and when hidden, without reusing another conversation's statistics", async () => {
  await render();
  await click();
  await render({ ...usage, last: { totalTokens: 0 } }, "two");
  expect(button().getAttribute("aria-expanded")).toBe("false");
  await click();
  expect(content()?.textContent).toContain("0% 已用（剩余 100%）");
  await render(usage, "two", false);
  expect(button().getAttribute("aria-expanded")).toBe("false");
});

it.each([
  [undefined, "暂无上下文用量"],
  [{ ...usage, modelContextWindow: null }, "上下文容量未知"],
  [{ ...usage, modelContextWindow: 0 }, "上下文容量未知"],
  [{ ...usage, last: { totalTokens: -1 } }, "暂无上下文用量"],
  [{ ...usage, last: { totalTokens: 300_000 } }, "100% 已用（剩余 0%）"],
])("handles missing or out-of-range context statistics (%j)", async (tokenUsage, expected) => {
  await act(async () => root.render(<UsageStatus active tokenUsage={tokenUsage} />));
  await click();
  expect(content()?.textContent).toContain(expected);
  expect(content()?.textContent).not.toContain("NaN");
});
