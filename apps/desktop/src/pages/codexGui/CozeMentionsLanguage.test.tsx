// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "../../../../../shared/conversation/api";
import { SkillInput } from "./SkillInput";
import { setGuiLanguage } from "../../../../../shared/localization/uiText";
import type { ComposerText } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { request: vi.fn() } }));
const id = "f321c884-a198-4244-ad4f-53762b3d2aba";
let root: Root;
let host: HTMLDivElement;
function Fixture() {
  const [value, onChange] = useState<ComposerText>({ text: "", mentions: [] });
  return <SkillInput value={value} draftKey="new" cwd="D:/project" active connected disabled={false}
    onCoze={() => {}} placeholder="!" onChange={onChange} onPaste={() => {}} onSend={() => {}} />;
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
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  setGuiLanguage("ru");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  setGuiLanguage("zh"); vi.unstubAllGlobals();
});

it("shows the Coze menu and its error in the interface language and follows a live switch", async () => {
  vi.mocked(guiApi.request).mockRejectedValue(new Error("not installed"));
  await type("!");
  expect(host.textContent).toContain("Выбор содержимого Coze");
  expect(host.textContent).toContain("Сначала откройте Coze на боковой панели и опубликуйте нужное содержимое.");
  expect(host.textContent).not.toMatch(/[\u4e00-\u9fff]/);
  await act(async () => setGuiLanguage("en"));
  expect(host.textContent).toContain("Choose Coze content");
  expect(host.textContent).toContain("Open Coze from the sidebar first");
  expect(guiApi.request).toHaveBeenCalledTimes(1);
});

it("translates the fallback description and the empty state but keeps published names", async () => {
  vi.mocked(guiApi.request).mockResolvedValue([{ id, name: "查询库存", description: "", kind: "workflow" }]);
  await type("!");
  const option = host.querySelector('[role="option"]');
  expect(option?.textContent).toBe("查询库存Опубликовано в Coze");
  await type("!不存在");
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
  expect(host.textContent).toContain("Подходящего опубликованного содержимого нет. Сначала опубликуйте его в Coze.");
});
