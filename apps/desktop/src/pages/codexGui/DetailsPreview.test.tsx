// @vitest-environment jsdom
import { act, useContext, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetailsWorkspace } from "../../../../../shared/conversation/DetailsWorkspace";
import { ConversationChangesButton } from "../../../../../shared/conversation/ConversationChangesButton";
import { MessageLink } from "../../../../../shared/conversation/MessageLink";
import { filePreviewApi, type FilePreviewData } from "../../../../../shared/file-preview/workspace/api";
import { invoke } from '@tauri-apps/api/core';
import { DetailsContext } from "../../../../../shared/conversation/detailsContext";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
const websitePreviewApi = {
  sync: vi.fn(), close: vi.fn(),
};
let root: Root;
let host: HTMLDivElement;
const data: FilePreviewData = { sessionId: "first", name: "readme.md", path: "./readme.md", kind: "markdown",
  text: "# Preview content", url: "http://127.0.0.1/readme.md" };
const changes = { turns: [{ id: 'edit', status: 'completed', items: [],
  diff: 'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-old\n+updated\n' }] };
const click = (label: string) => act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
const preview = () => host.querySelector('[aria-label="文件预览"]');
function Fixture({ selected = "first", active = true, changed = false }: {
  selected?: string; active?: boolean; changed?: boolean;
}) {
  return <DetailsWorkspace selected={selected} active={active}>
    <ConversationChangesButton value={changed ? changes : undefined} />
    <MessageLink href="./readme.md">Readme</MessageLink>
    <MessageLink href="./second.md">Second</MessageLink>
    <MessageLink href="./third.md">Third</MessageLink>
    <MessageLink href="https://example.com/page">Website</MessageLink>
  </DetailsWorkspace>;
}
function InitialPreview({ threadId }: { threadId: string }) {
  const open = useContext(DetailsContext)?.openFile;
  useEffect(() => { void open?.({ path: "./readme.md", threadId }); }, [open, threadId]);
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 800));
  vi.spyOn(filePreviewApi, "open").mockResolvedValue(data);
  vi.spyOn(filePreviewApi, "close").mockResolvedValue();
  websitePreviewApi.sync.mockClear(); websitePreviewApi.close.mockClear();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const data = args as { request?: object; id?: string };
    if (command === 'provider_browser_sync') websitePreviewApi.sync(data.request);
    if (command === 'provider_browser_close') websitePreviewApi.close(data.id);
    return undefined;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("shares one drawer with file changes and keeps the file view when switching tabs", async () => {
  await click("预览文件：./readme.md");
  await act(async () => root.render(<Fixture changed />));
  expect(host.querySelector('[role="tablist"][aria-label="侧栏内容"]')?.textContent).toContain('文件更改');
  expect(host.querySelector('.website-preview-browser [role="tab"][aria-selected="true"]')?.textContent)
    .toContain('readme.md');
  const source = [...host.querySelectorAll("button")].find(button => button.textContent === "源码")!;
  await act(async () => source.click());
  await click("查看文件更改");
  expect(host.querySelectorAll("aside")).toHaveLength(1);
  expect(host.querySelector('[aria-label="文件更改详情"]')?.textContent).toContain("example.ts");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!.click());
  expect(source.getAttribute("aria-pressed")).toBe("true");
  expect(filePreviewApi.close).not.toHaveBeenCalled();
  await click("关闭详情抽屉");
  expect(host.querySelector("aside")?.hidden).toBe(true);
  expect(filePreviewApi.close).not.toHaveBeenCalled();
  await click("预览文件：./readme.md");
  expect(host.querySelector("aside")?.hidden).toBe(false);
  expect(source.getAttribute("aria-pressed")).toBe("true");
  expect(filePreviewApi.open).toHaveBeenCalledOnce();
});

