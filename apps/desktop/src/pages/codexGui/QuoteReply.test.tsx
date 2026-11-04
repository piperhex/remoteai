// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer, type ComposerHandle } from "./Composer";
import { Messages } from "./Messages";
import { GuiController } from "./controller";
import { conversation } from "../../../../../shared/conversation/events";
import { initialState } from "./preferences";
import { testModels } from "../../../../../shared/conversation/testing/models";
import type { GuiState } from "../../../../../shared/conversation/types";

vi.mock("./UsageStatus", () => ({ UsageStatus: () => null }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("./ProjectPicker", () => ({ ProjectPicker: () => null }));
vi.mock("./AccessPicker", () => ({ AccessPicker: () => null }));
vi.mock("./ComposerAddMenu", () => ({ ComposerAddMenu: () => null }));
let root: Root;
let host: HTMLDivElement;
let controller: GuiController;
let state: GuiState;
const originalBounds = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
function Fixture({ state, active = true }: { state: GuiState; active?: boolean }) {
  const composer = useRef<ComposerHandle>(null);
  return <Messages selected={state.selected} value={state.conversations[state.selected ?? ""]} active={active}
    onQuote={state.archived ? undefined : (quote) => composer.current?.addQuote(quote) ?? false}
    footer={<Composer ref={composer} state={state} controller={controller} active={active} />} />;
}
const render = (active = true) => act(async () => root.render(<Fixture state={state} active={active} />));
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (label: string) => act(async () => button(label).click());
async function select(selector = '[data-quote-source="answer"] p', text = "默认方块") {
  await act(async () => {
    const node = host.querySelector(selector)!.firstChild!;
    const start = node.textContent!.indexOf(text);
    const range = document.createRange();
    range.setStart(node, start); range.setEnd(node, start + text.length);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true,
    value: () => ({ left: 50, bottom: 60, width: 80, height: 20 }) });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  controller = new GuiController();
  vi.spyOn(controller, "send").mockResolvedValue(true);
  state = { ...initialState(), models: testModels, selected: "one", connection: "ready", conversations: {
    one: conversation({ id: "one", cwd: "D:/project", preview: "", updatedAt: 1, turns: [
      { id: "turn", status: "completed", items: [
        { id: "question", type: "userMessage", content: [{ type: "text", text: "我的问题" }] },
        { id: "answer", type: "agentMessage", text: "这是默认方块，技能自带的图标会优先显示。\n\n第二段回答。" },
      ] },
    ] }),
  } };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalBounds) Object.defineProperty(Range.prototype, "getBoundingClientRect", originalBounds);
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

it("quotes selected assistant text, focuses the draft, previews it and sends it with the reply", async () => {
  await select();
  expect(window.getSelection()?.toString()).toBe("默认方块");
  expect(button("引用选中文字并回复")).not.toBeNull();
  await click("引用选中文字并回复");
  const editor = host.querySelector<HTMLDivElement>('[role="textbox"]')!;
  expect(document.activeElement).toBe(editor);
  expect(button("查看 1 条引用")).not.toBeNull();
  await click("查看 1 条引用");
  expect(document.querySelector("blockquote")?.textContent).toBe("默认方块");
  await act(async () => {
    editor.textContent = "请解释这段内容";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  await click("发送消息");
  expect(controller.send).toHaveBeenCalledWith("引用 AI 回答：\n> 默认方块\n\n请解释这段内容", [], []);
  expect(button("查看 1 条引用")).toBeNull();
});

it("supports multiple snippets, deduplicates them, and removes one or all quotes", async () => {
  for (const text of ["默认方块", "默认方块", "技能自带的图标"]) {
    await select(undefined, text); await click("引用选中文字并回复");
  }
  await click("查看 2 条引用");
  expect(document.querySelectorAll("blockquote")).toHaveLength(2);
  await click("移除第 1 条引用");
  expect(button("查看 1 条引用")).not.toBeNull();
  expect(document.querySelector("blockquote")?.textContent).toBe("技能自带的图标");
  await click("移除全部引用");
  expect(button("查看 1 条引用")).toBeNull();
});

it("dismisses stale selections and keeps quotes with their conversation", async () => {
  await select();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(button("引用选中文字并回复")).toBeNull();
  await select(); await click("引用选中文字并回复");
  await select();
  state = { ...state, selected: null };
  await render();
  expect(button("引用选中文字并回复")).toBeNull();
  expect(button("查看 1 条引用")).toBeNull();
  state = { ...state, selected: "one" };
  await render();
  expect(button("查看 1 条引用")).not.toBeNull();
  await select();
  await act(async () => window.dispatchEvent(new Event("scroll")));
  expect(button("引用选中文字并回复")).toBeNull();
  await select(); await render(false);
  expect(button("引用选中文字并回复")).toBeNull();
});

it("does not quote user messages, the composer, or archived conversations", async () => {
  await select("article:not(:has([data-quote-source])) div div", "我的问题");
  expect(button("引用选中文字并回复")).toBeNull();
  await act(async () => {
    const editor = host.querySelector('[role="textbox"]')!;
    editor.textContent = "草稿内容";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  await select('[role="textbox"]', "草稿内容");
  expect(button("引用选中文字并回复")).toBeNull();
  state = { ...state, archived: true };
  await render(); await select();
  expect(button("引用选中文字并回复")).toBeNull();
});

it("does not reopen a dismissed quote menu when a queued selection event arrives", async () => {
  await select();
  await act(async () => window.dispatchEvent(new Event("scroll")));
  await act(async () => document.dispatchEvent(new Event("selectionchange")));
  expect(button("引用选中文字并回复")).toBeNull();
  expect(window.getSelection()?.toString()).toBe("默认方块");
  await select();
  expect(button("引用选中文字并回复")).not.toBeNull();
});
