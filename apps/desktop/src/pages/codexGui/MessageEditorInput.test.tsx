// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserMessage } from "./UserMessage";
import { MessageEditContext } from "./messageEditContext";
import { guiApi } from "../../../../../shared/conversation/api";
import * as draftImages from "../../../../../shared/chat/draftImages";
import { readEditor } from "./skillEditorDom";
import type { Content } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { request: vi.fn() } }));
const skill = { name: "review", path: "D:/skills/review/SKILL.md", description: "检查代码", enabled: true };
const image = "data:image/png;base64,iVBORw0KGgo=";
const submit = vi.fn(async () => false);
let host: HTMLDivElement;
let root: Root;
const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"]')!;
const button = (label: string) => [...host.querySelectorAll("button")]
  .find((entry) => entry.getAttribute("aria-label") === label || entry.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const key = (value: string, options = {}) => act(async () => {
  editor().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }));
});
async function type(text: string) {
  await act(async () => {
    editor().textContent = text;
    const range = document.createRange();
    range.setStart(editor().firstChild!, text.length); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    editor().dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}
async function paste(files = [new File(["image"], "pasted.png", { type: "image/png" })]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: {
    items: files.map((file) => ({ kind: "file", getAsFile: () => file })), getData: () => "",
  } });
  await act(async () => editor().dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}
async function render(parts: Content[] = []) {
  await act(async () => root.render(<MessageEditContext.Provider value={{ cwd: "D:/project", active: true }}>
    <UserMessage item={{ id: "message", type: "userMessage",
      content: [{ type: "text", text: "原问题" }, ...parts] }} onEdit={submit} />
  </MessageEditContext.Provider>));
  await click("编辑消息");
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  submit.mockReset().mockResolvedValue(false);
  vi.mocked(guiApi.request).mockResolvedValue({ data: [{ skills: [skill], errors: [] }] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("pastes images inside the editor, blocks sending until loaded, and preserves them on failure", async () => {
  let finish!: (url: string) => void;
  vi.spyOn(draftImages, "readImage").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render([{ type: "image", url: image }]);
  await paste(); await key("Enter");
  expect(submit).not.toHaveBeenCalled(); expect(button("发送").disabled).toBe(true);
  await act(async () => finish(image));
  expect(editor().closest("article")?.querySelectorAll('[aria-label^="放大查看"]')).toHaveLength(2);
  await click("移除图片 1"); await click("发送");
  expect(submit).toHaveBeenCalledExactlyOnceWith({ text: "原问题", images: [image], removedImageIndexes: [0] });
  expect(host.querySelectorAll('[aria-label^="放大查看"]')).toHaveLength(1);
  await click("取消编辑"); await click("编辑消息");
  expect(host.querySelectorAll('[aria-label^="移除图片"]')).toHaveLength(1);
});

it("does not resurrect a pasted image removed while reading", async () => {
  let finish!: (url: string) => void;
  vi.spyOn(draftImages, "readImage").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(); await paste(); await click("移除图片 1");
  await act(async () => finish(image)); await click("发送");
  expect(submit).toHaveBeenCalledExactlyOnceWith({ text: "原问题" });
  expect(host.querySelector('[aria-label^="移除图片"]')).toBeNull();
});

it("counts retained images toward the limit and permits a replacement after removal", async () => {
  vi.spyOn(draftImages, "readImage").mockResolvedValue(image);
  await render(Array.from({ length: 8 }, () => ({ type: "image", url: image })));
  await paste(); expect(host.textContent).toContain("最多添加 8 张图片");
  expect(draftImages.readImage).not.toHaveBeenCalled();
  await click("移除图片 2"); await paste(); await click("发送");
  expect(submit).toHaveBeenCalledWith({ text: "原问题", images: [image], removedImageIndexes: [1] });
});

it("reports invalid or failed images and leaves the editor usable", async () => {
  await render();
  await paste([new File(["text"], "note.txt", { type: "text/plain" })]);
  expect(host.textContent).toContain("请粘贴 PNG");
  vi.spyOn(draftImages, "readImage").mockRejectedValue(new Error("read failed"));
  await paste(); expect(host.textContent).toContain("图片读取失败");
  expect(button("发送").disabled).toBe(false);
});

it("selects a project skill with slash and sends its explicit reference alongside pasted images", async () => {
  vi.spyOn(draftImages, "readImage").mockResolvedValue(image);
  await render(); await paste(); await type("请用 /review");
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "skills", cwd: "D:/project" });
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  await key("Enter");
  expect(submit).not.toHaveBeenCalled(); expect(host.querySelector('[data-skill]')).not.toBeNull();
  await key("Enter");
  expect(submit).toHaveBeenCalledWith({ text: "请用 $review ", images: [image],
    skills: [{ name: skill.name, path: skill.path }] });
  expect(readEditor(editor()).mentions).toHaveLength(1);
});

it("restores original skills as chips, lets them be removed, and cancels without changing the source", async () => {
  await render([{ type: "skill", name: skill.name, path: skill.path }]);
  expect(readEditor(editor()).mentions).toHaveLength(1);
  await type("移除技能"); await click("发送");
  expect(submit).toHaveBeenCalledWith({ text: "移除技能", skills: [] });
  await click("取消编辑"); await click("编辑消息");
  expect(readEditor(editor()).mentions).toHaveLength(1);
});

it("dismisses the skill menu before Escape cancels editing", async () => {
  await render(); await type("/"); await key("Escape");
  expect(editor()).not.toBeNull(); expect(host.querySelector('[role="listbox"]')).toBeNull();
  await key("Escape"); expect(editor()).toBeNull();
});

it('sends edits with Enter, reserves Shift+Enter for a newline, and ignores IME confirmation', async () => {
  const insert = vi.fn();
  Object.defineProperty(document, 'execCommand', { configurable: true, value: insert });
  await render();
  await key('Enter', { shiftKey: true });
  expect(insert).toHaveBeenCalledWith('insertLineBreak');
  await key('Enter', { isComposing: true });
  await key('Enter', { keyCode: 229 });
  expect(submit).not.toHaveBeenCalled();
  await key('Enter');
  expect(submit).toHaveBeenCalledExactlyOnceWith({ text: '原问题' });
  Reflect.deleteProperty(document, 'execCommand');
});
