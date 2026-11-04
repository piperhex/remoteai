// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UsageStatus } from "./UsageStatus";
import { invoke } from "../../api/backend";
import { parseContextCapacity } from "./useContextSettings";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isHostedWebApp: false, canManageCodexConnection: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let root: Root;
let container: HTMLDivElement;
const click = (element: HTMLElement) => act(async () => element.click());
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const footerButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".ant-modal-footer button")]
  .find((element) => element.textContent?.replace(/ /g, "") === label)!;
const input = () => document.querySelector<HTMLInputElement>('input[aria-label="上下文容量（K Token）"]')!;
const render = (threadId = "one") => act(async () => root.render(<UsageStatus active threadId={threadId} />));
async function openSettings() {
  await click(button("查看上下文用量"));
  expect(document.querySelector(".ant-popover")?.textContent).toContain("背景信息窗口");
  expect(document.querySelector(".ant-popover")?.textContent).not.toContain("背景信息窗口：");
  await click(button("设置当前对话的上下文容量"));
}
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const computed = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => computed(element));
  vi.mocked(invoke).mockReset().mockImplementation((command) => command === "codex_gui_context_settings"
    ? Promise.resolve({ capacity: 128_000 }) : new Promise(() => {}));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("opens while polling is pending, saves only this conversation and restores defaults", async () => {
  await render(); await openSettings();
  expect(input().value).toBe("128");
  expect(document.querySelector(".ant-modal")?.textContent).toContain("正在回复时会先暂停，修改后自动继续");
  await type("256");
  vi.mocked(invoke).mockResolvedValueOnce({ capacity: 256_000 });
  await click(footerButton("保存"));
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_context_settings",
    { threadId: "one", settings: { capacity: 256_000 } });
  expect(document.querySelector(".ant-modal")).toBeNull();
  await openSettings();
  await click([...document.querySelectorAll<HTMLButtonElement>(".ant-modal button")]
    .find((element) => element.textContent === "恢复默认")!);
  vi.mocked(invoke).mockResolvedValueOnce({ capacity: null });
  await click(footerButton("保存"));
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_context_settings",
    { threadId: "one", settings: { capacity: null } });
});

it("validates input and retains edits after a failed save without exposing internal errors", async () => {
  await render(); await openSettings(); await type("-1"); await click(footerButton("保存"));
  expect(invoke).not.toHaveBeenCalledWith("codex_gui_set_context_settings", expect.anything());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("请输入");
  await type("512"); vi.mocked(invoke).mockRejectedValueOnce(new Error("secret-path"));
  await click(footerButton("保存"));
  expect(input().value).toBe("512");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("未能保存");
  expect(document.body.textContent).not.toContain("secret-path");
  vi.mocked(invoke).mockResolvedValueOnce({ capacity: 512_000 }); await click(footerButton("保存"));
  expect(document.querySelector(".ant-modal")).toBeNull();
});

it("shows the saved GUI capacity before the next reply and keeps conversation settings separate", async () => {
  const capacities = new Map([["one", 128_000], ["two", 400_000]]);
  vi.mocked(invoke).mockImplementation((command, args) => {
    const request = args as { threadId: string; settings?: { capacity: number } };
    if (command === "codex_gui_context_settings") {
      return Promise.resolve({ capacity: capacities.get(request.threadId) ?? null });
    }
    if (command === "codex_gui_set_context_settings") {
      capacities.set(request.threadId, request.settings!.capacity);
      return Promise.resolve(request.settings);
    }
    return new Promise(() => {});
  });
  await render(); await openSettings(); await type("300"); await click(footerButton("保存"));
  await click(button("查看上下文用量"));
  expect(document.querySelector(".ant-popover")?.textContent).toContain("对话设置：300K Token");
  await render("two"); await click(button("查看上下文用量"));
  expect(document.querySelector(".ant-popover")?.textContent).toContain("对话设置：400K Token");
  expect(document.querySelector(".ant-popover")?.textContent).not.toContain("300K");
});

