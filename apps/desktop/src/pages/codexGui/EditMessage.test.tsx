// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Messages } from "./Messages";
import { conversation } from "../../../../../shared/conversation/events";
import type { Thread } from "../../../../../shared/conversation/types";

const thread: Thread = { id: "thread", cwd: "", preview: "", updatedAt: 1, turns: [
  { id: "first", status: "completed", items: [{ id: "old", type: "userMessage",
    content: [{ type: "text", text: "第一条问题" }] }] },
  { id: "last", status: "completed", items: [{ id: "latest", type: "userMessage",
    content: [{ type: "text", text: "最后的问题" }] },
  { id: "answer", type: "agentMessage", text: "原回复" }] },
] };
let root: Root;
let container: HTMLDivElement;
const onEdit = vi.fn(async () => true);
const onDelete = vi.fn(async () => true);
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  onEdit.mockReset().mockResolvedValue(true);
  onDelete.mockReset().mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

async function render(disabled = false, selected = thread.id, source = thread) {
  await act(async () => root.render(<Messages selected={selected} value={conversation(source)}
    onEdit={onEdit} onDelete={onDelete} editDisabled={disabled} />));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")]
    .find((entry) => entry.getAttribute("aria-label") === label || entry.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function type(text: string) {
  const editor = container.querySelector('[role="textbox"]')!;
  await act(async () => {
    editor.textContent = text;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}

it("places edit immediately after copy only on the latest user message", () => {
  const buttons = container.querySelectorAll('[aria-label="编辑消息"]');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].previousElementSibling?.getAttribute("aria-label")).toBe("复制消息");
  expect(buttons[0].closest("article")?.textContent).toContain("最后的问题");
});

it("cancels without sending or changing the conversation and resets the draft", async () => {
  await click("编辑消息"); await type("取消的修改"); await click("取消编辑");
  expect(onEdit).not.toHaveBeenCalled();
  expect(container.textContent).toContain("最后的问题");
  expect(container.textContent).toContain("原回复");
  await click("编辑消息");
  expect(container.querySelector('[role="textbox"]')?.textContent).toBe("最后的问题");
});

it("submits the edited text with the original message position", async () => {
  await click("编辑消息"); await type("修改后的问题"); await click("发送");
  expect(onEdit).toHaveBeenCalledExactlyOnceWith({ threadId: "thread", turnId: "last",
    itemId: "latest", text: "修改后的问题" });
  expect(container.querySelector('[role="textbox"]')).toBeNull();
});

it('deletes from the original message only after confirmation, even with an empty draft', async () => {
  await click('编辑消息'); await type(''); await click('删除消息');
  expect(onDelete).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('这条消息及之后的所有消息都会删除，无法撤销。');
  const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('.ant-popconfirm button')]
    .find(button => button.textContent?.replaceAll(' ', '') === '删除')!;
  await act(async () => confirm.click());
  expect(onDelete).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread', turnId: 'last', itemId: 'latest' });
  expect(onEdit).not.toHaveBeenCalled();
  expect(container.querySelector('[role="textbox"]')).toBeNull();
});

it("retains the draft on failure and blocks blank submissions", async () => {
  onEdit.mockResolvedValue(false);
  await click("编辑消息"); await type("重试的内容"); await click("发送");
  expect(container.querySelector('[role="textbox"]')?.textContent).toBe("重试的内容");
  await type("  "); await click("发送");
  expect(onEdit).toHaveBeenCalledTimes(1);
});

it("disables editing while busy and discards drafts when switching conversations", async () => {
  await render(true); await click("编辑消息");
  expect(container.querySelector('[role="textbox"]')).toBeNull();
  await render(); await click("编辑消息"); await type("未发送的内容");
  await render(false, "other");
  expect(container.querySelector('[role="textbox"]')).toBeNull();
  expect(onEdit).not.toHaveBeenCalled();
});

it("allows Escape to cancel and prevents duplicate submissions", async () => {
  await click("编辑消息");
  await act(async () => container.querySelector('[role="textbox"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[role="textbox"]')).toBeNull();
  let finish!: (value: boolean) => void;
  onEdit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await click("编辑消息"); await click("发送"); await click("发送");
  expect(onEdit).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
});

function threadWithImages(): Thread {
  const source = structuredClone(thread);
  source.turns![1].items[0].content = [{ type: "text", text: "最后的问题" },
    ...[1, 2, 3].map((index) => ({ type: "image", url: `https://example.com/${index}.png` }))];
  return source;
}

it("keeps image removals in the draft and restores all images on cancel", async () => {
  await render(false, thread.id, threadWithImages());
  await click("编辑消息");
  await click("移除图片 1");
  await click("移除图片 3");
  expect(container.querySelectorAll('[aria-label^="放大查看："]')).toHaveLength(1);
  await click("取消编辑");
  expect(onEdit).not.toHaveBeenCalled();
  expect(container.querySelectorAll('[aria-label^="放大查看："]')).toHaveLength(3);
  await click("编辑消息");
  expect(container.querySelectorAll('[aria-label^="移除图片"]')).toHaveLength(3);
});

it("submits original image positions and retains removals after a failed send", async () => {
  await render(false, thread.id, threadWithImages());
  onEdit.mockResolvedValue(false);
  await click("编辑消息"); await click("移除图片 1"); await click("移除图片 3");
  await click("发送");
  expect(onEdit).toHaveBeenCalledExactlyOnceWith({ threadId: "thread", turnId: "last",
    itemId: "latest", text: "最后的问题", removedImageIndexes: [0, 2] });
  expect(container.querySelectorAll('[aria-label^="放大查看："]')).toHaveLength(1);
  expect(container.querySelector('[aria-label="移除图片 2"]')).not.toBeNull();
});
