// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "../../../../../shared/conversation/api";
import { SkillInput } from "./SkillInput";
import { readEditor } from "./skillEditorDom";
import type { ComposerText, Thread } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { request: vi.fn() } }));
const threads: Thread[] = [
  { id: "self", name: "当前对话", preview: "", cwd: "D:/project", updatedAt: 3 },
  { id: "idle", name: "设计讨论", preview: "", cwd: "D:/design", updatedAt: 2, status: { type: "idle" } },
  { id: "running", name: "后台构建", preview: "", cwd: "D:/build", updatedAt: 1, status: { type: "active" } },
];
const choose = vi.fn();
const send = vi.fn();
let root: Root;
let host: HTMLDivElement;

function Fixture({ draftKey = "self", active = true }: { draftKey?: string; active?: boolean }) {
  const [value, onChange] = useState<ComposerText>({ text: "", mentions: [] });
  return <SkillInput value={value} draftKey={draftKey} cwd="D:/project" active={active} connected disabled={false}
    conversations={{ selected: draftKey, threads: [], conversations: {} }} onConversation={choose} onFile={choose}
    placeholder="@ 引用对话" onChange={onChange} onPaste={() => {}} onSend={send} />;
}
const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"]')!;
async function type(text: string, caret = text.length) {
  await act(async () => {
    editor().textContent = text;
    const range = document.createRange();
    range.setStart(editor().firstChild!, caret); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    editor().dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
}
const key = (value: string) => act(async () => {
  editor().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
});
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  vi.mocked(guiApi.request).mockResolvedValue({ data: threads, nextCursor: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("opens @ independently of sidebar, sorts running first and selects without sending", async () => {
  await type("参考 @ 后继续", "参考 @".length);
  const options = host.querySelectorAll('[role="option"]');
  expect(options).toHaveLength(2);
  expect(options[0].textContent).toContain("后台构建");
  expect(options[0].textContent).toContain("运行中");
  expect(guiApi.request).toHaveBeenCalledExactlyOnceWith({ operation: "list", archived: false,
    search: undefined, limit: 50 });
  await key("ArrowDown"); await key("Enter");
  expect(choose).toHaveBeenCalledWith({ kind: "conversation", name: "设计讨论", path: "codex-thread://idle" });
  expect(send).not.toHaveBeenCalled();
  expect(readEditor(editor()).text).toBe("参考  后继续");
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  await key("Enter"); expect(send).toHaveBeenCalledOnce();
});

it("searches older conversation titles and does not treat email addresses as references", async () => {
  await type("someone@example.com");
  expect(guiApi.request).not.toHaveBeenCalled();
  await type("@设计");
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: "list", archived: false, search: "设计", limit: 50 });
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  await key("Tab"); expect(choose).toHaveBeenCalledOnce();
});

it("keeps polling single flight and discards a delayed result after a conversation switch", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await type("@");
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(guiApi.request).toHaveBeenCalledOnce();
  await act(async () => root.render(<Fixture draftKey="other" />));
  await act(async () => finish({ data: threads, nextCursor: null }));
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(guiApi.request).toHaveBeenCalledOnce();
});

it("shows a load error, dismisses with Escape and never submits from an empty menu", async () => {
  vi.mocked(guiApi.request).mockRejectedValue(new Error("unavailable"));
  await type("@");
  expect(host.textContent).toContain("对话加载失败");
  await key("Enter"); expect(send).not.toHaveBeenCalled();
  await key("Escape"); expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it('searches project paths with % and references a folder without changing surrounding text', async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ directory: 'D:/project', parent: null, truncated: false,
    entries: [{ name: 'robot', path: 'D:/project/src/robot', relativePath: 'src/robot', directory: true }] });
  await type('完成 120%');
  expect(guiApi.request).not.toHaveBeenCalled();
  await type('参考 %src/robot 后继续', '参考 %src/robot'.length);
  expect(guiApi.request).toHaveBeenCalledExactlyOnceWith({ operation: 'projectFiles',
    cwd: 'D:/project', threadId: undefined, query: 'src/robot' });
  expect(host.querySelector('[role="option"]')?.textContent).toBe('robotsrc/robot');
  await key('Tab');
  expect(choose).toHaveBeenCalledWith({ kind: 'folder', name: 'robot', path: 'D:/project/src/robot' });
  expect(readEditor(editor()).text).toBe('参考  后继续');
  expect(send).not.toHaveBeenCalled();
});

it('keeps file searches single flight and rejects stale matches while a new query is pending', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await type('%old');
  await type('%new');
  expect(guiApi.request).toHaveBeenCalledOnce();
  await key('Enter'); expect(choose).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  vi.mocked(guiApi.request).mockResolvedValue({ entries: [], truncated: false });
  await act(async () => finish({ entries: [{ name: 'old', path: 'D:/old', directory: false }] }));
  expect(guiApi.request).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'new' }));
  expect(host.querySelector('[role="option"]')).toBeNull();
  await key('Enter'); expect(send).not.toHaveBeenCalled();
  await key('Escape'); expect(host.querySelector('[role="listbox"]')).toBeNull();
});
