// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuiController } from "./controller";
import { useComposerDraft } from "./useComposerDraft";
import { setGuiLanguage } from "../../../../../shared/localization/uiText";

const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
let root: Root;
let controller: GuiController;
let editor: ReturnType<typeof useComposerDraft>;
function Fixture() {
  editor = useComposerDraft("new", controller);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  controller = new GuiController();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  setGuiLanguage("zh");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("names restored queued images in the interface language", async () => {
  setGuiLanguage("ru");
  await act(async () => root.render(<Fixture />));
  vi.spyOn(controller.queue, "take").mockReturnValue({ text: "", images: [imageUrl, imageUrl], skills: [] });
  act(() => { expect(editor.editQueued("queued")).toBe(true); });
  expect(editor.draft.images.map((image) => image.name)).toEqual(["Изображение 1", "Изображение 2"]);
});

it("names recovered images in the interface language and keeps Chinese names in zh", async () => {
  setGuiLanguage("en");
  controller.messageEditor.recoveredDrafts.set("new", { text: "", images: [imageUrl], skills: [] });
  await act(async () => root.render(<Fixture />));
  expect(editor.draft.images.map((image) => image.name)).toEqual(["Image"]);
  setGuiLanguage("zh");
  vi.spyOn(controller.queue, "take").mockReturnValue({ text: "", images: [imageUrl], skills: [] });
  act(() => { expect(editor.editQueued("queued")).toBe(true); });
  expect(editor.draft.images.map((image) => image.name)).toEqual(["图片 1"]);
});
