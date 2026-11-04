// @vitest-environment jsdom
import { act, StrictMode, type ClipboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuiController } from "./controller";
import { MAX_IMAGE_BYTES, useComposerDraft } from "./useComposerDraft";
import { MAX_REPLY_QUOTES, MAX_QUOTE_CHARACTERS, quoteKey } from "../../../../../shared/conversation/replyQuotes";
import { fileSelectionQuote } from '../../../../../shared/project-browser/fileSelection';

let root: Root;
let container: HTMLDivElement;
let controller: GuiController;
let editor: ReturnType<typeof useComposerDraft>;
let readers: FileReader[];
const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
const file = () => new File(["image"], "截图.png", { type: "image/png" });

it('sends file selections with their path, range and original content alongside the existing draft', async () => {
  const quote = fileSelectionQuote({ path: 'F:/project/a.ts', start: { line: 2, column: 3 },
    end: { line: 3, column: 1 }, text: '  source\n' });
  act(() => { editor.editText('请修改'); editor.addQuote(quote); });
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenCalledWith(
    '引用文件内容：\n> F:/project/a.ts:2:3-3:1\n> ```\n>   source\n> \n> ```\n\n请修改', [], []);
});

it("appends dictation to the latest text while retaining references and mentions", () => {
  const attachment = { kind: "file" as const, name: "notes", path: "C:/notes.txt" };
  const mention = { start: 0, end: 6,
    skill: { name: "check", path: "C:/SKILL.md", description: "", enabled: true } };
  act(() => {
    editor.editContent({ text: "$check 已输入", mentions: [mention] });
    editor.addAttachments([attachment]);
    editor.appendDictation("  这是转写文字  ");
  });
  expect(editor.draft.text).toBe("$check 已输入\n这是转写文字");
  expect(editor.draft.mentions).toEqual([mention]);
  expect(editor.draft.attachments).toEqual([attachment]);
  expect(controller.send).not.toHaveBeenCalled();
});

it("retains conversation references on failure and restores them from queued messages", async () => {
  const attachment = { kind: "conversation" as const, name: "方案", path: "codex-thread://source" };
  act(() => editor.addAttachments([attachment, attachment]));
  expect(editor.draft.attachments).toEqual([attachment]);
  vi.mocked(controller.send).mockResolvedValueOnce(false);
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenCalledWith("", [], [], [attachment]);
  expect(editor.draft.attachments).toEqual([attachment]);
  vi.spyOn(controller.queue, "take").mockReturnValue({ text: "参考方案", images: [], skills: [],
    attachments: [attachment] });
  act(() => editor.editQueued("queued"));
  expect(editor.draft.text).toBe("参考方案");
  expect(editor.draft.attachments).toEqual([attachment]);
  act(() => editor.removeAttachment(attachment.path));
  expect(editor.draft.attachments).toEqual([]);
});

it("rejects a ninth conversation reference before sending", () => {
  act(() => editor.addAttachments(Array.from({ length: 8 }, (_, index) => ({ kind: "conversation",
    name: `对话 ${index}`, path: `codex-thread://${index}` }))));
  act(() => editor.addAttachments([{ kind: "conversation", name: "额外", path: "codex-thread://extra" }]));
  expect(editor.draft.attachments).toHaveLength(8);
  expect(controller.report).toHaveBeenCalledWith("每条消息最多引用 8 个对话。");
});

function Fixture({ draftKey }: { draftKey: string }) {
  editor = useComposerDraft(draftKey, controller);
  return null;
}
const render = (draftKey = "new") => act(async () => root.render(<Fixture draftKey={draftKey} />));
const finish = (reader = readers[0]) => act(async () => {
  Object.defineProperty(reader, "result", { value: imageUrl });
  reader.dispatchEvent(new ProgressEvent("load"));
});

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  readers = [];
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    readers.push(this);
  });
  controller = new GuiController();
  vi.spyOn(controller, "send").mockResolvedValue(true);
  vi.spyOn(controller, "report");
  container = document.createElement("div");
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function clipboard(files: File[]): ClipboardEvent<HTMLTextAreaElement> {
  return { clipboardData: { items: files.map((value) => ({ kind: "file", type: value.type,
    getAsFile: () => value })) }, preventDefault: vi.fn() } as unknown as ClipboardEvent<HTMLTextAreaElement>;
}

it("restores a failed edit to its conversation without discarding an existing draft", async () => {
  act(() => editor.editText("existing draft"));
  controller.messageEditor.recoveredDrafts.set("new", { text: "edited message", images: [imageUrl],
    skills: [{ name: "check", path: "D:/SKILL.md" }],
    attachments: [{ kind: "plugin", name: "plugin", path: "plugin://example" }] });
  await render("other");
  expect(editor.draft.text).toBe("");
  await render();
  expect(editor.draft.text).toBe("existing draft\n\nedited message $check");
  expect(editor.draft.images[0].url).toBe(imageUrl);
  expect(editor.draft.attachments?.[0].path).toBe("plugin://example");
  expect(controller.messageEditor.recoveredDrafts.size).toBe(0);
});

