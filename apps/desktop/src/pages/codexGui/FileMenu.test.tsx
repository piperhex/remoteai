// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { message } from "antd";
import { FileMenu } from "./FileMenu";
import { FileThreadContext, fileApi } from "./fileApi";
import { RichText } from "./RichText";
import { filePreviewApi, type FilePreviewData } from "./filePreview/api";
import { DetailsWorkspace } from "./DetailsWorkspace";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => true), invoke: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
const clipboard = vi.fn().mockResolvedValue(undefined);
const applications = [{ id: "vscode", name: "VS Code", kind: "editor" as const },
  { id: "terminal", name: "终端", kind: "terminal" as const }];
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const click = (element: HTMLElement) => act(async () => element.click());
function item(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((element) => element.textContent === label)!;
}
async function render(path = "C:/project/report.txt", thread = "thread-one", onReview?: () => void) {
  await act(async () => root.render(<FileThreadContext.Provider value={thread}>
    <FileMenu path={path} line={12} column={3} onReview={onReview}>报告</FileMenu>
  </FileThreadContext.Provider>));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(isTauri).mockReturnValue(true);
  vi.spyOn(fileApi, "applications").mockResolvedValue(applications);
  vi.spyOn(filePreviewApi, "open").mockResolvedValue({ sessionId: "preview", path: "config.yaml", name: "config.yaml",
    kind: "text", text: "enabled: true", url: "" });
  vi.spyOn(filePreviewApi, "close").mockResolvedValue();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(fileApi, "perform").mockResolvedValue({ path: "C:/project/report.txt", text: "文件内容", saved: true });
  vi.spyOn(message, "success").mockImplementation(() => Object.assign(() => {}, { then: vi.fn() }));
  vi.spyOn(message, "error").mockImplementation(() => Object.assign(() => {}, { then: vi.fn() }));
  Object.defineProperty(navigator, "clipboard", { value: { writeText: clipboard }, configurable: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

it("opens a file menu without launching anything and passes the chosen editor and location", async () => {
  expect(fileApi.applications).not.toHaveBeenCalled();
  await click(trigger());
  expect(fileApi.perform).not.toHaveBeenCalled();
  expect(item("打开文件")).toBeTruthy();
  await click(item("在 VS Code 中打开"));
  expect(fileApi.perform).toHaveBeenCalledWith({ path: "C:/project/report.txt", line: 12, column: 3,
    threadId: "thread-one" }, { type: "open", application: "vscode" });
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("uses the installed application icon in the VS Code shortcut and falls back if it cannot load", async () => {
  const icon = "data:image/png;base64,aWNvbg==";
  vi.mocked(fileApi.applications).mockResolvedValue([{ ...applications[0], icon }]);
  await click(trigger());
  const shortcut = item("在 VS Code 中打开");
  const image = shortcut.querySelector("img")!;
  expect(image.getAttribute("src")).toBe(icon);
  expect(image.getAttribute("width")).toBe("16");
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(shortcut.querySelector("img")).toBeNull();
  expect(shortcut.querySelector("svg")).not.toBeNull();
  await click(shortcut);
  expect(fileApi.perform).toHaveBeenCalledWith(expect.anything(), { type: "open", application: "vscode" });
});

it.each([true, false])("opens available diffs directly without loading a menu (desktop: %s)", async (desktop) => {
  vi.mocked(isTauri).mockReturnValue(desktop);
  const onReview = vi.fn();
  await render("src/report.ts", "thread-one", onReview);
  const button = host.querySelector<HTMLButtonElement>("button")!;
  expect(button.getAttribute("aria-label")).toBe("查看 src/report.ts 的差异");
  await click(button);
  expect(onReview).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(fileApi.applications).not.toHaveBeenCalled();
  expect(fileApi.perform).not.toHaveBeenCalled();
});

it.each([["复制路径", "copyPath", "C:/project/report.txt"], ["复制文件内容", "copyContents", "文件内容"]])(
  "copies the resolved value for %s", async (label, type, copied) => {
    await click(trigger()); await click(item(label));
    expect(fileApi.perform).toHaveBeenCalledWith(expect.anything(), { type });
    expect(clipboard).toHaveBeenCalledWith(copied);
  },
);

it("does not report success when the save dialog is cancelled", async () => {
  vi.mocked(fileApi.perform).mockResolvedValue({ path: "C:/project/report.txt", saved: false });
  await click(trigger()); await click(item("另存为…"));
  expect(fileApi.perform).toHaveBeenCalledWith(expect.anything(), { type: "saveAs" });
  expect(message.success).not.toHaveBeenCalled();
});

it("copies the file through the desktop without overwriting it with clipboard text", async () => {
  await render("C:/project/安装包.msi");
  let complete!: () => void;
  vi.mocked(fileApi.perform).mockReturnValue(new Promise((resolve) => {
    complete = () => resolve({ path: "C:/project/安装包.msi", saved: false });
  }));
  await click(trigger()); await click(item("复制文件"));
  expect(fileApi.perform).toHaveBeenCalledWith(expect.objectContaining({ path: "C:/project/安装包.msi" }),
    { type: "copyFile" });
  expect(trigger().disabled).toBe(true);
  expect(message.success).not.toHaveBeenCalled();
  await act(async () => complete());
  expect(clipboard).not.toHaveBeenCalled();
  expect(message.success).toHaveBeenCalledWith({ content: "文件已复制，可粘贴到文件夹。",
    style: { maxWidth: 400, marginInline: "auto" } });
  expect(trigger().disabled).toBe(false);
});

it("reports a failed file copy without claiming success and allows retry", async () => {
  vi.mocked(fileApi.perform).mockRejectedValueOnce("文件未能复制，请稍后重试。");
  await click(trigger()); await click(item("复制文件"));
  expect(message.error).toHaveBeenCalledWith(expect.objectContaining({ content: "文件未能复制，请稍后重试。" }));
  expect(message.success).not.toHaveBeenCalled();
  expect(clipboard).not.toHaveBeenCalled();
  expect(trigger().disabled).toBe(false);
  await click(trigger()); await click(item("复制文件"));
  expect(message.success).toHaveBeenCalledOnce();
});

it("keeps the menu dismissible while app discovery is pending and ignores stale responses", async () => {
  let resolve!: (value: typeof applications) => void;
  vi.mocked(fileApi.applications).mockReturnValue(new Promise((done) => { resolve = done; }));
  await click(trigger()); await render("C:/other.txt", "thread-two");
  await act(async () => resolve(applications));
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(fileApi.perform).not.toHaveBeenCalled();
});

it("reports friendly failures in a compact message and allows retry", async () => {
  vi.mocked(fileApi.perform).mockRejectedValue("找不到这个文件，请确认文件仍然存在。");
  await click(trigger()); await click(item("打开文件"));
  expect(message.error).toHaveBeenCalledWith({ content: "找不到这个文件，请确认文件仍然存在。",
    style: { maxWidth: 400, marginInline: "auto" } });
  expect(trigger().disabled).toBe(false);
});

it("does not invoke host actions in a browser and still copies a file path", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await render(); await click(trigger());
  expect(item("打开文件").getAttribute("aria-disabled")).toBe("true");
  expect(item("复制文件").getAttribute("aria-disabled")).toBe("true");
  expect(fileApi.applications).not.toHaveBeenCalled();
  await click(item("复制路径"));
  expect(clipboard).toHaveBeenCalledWith("C:/project/report.txt");
  expect(fileApi.perform).not.toHaveBeenCalled();
});

it("renders relative and file URL markdown destinations as clickable files", async () => {
  await act(async () => root.render(<RichText text={
    "[报告](docs/report.pdf:12) 和 [文件](file:///C:/report.txt) 和 [网页](https://example.com)"
  } />));
  expect(host.querySelectorAll('button[aria-haspopup="menu"]')).toHaveLength(2);
  expect(host.querySelector("a")?.href).toBe("https://example.com/");
});

it("preserves literal URL punctuation in paths supplied by edited-file cards", async () => {
  await render("C:/project/report%20#L12.txt");
  await click(trigger()); await click(item("打开文件"));
  expect(fileApi.perform).toHaveBeenCalledWith(expect.objectContaining({ path: "C:/project/report%20#L12.txt" }),
    { type: "open", application: "default" });
});

it("previews Markdown resources directly and preserves the original menu on right click", async () => {
  await act(async () => root.render(<DetailsWorkspace selected="thread-one" active>
    <FileThreadContext.Provider value="thread-one">
    <RichText text="[配置](./config.yaml#L12C3)" />
  </FileThreadContext.Provider></DetailsWorkspace>));
  await click(trigger());
  expect(filePreviewApi.open).toHaveBeenCalledWith({ path: "./config.yaml", line: 12, column: 3,
    threadId: "thread-one" });
  expect(fileApi.applications).not.toHaveBeenCalled();
  await act(async () => { trigger().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
  expect(item("打开文件")).toBeTruthy();
});

it("opens the original menu for unsupported files and prevents duplicate preview requests", async () => {
  let resolve!: (data: FilePreviewData | null) => void;
  vi.mocked(filePreviewApi.open).mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => root.render(<DetailsWorkspace selected="thread-one" active>
    <FileMenu path="archive.zip" preview>归档</FileMenu></DetailsWorkspace>));
  await click(trigger()); await click(trigger());
  expect(filePreviewApi.open).toHaveBeenCalledOnce();
  await act(async () => resolve(null));
  expect(item("打开文件")).toBeTruthy();
  expect(trigger().disabled).toBe(false);
});
