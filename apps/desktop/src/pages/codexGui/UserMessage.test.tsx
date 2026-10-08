// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import type { Content } from "./types";
import { ImageThreadContext } from "./useImageSource";
import { UserMessage } from "./UserMessage";

vi.mock("./api", () => ({ guiApi: { request: vi.fn() } }));
const thumbnail = "data:image/png;base64,dGh1bWJuYWls";
const original = "data:image/png;base64,b3JpZ2luYWw=";
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value(this: HTMLDialogElement) { this.open = true; },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

async function render(image: Content) {
  await act(async () => root.render(<ImageThreadContext.Provider value="task">
    <UserMessage item={{ id: "user", type: "userMessage", content: [image,
      { type: "text", text: "看看这张图片" }] }} />
  </ImageThreadContext.Provider>));
}

it.each(["C:\\images\\copied.jpg", "D:/截图.png"])(
  "shows a sent local image thumbnail and opens its original: %s", async (path) => {
    vi.mocked(guiApi.request).mockResolvedValueOnce({ url: thumbnail }).mockResolvedValue({ url: original });
    await render({ type: "localImage", path });
    expect(guiApi.request).toHaveBeenCalledWith({ operation: "imagePreview", threadId: "task",
      source: path, variant: "thumbnail" });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(thumbnail);
    expect(container.textContent).toContain("看看这张图片");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="放大查看：图片附件 1"]')?.click());
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.querySelector("dialog img")?.getAttribute("src")).toBe(thumbnail);
    expect(guiApi.request).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector<HTMLButtonElement>('.cs-image-original')!.click());
    expect(guiApi.request).toHaveBeenLastCalledWith({ operation: "imagePreview", threadId: "task",
      source: path, variant: "original" });
    expect(container.querySelector("dialog img")?.getAttribute("src")).toBe(original);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭图片"]')?.click());
    expect(container.querySelector("dialog")).toBeNull();
  },
);

it.each([thumbnail, "https://example.com/photo.jpg"])("keeps URL image attachments visible: %s", async (url) => {
  await render({ type: "image", url });
  expect(container.querySelector("img")?.getAttribute("src")).toBe(url);
  expect(guiApi.request).not.toHaveBeenCalled();
});

it("allows retrying a sent local image when the first read fails", async () => {
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("missing")).mockResolvedValue({ url: thumbnail });
  await render({ type: "localImage", path: "D:/copied.png" });
  expect(container.textContent).toContain("图片加载失败");
  await act(async () => container.querySelector<HTMLButtonElement>('[role="status"] button')?.click());
  expect(container.querySelector("img")?.getAttribute("src")).toBe(thumbnail);
});

it("restores historical quoted replies as a capsule with a compact preview", async () => {
  const text = "引用 AI 回答：\n> 下架异常上报\n\n下架异常上报使用上架异常上报的接口";
  await act(async () => root.render(<UserMessage item={{ id: "quote", type: "userMessage",
    content: [{ type: "text", text }] }} />));
  expect(container.textContent).not.toContain("引用 AI 回答：");
  expect(container.textContent).toContain("下架异常上报使用上架异常上报的接口");
  const chip = container.querySelector<HTMLButtonElement>('[aria-label="查看 1 条引用"]');
  expect(chip?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => chip?.click());
  expect(document.querySelector("blockquote")?.textContent).toBe("下架异常上报");
  expect(chip?.getAttribute("aria-expanded")).toBe("true");
  await act(async () => document.querySelector("blockquote")?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(chip?.getAttribute("aria-expanded")).toBe("false");
});

it("keeps ordinary blockquotes as text and handles quote-only messages", async () => {
  await act(async () => root.render(<UserMessage item={{ id: "plain", type: "userMessage",
    content: [{ type: "text", text: "普通消息\n> 保留原文" }] }} />));
  expect(container.textContent).toContain("普通消息\n> 保留原文");
  expect(container.querySelector('[aria-label="查看 1 条引用"]')).toBeNull();
  await act(async () => root.render(<UserMessage item={{ id: "quote", type: "userMessage",
    content: [{ type: "text", text: "引用对话内容：\n> 仅引用" }] }} />));
  expect(container.querySelector('[aria-label="查看 1 条引用"]')).not.toBeNull();
  expect(container.textContent).not.toContain("引用对话内容：");
});

const awareness = '<codex_gui_conversation_context>\n'
  + JSON.stringify({ kind: "awareness", running: [{ id: "other", cwd: "D:/private" }] })
  + '\n</codex_gui_conversation_context>';

it("keeps joined context out of the bubble, clipboard and message editor", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.mocked(guiApi.request).mockResolvedValue({ data: [] });
  await act(async () => root.render(<UserMessage onEdit={vi.fn()} item={{ id: "context", type: "userMessage",
    content: [{ type: "text", text: `正常消息${awareness}` }] }} />));
  expect(container.textContent).toBe("正常消息");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="复制消息"]')?.click());
  expect(writeText).toHaveBeenCalledWith("正常消息");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="编辑消息"]')?.click());
  expect(container.querySelector('[role="textbox"]')?.textContent).toBe("正常消息");
  expect(container.textContent).not.toContain("codex_gui_conversation_context");
  expect(container.textContent).not.toContain("D:/private");
});

it("does not show a bubble, timestamp or actions for context-only messages", async () => {
  await act(async () => root.render(<UserMessage startedAt={1} onEdit={vi.fn()}
    item={{ id: "hidden", type: "userMessage", content: [{ type: "text", text: awareness }] }} />));
  expect(container.innerHTML).toBe("");
});