it("restores a failed edit only once when React repeats mount effects", async () => {
  controller.messageEditor.recoveredDrafts.set("new", { text: "edited message", images: [], skills: [] });
  await act(async () => root.render(<StrictMode><Fixture draftKey="new" /></StrictMode>));
  expect(editor.draft.text).toBe("edited message");
  expect(controller.messageEditor.recoveredDrafts.size).toBe(0);
});

it("leaves ordinary text paste alone and sends pasted images without requiring text", async () => {
  const textPaste = clipboard([]);
  act(() => editor.paste(textPaste));
  expect(textPaste.preventDefault).not.toHaveBeenCalled();
  const paste = clipboard([file()]);
  act(() => editor.paste(paste));
  expect(paste.preventDefault).toHaveBeenCalled();
  expect(editor.reading).toBe(true);
  await act(async () => editor.send());
  expect(controller.send).not.toHaveBeenCalled();
  await finish();
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenCalledWith("", [imageUrl], []);
  expect(editor.draft.images).toEqual([]);
});

it("keeps edits and images with their original conversation when reads finish later", async () => {
  act(() => editor.addImages([file(), file()]));
  act(() => editor.editText("原来的草稿"));
  act(() => editor.removeImage(editor.draft.images[0].id));
  await render("other");
  act(() => editor.editText("另一条草稿"));
  await finish(readers[0]);
  await finish(readers[1]);
  expect(editor.draft).toEqual({ text: "另一条草稿", mentions: [], images: [] });
  await render();
  expect(editor.draft.text).toBe("原来的草稿");
  expect(editor.draft.images).toHaveLength(1);
  expect(editor.draft.images[0].url).toBe(imageUrl);
});

it("preserves attachments after failed sends and clears them after a successful retry", async () => {
  act(() => editor.addImages([file()]));
  await finish();
  vi.mocked(controller.send).mockResolvedValueOnce(false);
  await act(async () => editor.send());
  expect(editor.draft.images[0].url).toBe(imageUrl);
  await act(async () => editor.send());
  expect(editor.draft.images).toEqual([]);
});

it("keeps file and plugin references with their draft and preserves them after a failed send", async () => {
  const attachment = { kind: "plugin" as const, name: "Documents", path: "plugin://documents@openai" };
  act(() => editor.addAttachments([attachment, attachment]));
  expect(editor.draft.attachments).toEqual([attachment]);
  await render("other");
  expect(editor.draft.attachments).toBeUndefined();
  await render();
  vi.mocked(controller.send).mockResolvedValueOnce(false);
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenLastCalledWith("", [], [], [attachment]);
  expect(editor.draft.attachments).toEqual([attachment]);
  await act(async () => editor.send());
  expect(editor.draft.attachments).toBeUndefined();
});

it("submits the same draft once and preserves text typed while submission is pending", async () => {
  act(() => editor.editText("待发送的内容"));
  let resolve!: (accepted: boolean) => void;
  vi.mocked(controller.send).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  let pending!: Promise<void>;
  act(() => { pending = editor.send(); void editor.send(); });
  expect(controller.send).toHaveBeenCalledOnce();
  act(() => editor.editText("下一条消息"));
  await act(async () => { resolve(true); await pending; });
  expect(editor.draft.text).toBe("下一条消息");
});

it("limits attachment count and rejects unsupported, empty, or oversized files", async () => {
  const oversized = file();
  Object.defineProperty(oversized, "size", { value: MAX_IMAGE_BYTES + 1 });
  act(() => editor.addImages([oversized, new File([], "empty.png", { type: "image/png" }),
    new File(["svg"], "image.svg", { type: "image/svg+xml" })]));
  expect(editor.draft.images).toEqual([]);
  expect(controller.report).toHaveBeenCalled();
  act(() => editor.addImages(Array.from({ length: 9 }, file)));
  expect(editor.draft.images).toHaveLength(8);
  expect(readers).toHaveLength(8);
  act(() => editor.addImages([file()]));
  expect(editor.draft.images).toHaveLength(8);
});

it("removes failed reads so they do not leave the composer stuck", async () => {
  act(() => editor.addImages([file()]));
  await act(async () => readers[0].dispatchEvent(new ProgressEvent("error")));
  expect(editor.reading).toBe(false);
  expect(editor.draft.images).toEqual([]);
  expect(controller.report).toHaveBeenCalledWith("图片读取失败，请重新粘贴或选择图片。");
});

