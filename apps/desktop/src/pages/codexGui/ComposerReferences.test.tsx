// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import type { AttachmentReference } from "./attachmentTypes";
import { ComposerReferences } from "./ComposerReferences";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isDesktopApp: true }));
const photo: AttachmentReference = { kind: "file", name: "QQ 截图.PNG", path: "C:\\Tencent Files\\QQ 截图.PNG" };
const document: AttachmentReference = { kind: "file", name: "notes.txt", path: "C:/notes.txt" };
const thumbnail = "data:image/jpeg;base64,dGh1bWJuYWls";
const original = "data:image/png;base64,b3JpZ2luYWw=";
const remove = vi.fn();
let root: Root;
let host: HTMLDivElement;
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const render = (items = [photo, document], active = true) => act(async () => {
  root.render(<ComposerReferences items={items} active={active} disabled={false} onRemove={remove} />);
});
const click = (label: string) => act(async () => {
  host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.mocked(invoke).mockReset().mockResolvedValue({ url: thumbnail });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value(this: HTMLDialogElement) { this.open = true; },
  });
  host = window.document.createElement("div"); window.document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

it("shows local image thumbnails alongside ordinary file pills before any conversation exists", async () => {
  await render();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("codex_gui_attachment_preview", {
    request: { path: photo.path, variant: "thumbnail" },
  });
  expect(host.querySelector("img")?.getAttribute("src")).toBe(thumbnail);
  expect(host.querySelector('[aria-label="文件、插件和对话引用"]')?.textContent).toBe(document.name);
  await click(`移除附件：${photo.name}`);
  expect(remove).toHaveBeenCalledWith(photo.path);
});

it("loads the original on demand and closes the preview when leaving the composer", async () => {
  await render();
  vi.mocked(invoke).mockResolvedValue({ url: original });
  await click(`放大查看：${photo.name}`);
  expect(window.document.querySelector("dialog img")?.getAttribute("src")).toBe(thumbnail);
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>('.cs-image-original')!.click());
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_attachment_preview", {
    request: { path: photo.path, variant: "original" },
  });
  expect(window.document.querySelector("dialog img")?.getAttribute("src")).toBe(original);
  await render(undefined, false);
  expect(window.document.querySelector("dialog")).toBeNull();
  await render();
  expect(window.document.querySelector("dialog")).toBeNull();
});

it("allows retry and removal when a preview cannot be read", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("missing"));
  await render();
  expect(host.textContent).toContain("图片加载失败");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="status"] button')!.click());
  expect(host.querySelector("img")?.getAttribute("src")).toBe(thumbnail);
  await click(`移除附件：${photo.name}`);
  expect(remove).toHaveBeenCalledWith(photo.path);
});

it("does not treat image-named folders or plugins as images and ignores reads after removal", async () => {
  let resolve!: (result: { url: string }) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((done) => { resolve = done; }));
  await render();
  expect(host.textContent).toContain("正在读取");
  await render([{ ...photo, kind: "folder" }, { ...photo, kind: "plugin", path: "plugin://photo.png" }]);
  await act(async () => resolve({ url: thumbnail }));
  expect(host.querySelector("img")).toBeNull();
  expect(invoke).toHaveBeenCalledOnce();
});
