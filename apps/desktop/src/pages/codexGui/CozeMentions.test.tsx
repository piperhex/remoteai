// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "../../../../../shared/conversation/api";
import { SkillInput } from "./SkillInput";
import { ComposerReferences } from "./ComposerReferences";
import { readEditor } from "./skillEditorDom";
import { remoteAttachments } from "../../../../../shared/remote-chat/composerAttachments";
import type { ComposerText } from "../../../../../shared/conversation/types";
import type { AttachmentReference } from "../../../../../shared/conversation/attachmentTypes";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { request: vi.fn() } }));
const id = "f321c884-a198-4244-ad4f-53762b3d2aba";
const send = vi.fn();
let root: Root;
let host: HTMLDivElement;
function Fixture({ draftKey = "new" }: { draftKey?: string }) {
  const [value, onChange] = useState<ComposerText>({ text: "", mentions: [] });
  const [items, setItems] = useState<AttachmentReference[]>([]);
  return <><ComposerReferences items={items} active disabled={false}
    onRemove={(path) => setItems(items.filter((item) => item.path !== path))} />
    <SkillInput value={value} draftKey={draftKey} cwd="D:/project" active connected disabled={false}
      onCoze={(item) => setItems([...items, item])} placeholder="# 选择 Coze" onChange={onChange}
      onPaste={() => {}} onSend={() => send({ ...value, attachments: items })} /></>;
}
const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"]')!;
async function type(text: string) {
  await act(async () => {
    editor().textContent = text;
    const range = document.createRange();
    range.setStart(editor().firstChild!, text.length); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    editor().dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}
const key = (value: string) => act(async () => {
  editor().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
});
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  vi.mocked(guiApi.request).mockResolvedValue([
    { id, name: "查询库存", description: "库存工具", kind: "workflow" },
    { id: "a321c884-a198-4244-ad4f-53762b3d2aba", name: "产品知识库", description: "查询资料", kind: "knowledge" },
  ]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("selects # Coze by name, retains a reference chip and sends the exact published ID", async () => {
  expect(guiApi.request).not.toHaveBeenCalled();
  await type("请使用 #库存");
  expect(guiApi.request).toHaveBeenCalledExactlyOnceWith({ operation: "cozeCatalog" });
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  await key("Enter");
  expect(send).not.toHaveBeenCalled();
  expect(readEditor(editor()).text).toBe("请使用 ");
  expect(host.textContent).toContain("#查询库存");
  await key("Enter");
  const attachments = [{ kind: "coze", name: "查询库存", path: `coze://${id}` }];
  expect(send).toHaveBeenCalledWith({ text: "请使用 ", mentions: [], attachments });
  expect(remoteAttachments(attachments)).toEqual(attachments);
});

it("ignores URL fragments and rejects invalid or uploaded Coze references", async () => {
  await type("https://example.com/#库存");
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(() => remoteAttachments([{ kind: "coze", name: "test", path: "coze://../file" }])).toThrow();
  expect(() => remoteAttachments([{ kind: "coze", name: "test", path: `coze://${id}`, data: "YQ==" }])).toThrow();
});

it("explains unavailable Coze and never sends Enter from an empty menu", async () => {
  vi.mocked(guiApi.request).mockRejectedValue(new Error("not installed"));
  await type("#");
  expect(host.textContent).toContain("请先从左侧打开 Coze");
  await key("Enter"); expect(send).not.toHaveBeenCalled();
  await key("Escape"); expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it("discards a pending catalog when switching conversations", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await type("#");
  await act(async () => root.render(<Fixture draftKey="other" />));
  await act(async () => finish([{ id, name: "late", description: "", kind: "workflow" }]));
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});
