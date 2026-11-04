// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkillInput } from "./SkillInput";
import { guiApi } from "../../../../../shared/conversation/api";
import { readEditor } from "./skillEditorDom";
import type { ComposerText, Skill } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { request: vi.fn() } }));
const skills: Skill[] = [
  { name: "deploy-codex-switch", path: "D:/skills/deploy/SKILL.md", description: "部署服务", enabled: true,
    interface: { displayName: "Deploy Remote AI" } },
  { name: "review", path: "D:/skills/review/SKILL.md", description: "检查代码", enabled: true },
];
let root: Root;
let host: HTMLDivElement;
const send = vi.fn();
const paste = vi.fn();
const compact = vi.fn();
function Fixture({ cwd = "D:/project", canCompact = true }: { cwd?: string; canCompact?: boolean }) {
  const [value, setValue] = useState<ComposerText>({ text: "", mentions: [] });
  return <SkillInput value={value} draftKey="new" cwd={cwd} active connected disabled={false}
    compact={{ enabled: canCompact, description: "压缩此对话的上下文（已使用 30%）", percent: 30, run: compact }}
    placeholder="输入 / 选择 Skill" onChange={setValue} onPaste={paste} onSend={send} />;
}
const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"]')!;
const key = async (value: string, options = {}) => act(async () => {
  editor().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }));
});
async function type(text: string, caret = text.length) {
  await act(async () => {
    editor().textContent = text;
    const range = document.createRange();
    range.setStart(editor().firstChild!, caret);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    editor().dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.mocked(guiApi.request).mockResolvedValue({ data: [{ skills, errors: [] }] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("inserts QQ rich-text content as plain text after the image handler runs", async () => {
  const insert = vi.fn();
  Object.defineProperty(document, "execCommand", { configurable: true, value: insert });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: {
    items: [], getData: (type: string) => type === "text/html"
      ? '<b>图片说明</b><br>第二行<img src="file:///C:/QQ/photo.png">' : "",
  } });
  await act(async () => editor().dispatchEvent(event));
  expect(paste).toHaveBeenCalledOnce();
  expect(insert).toHaveBeenCalledWith("insertText", false, "图片说明\n第二行");
  expect(editor().querySelector("img")).toBeNull();
  Reflect.deleteProperty(document, "execCommand");
});

it("lists every skill after an initial slash and inserts a named, atomic inline skill", async () => {
  await type("/");
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "skills", cwd: "D:/project" });
  await key("ArrowDown");
  await key("Enter");
  expect(send).not.toHaveBeenCalled();
  expect(host.querySelector('[data-skill]')?.textContent).toBe("Deploy Remote AI");
  expect(host.querySelector('[data-skill]')?.getAttribute("contenteditable")).toBe("false");
  expect(readEditor(editor()).mentions[0].skill.path).toBe(skills[0].path);
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  await key("Enter");
  expect(send).toHaveBeenCalledOnce();
});

it("replaces only the slash query at the caret and preserves surrounding Chinese text", async () => {
  await type("请使用 /deploy 检查服务", "请使用 /deploy".length);
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(readEditor(editor()).text).toBe("请使用 $deploy-codex-switch  检查服务");
  expect(readEditor(editor()).mentions[0].start).toBe(4);
});

it("does not trigger inside paths or URLs and supports keyboard navigation and dismissal", async () => {
  for (const text of ["https://", "src/", "hello/"]) {
    await type(text);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  }
  await type("使用 /");
  await key("ArrowDown");
  await key("ArrowDown");
  await key("Tab");
  expect(readEditor(editor()).mentions[0].skill.name).toBe("review");
  await type("/");
  await key("Escape");
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it("does not send while choosing an empty result or composing Chinese text", async () => {
  await type("/missing");
  expect(host.textContent).toContain("没有找到匹配的命令或技能");
  await key("Enter");
  await key("Escape");
  await key("Enter", { isComposing: true });
  expect(send).not.toHaveBeenCalled();
});

it("discards stale lists after a project change", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await type("/");
  await act(async () => root.render(<Fixture cwd="D:/other" />));
  await act(async () => resolve({ data: [{ skills, errors: [] }] }));
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  await type("/");
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: "skills", cwd: "D:/other" });
});

it("shows load failures and retries when slash is entered again", async () => {
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("unavailable"));
  await type("/");
  expect(host.textContent).toContain("技能加载失败");
  await key("Escape");
  await type("/");
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);
});

it.each(["/", "/compact", "/压缩"])("runs compaction from %s without sending a message", async (query) => {
  await type(query);
  expect(host.querySelector('[role="option"]')?.textContent).toContain("已使用 30%");
  await key("Enter");
  expect(compact).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
  expect(readEditor(editor())).toEqual({ text: "", mentions: [] });
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it("keeps compaction available when skill loading fails and preserves surrounding draft text", async () => {
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("offline"));
  await type("稍后 /compact 继续", "稍后 /compact".length);
  await act(async () => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(compact).toHaveBeenCalledOnce();
  expect(readEditor(editor()).text).toBe("稍后  继续");
  expect(send).not.toHaveBeenCalled();
});

it("does not run or erase the draft when compaction is unavailable", async () => {
  await act(async () => root.render(<Fixture canCompact={false} />));
  await type("/compact");
  expect(host.querySelector('[role="option"]')?.getAttribute("aria-disabled")).toBe("true");
  await key("Enter");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(compact).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(readEditor(editor()).text).toBe("/compact");
});