it.each(['关闭详情抽屉', '最小化详情抽屉', '侧栏内容'])(
  'restores the browser without creating empty changes after %s', async label => {
    await click('侧栏内容');
    await act(async () => host.querySelector<HTMLButtonElement>('nav button')!.click());
    const drawer = host.querySelector<HTMLElement>('aside')!;
    expect(drawer.hidden).toBe(false);
    const tabs = host.querySelector('[role="tablist"][aria-label="侧栏内容"]')!;
    expect([...tabs.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(['浏览器']);
    expect(host.querySelector('[aria-label="侧栏内容"]')?.getAttribute('aria-expanded')).toBe('true');
    await click(label);
    expect(drawer.hidden).toBe(true);
    await click('侧栏内容');
    expect(drawer.hidden).toBe(false);
    expect(tabs.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('浏览器');
    expect(drawer.textContent).not.toContain('暂无文件更改');
    expect(host.querySelector('[aria-label="查看文件更改"]')).toBeNull();
  },
);

it('restores the retained preview in one click after the conversation changes become empty', async () => {
  await click('预览文件：./readme.md');
  await act(async () => root.render(<Fixture changed />));
  await click('查看文件更改');
  await act(async () => root.render(<Fixture />));
  expect(host.querySelector('[role="tablist"][aria-label="侧栏内容"]')?.textContent).not.toContain('文件更改');
  expect(host.querySelector('[aria-label="侧栏内容"]')?.getAttribute('aria-expanded')).toBe('false');
  await click('侧栏内容');
  expect(host.querySelector<HTMLElement>('aside')?.hidden).toBe(false);
  expect(host.querySelector('[role="tablist"][aria-label="侧栏内容"] [aria-selected="true"]')?.textContent)
    .toBe('浏览器');
});

it("opens previews requested by child effects after workspace initialization and conversation changes", async () => {
  for (const selected of ["auto", "next"]) {
    await act(async () => root.render(<DetailsWorkspace selected={selected} active>
      <InitialPreview threadId={selected} /></DetailsWorkspace>));
    expect(preview()?.textContent).toContain("readme.md");
    expect(host.querySelector("aside")?.hidden).toBe(false);
  }
});

it("opens the start page for a conversation without content tabs", async () => {
  await click("侧栏内容");
  expect(host.querySelector('aside')?.getAttribute('aria-label')).toBe('新标签页');
  expect(host.querySelector('nav')?.textContent).toBe('浏览器Git文件浏览');
  expect([...host.querySelectorAll<HTMLButtonElement>('nav button')].map(button => button.disabled))
    .toEqual([false, true, true]);
  await click("侧栏内容");
  expect(host.querySelector('aside')?.hidden).toBe(true);
  await act(async () => root.render(<Fixture selected="other" />));
  expect(host.querySelector('[aria-label="侧栏内容"]')).not.toBeNull();
  await click("侧栏内容");
  expect(host.querySelector("aside")?.hidden).toBe(false);
});

it("retains file tabs and releases their sessions and pending reads when changing conversations", async () => {
  await click("预览文件：./readme.md");
  vi.mocked(filePreviewApi.open).mockResolvedValueOnce({ ...data, sessionId: "second", name: "second.md" });
  await click("预览文件：./second.md");
  expect(filePreviewApi.close).not.toHaveBeenCalled();
  let resolve!: (value: FilePreviewData) => void;
  vi.mocked(filePreviewApi.open).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await click("预览文件：./third.md");
  await act(async () => root.render(<Fixture selected="other" />));
  await act(async () => resolve({ ...data, sessionId: "late" }));
  expect(preview()).toBeNull();
  expect(filePreviewApi.close).toHaveBeenCalledWith("first");
  expect(filePreviewApi.close).toHaveBeenCalledWith("second");
  expect(filePreviewApi.close).toHaveBeenCalledWith("late");
});

it("keeps the latest click when different file reads finish out of order", async () => {
  let resolve!: (value: FilePreviewData) => void;
  vi.mocked(filePreviewApi.open).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await click("预览文件：./readme.md");
  vi.mocked(filePreviewApi.open).mockResolvedValueOnce({ ...data, sessionId: "second", name: "second.md" });
  await click("预览文件：./second.md");
  await act(async () => resolve(data));
  expect(host.querySelector('.website-preview-browser [role="tab"][aria-selected="true"]')?.textContent)
    .toContain('second.md');
  expect(filePreviewApi.close).toHaveBeenCalledWith("first");
});

it("opens websites in the same drawer and hides their native content on minimize and page changes", async () => {
  const nextFrame = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  await click("预览文件：./readme.md");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => host.querySelector("a")!.dispatchEvent(event));
  await nextFrame();
  expect(event.defaultPrevented).toBe(true);
  expect(host.querySelectorAll("aside")).toHaveLength(1);
  expect(filePreviewApi.close).not.toHaveBeenCalled();
  expect(websitePreviewApi.sync).toHaveBeenLastCalledWith(expect.objectContaining({
    url: "https://example.com/page", visible: true,
  }));
  await click("最小化详情抽屉"); await nextFrame();
  expect(websitePreviewApi.sync).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "恢复预览")!.click());
  await nextFrame();
  expect(websitePreviewApi.sync).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  vi.spyOn(dialog, "getClientRects").mockReturnValue([new DOMRect(0, 0, 800, 600)] as unknown as DOMRectList);
  await act(async () => { document.body.append(dialog); }); await nextFrame();
  expect(websitePreviewApi.sync).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  await act(async () => dialog.remove()); await nextFrame();
  expect(websitePreviewApi.sync).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
  await act(async () => root.render(<Fixture active={false} />)); await nextFrame();
  expect(websitePreviewApi.sync).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  await act(async () => root.render(<Fixture selected="other" />));
  expect(websitePreviewApi.close).toHaveBeenCalledOnce();
});
