// @vitest-environment jsdom
import { act, type ClipboardEvent, type KeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { GuiController } from "./controller";
import { useComposerDraft } from "./useComposerDraft";
import { ComposerReferences } from "./ComposerReferences";
import { readClipboardImages } from "./clipboardImages";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isDesktopApp: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock("./clipboardImages", () => ({ readClipboardImages: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
let controller: GuiController;
let editor: ReturnType<typeof useComposerDraft>;
const attachment = { kind: "file" as const, name: "说明 文档.txt", path: "C:/files/说明 文档.txt" };
function Fixture({ draftKey = "new" }: { draftKey?: string }) {
  editor = useComposerDraft(draftKey, controller);
  return <ComposerReferences items={editor.draft.attachments ?? []}
    disabled={false} onRemove={editor.removeAttachment} />;
}
const render = (draftKey = "new") => act(async () => root.render(<Fixture draftKey={draftKey} />));
const keydown = () => editor.pasteKeyDown({ key: "v", ctrlKey: true } as KeyboardEvent<HTMLElement>);
function paste(files: File[] = [], text = "", html = "") {
  const event = { clipboardData: { items: files.map((file) =>
    ({ kind: "file", getAsFile: () => file })), getData: (type: string) => type === "text/html" ? html : text },
    preventDefault: vi.fn() };
  editor.paste(event as unknown as ClipboardEvent<HTMLElement>);
  return event;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockReset().mockResolvedValue([]);
  vi.mocked(readClipboardImages).mockReset().mockResolvedValue([]);
  controller = new GuiController();
  vi.spyOn(controller, "send").mockResolvedValue(true);
  vi.spyOn(controller, "report");
  host = document.createElement("div");
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("pastes Explorer files without a paste event, shows removable pills and sends the remaining file", async () => {
  const second = { ...attachment, name: "other.txt", path: "C:/files/other.txt" };
  vi.mocked(invoke).mockResolvedValue([attachment, second]);
  await act(async () => keydown());
  expect(host.textContent).toContain(attachment.name);
  const remove = host.querySelector<HTMLButtonElement>(`button[aria-label="移除附件：${attachment.name}"]`)!;
  expect(remove.getAttribute("aria-label")).toBe("移除附件：" + attachment.name);
  expect(remove.parentElement?.querySelector("svg")).not.toBeNull();
  await act(async () => remove.click());
  expect(editor.draft.attachments).toEqual([second]);
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenCalledWith("", [], [], [second]);
  expect(host.textContent).toBe("");
});

it("coalesces shortcut and paste events, blocks sending until complete and deduplicates repeated files", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((done) => { resolve = done; }));
  act(() => { keydown(); paste(); });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(editor.reading).toBe(true);
  await act(async () => editor.send());
  expect(controller.send).not.toHaveBeenCalled();
  await act(async () => resolve([attachment]));
  expect(editor.reading).toBe(false);
  vi.mocked(invoke).mockResolvedValue([attachment]);
  await act(async () => paste());
  expect(editor.draft.attachments).toEqual([attachment]);
});

it("keeps delayed file reads with their original conversation and preserves files after send failure", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise((done) => { resolve = done; }));
  act(() => keydown());
  await render("other");
  await act(async () => resolve([attachment]));
  expect(editor.draft.attachments).toBeUndefined();
  await render();
  vi.mocked(controller.send).mockResolvedValue(false);
  await act(async () => editor.send());
  expect(editor.draft.attachments).toEqual([attachment]);
});

it("leaves ordinary text paste alone and does not report native clipboard failures for text", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("busy"));
  await act(async () => {
    keydown();
    expect(paste([], "hello").preventDefault).not.toHaveBeenCalled();
  });
  expect(controller.report).not.toHaveBeenCalled();
});

it("falls back to screenshot bytes when the clipboard contains no file paths", async () => {
  const image = new File(["image"], "screenshot.png", { type: "image/png" });
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, "result", { value: "data:image/png;base64,aGVsbG8=" });
    this.dispatchEvent(new ProgressEvent("load"));
  });
  await act(async () => { keydown(); paste([image]); });
  expect(editor.draft.images).toHaveLength(1);
  expect(editor.draft.attachments).toBeUndefined();
});

it("reads native QQ image references while allowing accompanying text insertion", async () => {
  const photo = { ...attachment, name: "photo.png", path: "C:/QQ/photo.png" };
  vi.mocked(invoke).mockResolvedValue([photo]);
  await act(async () => {
    keydown();
    expect(paste([], "图片说明", '<img src="file:///C:/QQ/photo.png">').preventDefault).not.toHaveBeenCalled();
  });
  expect(editor.draft.attachments).toEqual([photo]);
  expect(readClipboardImages).not.toHaveBeenCalled();
});

