// @vitest-environment jsdom
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { GuiController } from "./controller";
import { guiApi } from "./api";
import { testModels } from "./testModels";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock("./UsageStatus", () => ({ UsageStatus: () => null }));
vi.mock("./ProjectPicker", () => ({ ProjectPicker: () => null }));
vi.mock("./AccessPicker", () => ({ AccessPicker: () => null }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
let controller: GuiController;
let host: HTMLDivElement;
let root: Root;

function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <Composer state={state} controller={controller} active />;
}

const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"][aria-label="消息"]')!;
const images = () => host.querySelectorAll('[aria-label="图片附件"] img');
const switchBack = async () => {
  await act(async () => controller.select("existing"));
  expect(images()).toHaveLength(0);
  await act(async () => controller.newConversation());
};
const pasteImage = () => act(async () => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const file = new File(["image"], "截图.png", { type: "image/png" });
  Object.defineProperty(event, "clipboardData", { value: {
    items: [{ kind: "file", getAsFile: () => file }], getData: () => "",
  } });
  editor().dispatchEvent(event);
});

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, "result", { value: imageUrl });
    this.dispatchEvent(new ProgressEvent("load"));
  });
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "models") return { data: testModels, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    return { thread: { id: "existing", cwd: "", preview: "hello", updatedAt: 1, turns: [] } };
  });
  controller = new GuiController();
  await controller.connect();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  controller.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("restores one pasted image after repeated conversation switches and removes it completely", async () => {
  await pasteImage();
  expect(images()).toHaveLength(1);
  await switchBack();
  expect(images()).toHaveLength(1);
  await switchBack();
  expect(images()).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除图片 1"]')!.click());
  expect(images()).toHaveLength(0);
  await switchBack();
  expect(images()).toHaveLength(0);
});

it("clears pasted images after sending creates a conversation, including after returning to new chat", async () => {
  const send = vi.spyOn(controller, "send").mockImplementation(async () => {
    await controller.select("existing");
    return true;
  });
  await pasteImage();
  await act(async () => editor().dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", bubbles: true, cancelable: true,
  })));
  expect(send).toHaveBeenCalledWith("", [imageUrl], []);
  expect(images()).toHaveLength(0);
  await act(async () => controller.newConversation());
  expect(images()).toHaveLength(0);
  await pasteImage();
  expect(images()).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除图片 1"]')!.click());
  expect(images()).toHaveLength(0);
});
