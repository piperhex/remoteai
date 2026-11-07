// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import type { AttachmentReference } from "../../../../../shared/conversation/attachmentTypes";
import { ComposerReferences } from "./ComposerReferences";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isDesktopApp: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
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
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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

it("loads the local original when opening the preview and closes it when leaving the composer", async () => {
  await render();
  let resolveOriginal!: (value: { url: string }) => void;
  vi.mocked(invoke).mockReturnValue(new Promise(resolve => { resolveOriginal = resolve; }));
  await click(`放大查看：${photo.name}`);
  expect(window.document.querySelector("dialog img")?.getAttribute("src")).toBe(thumbnail);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_attachment_preview", {
    request: { path: photo.path, variant: "original" },
  });
  await act(async () => resolveOriginal({ url: original }));
  expect(window.document.querySelector("dialog img")?.getAttribute("src")).toBe(original);
  await render(undefined, false);
  expect(window.document.querySelector("dialog")).toBeNull();
  await render();
  expect(window.document.querySelector("dialog")).toBeNull();
});

it("allows retry and removal when a preview cannot be read", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("missing"));
  await render();
  expect(host.textContent).toContain("图片无法读取，请重新选择。");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="status"] button')!.click());
  expect(host.querySelector("img")?.getAttribute("src")).toBe(thumbnail);
  await click(`移除附件：${photo.name}`);
  expect(remove).toHaveBeenCalledWith(photo.path);
});

it('navigates local image files in order and reads the selected original', async () => {
  const second = { ...photo, name: 'second.png', path: 'C:/second.png' };
  await render([photo, document, second]);
  await click(`放大查看：${photo.name}`);
  expect(host.querySelector<HTMLButtonElement>('.cs-image-previous')?.disabled).toBe(true);
  vi.mocked(invoke).mockResolvedValue({ url: original });
  await click('下一个');
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_attachment_preview', {
    request: { path: second.path, variant: 'original' },
  });
  expect(host.querySelector('dialog img')?.getAttribute('src')).toBe(original);
  expect(host.querySelector<HTMLButtonElement>('.cs-image-next')?.disabled).toBe(true);
  await click('上一个');
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_attachment_preview', {
    request: { path: photo.path, variant: 'original' },
  });
  expect(remove).not.toHaveBeenCalled();
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