it("discards stale loads when switching conversations and prevents saving before a successful read", async () => {
  await render();
  let resolve!: (value: { capacity: number }) => void;
  vi.mocked(invoke).mockResolvedValueOnce({ capacity: 128_000 });
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await openSettings(); expect(footerButton("保存").disabled).toBe(true);
  await render("two"); await openSettings(); expect(input().value).toBe("128");
  await act(async () => resolve({ capacity: 999_000 })); expect(input().value).toBe("128");
  await type("256"); vi.mocked(invoke).mockResolvedValueOnce({ capacity: 256_000 });
  await click(footerButton("保存"));
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_context_settings",
    { threadId: "two", settings: { capacity: 256_000 } });
});

it("offers retry after a failed read", async () => {
  await render();
  vi.mocked(invoke).mockResolvedValueOnce({ capacity: 128_000 }).mockRejectedValueOnce(new Error("private"));
  await openSettings();
  expect(footerButton("保存").disabled).toBe(true);
  await click([...document.querySelectorAll<HTMLButtonElement>(".ant-modal button")]
    .find((element) => element.textContent === "重试")!);
  expect(input().value).toBe("128"); expect(footerButton("保存").disabled).toBe(false);
});

it.each([["", null], [" ", null], ["128", 128_000], ["1.001", 1_001], ["0", undefined],
  ["-1", undefined], ["NaN", undefined], ["Infinity", undefined], ["100001", undefined],
  ["1.0001", undefined]])("parses capacity %j", (value, expected) => {
  expect(parseContextCapacity(value as string)).toBe(expected);
});

it("selects every preset without saving until confirmed while polling is pending", async () => {
  await render(); await openSettings();
  for (const capacity of [128, 272, 384, 400, 1000]) {
    await act(async () => input().dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    const option = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")]
      .find((element) => element.textContent === `${capacity}K`)!;
    expect(option).toBeTruthy();
    await click(option);
    expect(input().value).toBe(String(capacity));
    expect(invoke).not.toHaveBeenCalledWith("codex_gui_set_context_settings", expect.anything());
  }
  vi.mocked(invoke).mockResolvedValueOnce({ capacity: 1_000_000 });
  await click(footerButton("保存"));
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_context_settings",
    { threadId: "one", settings: { capacity: 1_000_000 } });
});

it("uses Enter to select a preset without prematurely saving the previous value", async () => {
  await render(); await openSettings(); await type("256");
  await act(async () => input().dispatchEvent(new KeyboardEvent("keydown",
    { key: "ArrowDown", keyCode: 40, bubbles: true })));
  await act(async () => input().dispatchEvent(new KeyboardEvent("keydown",
    { key: "Enter", keyCode: 13, bubbles: true })));
  expect(input().value).toBe("128");
  expect(invoke).not.toHaveBeenCalledWith("codex_gui_set_context_settings", expect.anything());
  vi.mocked(invoke).mockResolvedValueOnce({ capacity: 128_000 });
  await click(footerButton("保存"));
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_context_settings",
    { threadId: "one", settings: { capacity: 128_000 } });
});

it("keeps the dialog actionable when capacity is saved but continuing the task fails", async () => {
  await render(); await openSettings(); await type("384");
  vi.mocked(invoke).mockResolvedValueOnce({ capacity: 384_000, update: "resumeFailed" });
  await click(footerButton("保存"));
  expect(input().value).toBe("384");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("容量已更新，但未能继续回复");
  expect(footerButton("取消").disabled).toBe(false);
});

it("prevents duplicate saves and closing while the conversation is being paused and resumed", async () => {
  await render(); await openSettings(); await type("384");
  let finish!: (result: { capacity: number; update: string }) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await click(footerButton("保存"));
  expect(footerButton("取消").disabled).toBe(true);
  expect(input().disabled).toBe(true);
  expect(document.querySelector('[aria-label="Close"]')).toBeNull();
  await act(async () => finish({ capacity: 384_000, update: "continued" }));
  expect(document.querySelector(".ant-modal")).toBeNull();
});