it("preserves skill references with each draft and on failed sends, then clears them on success", async () => {
  const skill = { name: "deploy", path: "D:/skills/deploy/SKILL.md", description: "部署", enabled: true };
  act(() => editor.editContent({ text: "$deploy", mentions: [{ start: 0, end: 7, skill }] }));
  await render("other");
  expect(editor.draft.mentions).toEqual([]);
  await render();
  vi.mocked(controller.send).mockResolvedValueOnce(false);
  await act(async () => editor.send());
  expect(editor.draft.mentions[0].skill).toEqual(skill);
  expect(controller.send).toHaveBeenLastCalledWith("$deploy", [], [{ name: skill.name, path: skill.path }]);
  await act(async () => editor.send());
  expect(editor.draft.mentions).toEqual([]);
});

it("preserves quotes with each draft and after failed sends, including edits made while sending", async () => {
  const quote = { messageId: "answer", text: "第一行\n第二行" };
  await render("one");
  act(() => { editor.addQuote(quote); editor.editText("为什么？"); });
  await render("two");
  expect(editor.draft.quotes).toBeUndefined();
  await render("one");
  let resolve!: (accepted: boolean) => void;
  vi.mocked(controller.send).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  let pending!: Promise<void>;
  act(() => { pending = editor.send(); });
  act(() => editor.editText("请详细说明"));
  await act(async () => { resolve(false); await pending; });
  expect(editor.draft.text).toBe("请详细说明");
  expect(editor.draft.quotes).toEqual([quote]);
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenLastCalledWith("引用 AI 回答：\n> 第一行\n> 第二行\n\n请详细说明", [], []);
  expect(editor.draft.quotes).toBeUndefined();
});

it("bounds quote count and length, deduplicates selections and supports removing quotes", () => {
  const quote = { messageId: "answer", text: "选中文字" };
  act(() => { editor.addQuote(quote); editor.addQuote(quote); });
  expect(editor.draft.quotes).toEqual([quote]);
  act(() => editor.addQuote({ ...quote, text: "x".repeat(MAX_QUOTE_CHARACTERS + 1) }));
  expect(editor.draft.quotes).toEqual([quote]);
  for (let index = 1; index <= MAX_REPLY_QUOTES; index++) {
    act(() => editor.addQuote({ messageId: String(index), text: "片段" }));
  }
  expect(editor.draft.quotes).toHaveLength(MAX_REPLY_QUOTES);
  expect(controller.report).toHaveBeenCalledWith("每条消息最多添加 8 条引用。");
  act(() => editor.removeQuote(quoteKey(quote)));
  expect(editor.draft.quotes).toHaveLength(MAX_REPLY_QUOTES - 1);
  act(() => editor.clearQuotes());
  expect(editor.draft.quotes).toEqual([]);
});

it("replaces the draft with a queued message and preserves its images, attachments and skills when resending", async () => {
  await render("one");
  act(() => {
    editor.editText("丢弃这份草稿");
    editor.addQuote({ messageId: "old-answer", text: "丢弃这条引用" });
    editor.addAttachments([{ kind: "file", name: "old.txt", path: "D:/old.txt" }]);
    editor.addImages([file()]);
  });
  await finish();
  const attachments = [{ kind: "file" as const, name: "notes.txt", path: "D:/notes.txt" }];
  const skills = [{ name: "review", path: "D:/skills/review/SKILL.md" }];
  controller.queue.enqueue("one", { text: "请用 $review 检查", images: [imageUrl], skills, attachments });
  const id = controller.getSnapshot().queued.one[0].id;
  act(() => { expect(editor.editQueued(id)).toBe(true); });
  expect(controller.getSnapshot().queued.one).toEqual([]);
  expect(editor.draft).toMatchObject({ text: "请用 $review 检查", images: [{ url: imageUrl }], attachments });
  expect(editor.draft.images).toHaveLength(1);
  expect(editor.draft.quotes).toBeUndefined();
  expect(editor.draft.mentions[0]).toMatchObject({ start: 3, end: 10, skill: skills[0] });
  expect(controller.send).not.toHaveBeenCalled();
  await render("other");
  expect(editor.draft.text).toBe("");
  await render("one");
  await act(async () => editor.send());
  expect(controller.send).toHaveBeenCalledWith("请用 $review 检查", [imageUrl], skills, attachments);
  expect(editor.draft.text).toBe("");
});

it("keeps the current draft when a queued message is unavailable", () => {
  act(() => editor.editText("保留草稿"));
  act(() => { expect(editor.editQueued("missing")).toBe(false); });
  expect(editor.draft.text).toBe("保留草稿");
});