it("loads DingTalk images once, preserves text insertion and waits for the image before sending", async () => {
  let resolve!: (files: File[]) => void;
  vi.mocked(readClipboardImages).mockReturnValue(new Promise((done) => { resolve = done; }));
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, "result", { value: "data:image/jpeg;base64,aGVsbG8=" });
    this.dispatchEvent(new ProgressEvent("load"));
  });
  await act(async () => {
    keydown();
    const event = paste([], "[图片]图片说明", '<img src="https://static.dingtalk.com/media/photo.jpg">');
    expect(event.preventDefault).not.toHaveBeenCalled();
    editor.editText("[图片]图片说明");
  });
  expect(editor.reading).toBe(true);
  await act(async () => editor.send());
  expect(controller.send).not.toHaveBeenCalled();
  expect(readClipboardImages).toHaveBeenCalledTimes(1);
  await act(async () => resolve([new File(["image"], "photo.jpg", { type: "image/jpeg" })]));
  expect(editor.reading).toBe(false);
  expect(editor.draft.images).toHaveLength(1);
  expect(controller.report).not.toHaveBeenCalled();
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenCalledWith("[图片]图片说明", ["data:image/jpeg;base64,aGVsbG8="], []);
});

it("reports a failed DingTalk download without blocking subsequent paste attempts", async () => {
  vi.mocked(readClipboardImages).mockRejectedValue(new Error("download failed"));
  await act(async () => paste([], "说明", '<img src="https://static.dingtalk.com/media/photo.jpg">'));
  expect(editor.draft.images).toEqual([]);
  expect(editor.reading).toBe(false);
  expect(controller.report).toHaveBeenCalledWith("client.errors.someImagesCouldNotBePastedCopyThemSeparatelyOr");
  vi.mocked(invoke).mockResolvedValue([attachment]);
  await act(async () => keydown());
  expect(editor.draft.attachments).toEqual([attachment]);
});

it("preserves browser-only images when the native snapshot cannot represent the entire rich-text copy", async () => {
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, "result", { value: "data:image/png;base64,aGVsbG8=" });
    this.dispatchEvent(new ProgressEvent("load"));
  });
  await act(async () => paste([new File(["image"], "screenshot.png", { type: "image/png" })], "说明",
    '<img src="cid:0"><img src="https://static.dingtalk.com/media/photo.jpg">'));
  expect(editor.draft.images).toHaveLength(1);
  expect(readClipboardImages).not.toHaveBeenCalled();
  expect(editor.reading).toBe(false);
  expect(controller.report).toHaveBeenCalledWith("client.errors.someImagesCouldNotBePastedCopyThemSeparatelyOr");
});

it("allows typing and switching conversations while a DingTalk image downloads", async () => {
  let resolve!: (files: File[]) => void;
  vi.mocked(readClipboardImages).mockReturnValue(new Promise((done) => { resolve = done; }));
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, "result", { value: "data:image/jpeg;base64,aGVsbG8=" });
    this.dispatchEvent(new ProgressEvent("load"));
  });
  await act(async () => paste([], "说明", '<img src="https://static.dingtalk.com/media/photo.jpg">'));
  await act(async () => editor.editText("仍然可以输入"));
  expect(editor.draft.text).toBe("仍然可以输入");
  await render("other");
  expect(editor.reading).toBe(false);
  await act(async () => resolve([new File(["image"], "photo.jpg", { type: "image/jpeg" })]));
  expect(editor.draft.images).toEqual([]);
  await render();
  expect(editor.draft.images).toHaveLength(1);
  expect(editor.draft.text).toBe("仍然可以输入");
});

it("does not silently lose QQ images when neither native nor browser can read them", async () => {
  await act(async () => paste([], "图片说明", '<img src="file:///C:/QQ/missing.png">'));
  expect(controller.report).toHaveBeenCalledWith("client.errors.someImagesCouldNotBePastedCopyThemSeparatelyOr");
});

it("prefers native file paths over duplicate browser image representations", async () => {
  vi.mocked(invoke).mockResolvedValue([attachment]);
  await act(async () => { keydown(); paste([new File(["x"], "preview.png", { type: "image/png" })]); });
  expect(editor.draft.attachments).toEqual([attachment]);
  expect(editor.draft.images).toEqual([]);
});

it("previews a copied local image and sends its original path only once alongside ordinary files", async () => {
  const photo = { ...attachment, name: "QQ 截图.png", path: "C:\\Tencent Files\\QQ 截图.png" };
  const url = "data:image/jpeg;base64,dGh1bWJuYWls";
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "codex_gui_clipboard_files" ? [photo, attachment] : { url });
  await act(async () => { keydown(); paste([new File(["x"], "preview.png", { type: "image/png" })]); });
  expect(host.querySelector("img")?.getAttribute("src")).toBe(url);
  expect(editor.draft.images).toEqual([]);
  expect(editor.draft.attachments).toEqual([photo, attachment]);
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenCalledExactlyOnceWith("", [], [], [photo, attachment]);
  expect(host.querySelector("img")).toBeNull();
});

it("reports inaccessible native clipboard files and allows retry", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("missing")).mockResolvedValue([attachment]);
  await act(async () => { keydown(); paste(); });
  expect(controller.report).toHaveBeenCalledWith("文件粘贴失败，请重新复制后再试。");
  expect(editor.reading).toBe(false);
  await act(async () => keydown());
  expect(editor.draft.attachments).toEqual([attachment]);
});
